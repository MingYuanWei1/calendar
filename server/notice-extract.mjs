import {z} from 'zod';
import {divisionOf} from '../public/grades.mjs';
import {randomUUID} from 'node:crypto';
import {connection,lenientList} from './llm-stream.mjs';
import {sourceSchema} from './exam-extract.mjs';
import {eventSchema,dayPlanSchema} from './validation.mjs';
import {MEDIA,materialsRequest} from './materials.mjs';

// 通知转日程: the model reads a notice (text, screenshots, PDF pages, workbooks) and proposes new events, changes to
// existing events (改期 / 取消) and day plans. It runs as an extraction job (kind 'notice'); nothing is saved here,
// the admin reviews and applies the proposals.
const pair=z.object({zh:z.string().max(15000).nullish(),en:z.string().max(15000).nullish()}).nullish();
const day=z.string().max(20).nullish(),clock=z.string().max(10).nullish();
const itemSchema=z.object({
 action:z.enum(['create','reschedule','cancel','dayPlan']),
 target:z.string().max(20).nullish(),
 event:z.object({title:pair,type:z.string().max(20).nullish(),start:day,end:day,time:clock,endTime:clock,scope:z.array(z.string().max(20)).max(4).nullish(),grades:z.array(z.number()).max(12).nullish(),location:pair,description:pair}).nullish(),
 cancelReason:z.string().max(2000).nullish(),
 dayPlan:z.object({start:day,end:day,kind:z.string().max(20).nullish(),title:pair,follows:z.number().int().nullish()}).nullish(),
 source:sourceSchema,
 note:z.string().max(1000).nullish()
});
const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const pick=value=>[value?.zh?.trim()||'',value?.en?.trim()||''];

/** Derives the event time mode the same way the editor does: deadline, multi-day, timed or all-day. */
export function timeModeOf({type,start,end,time,endTime}){
 if(type==='deadline')return 'deadline';
 if(end&&end!==start)return 'multi';
 return time||endTime?'timed':'allDay';
}
const issues=result=>result.success?[]:result.error.issues.map(i=>`${i.path.join('.')||'event'}: ${i.message}`);

// A multi-day event moved by its start date alone keeps its length.
const daysBetween=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/86400000);
const shift=(iso,days)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};

/** Turns raw model items into reviewable proposals, resolving refs (E1…) to existing events. */
export function resolveNotice(raw,refs,types=['exam','competition','activity','deadline']){
 const warnings=[],items=[];
 for(const item of raw){
  const base={key:randomUUID(),action:item.action,source:item.source||null,note:item.note||''};
  if(item.action==='create'){
   const e=item.event||{},event={title:pick(e.title),type:types.includes(e.type)?e.type:'activity',start:e.start||'',end:e.end&&e.end!==e.start?e.end:undefined,time:e.time||undefined,endTime:e.type==='deadline'?undefined:e.endTime||undefined,scope:(e.scope||[]).filter(s=>['schoolwide','primary','middle','high'].includes(s)),grades:(e.grades||[]).filter(g=>Number.isInteger(g)&&g>=1&&g<=12),location:pick(e.location),host:['',''],description:pick(e.description),status:'draft'};
   if(!event.scope.length||event.scope.includes('schoolwide'))event.scope=['schoolwide'];
   event.grades=event.grades.filter(g=>event.scope.includes(divisionOf(g)));
   event.timeMode=timeModeOf(event);
   items.push({...base,event,problems:issues(eventSchema.safeParse(event))});
  }else if(item.action==='dayPlan'){
   const p=item.dayPlan||{},plan={start:p.start||'',end:p.end||p.start||'',kind:['off','school','half'].includes(p.kind)?p.kind:'off',title:pick(p.title),follows:p.follows>=1&&p.follows<=5?p.follows:null};
   items.push({...base,dayPlan:plan,problems:issues(dayPlanSchema.safeParse(plan))});
  }else{
   const target=refs.get(item.target||'');
   const label=pick(item.event?.title)[0]||item.source?.quote||item.target||'';
   if(!target){warnings.push(`未能在校历中找到“${label}”对应的事件，已跳过该${item.action==='cancel'?'取消':'改期'}项，请手动处理。`);continue;}
   const summary={id:target.id,version:target.version,title:target.title,type:target.type,status:target.status,start:target.start,end:target.end||'',time:target.time||'',endTime:target.endTime||''};
   if(item.action==='cancel'){
    items.push({...base,target:summary,cancelReason:item.cancelReason||'',problems:target.status==='published'?[]:['只能取消已发布的事件']});
   }else{
    const e=item.event||{},start=e.start||target.start,change={start,end:e.end&&e.end!==start?e.end:!e.end&&target.end?shift(target.end,daysBetween(target.start,start)):'',time:e.time??target.time??'',endTime:target.type==='deadline'?'':e.endTime??target.endTime??''};
    const next={...target,...change,end:change.end||undefined,time:change.time||undefined,endTime:change.endTime||undefined,timeMode:timeModeOf({...target,...change})};
    items.push({...base,target:summary,change,problems:issues(eventSchema.safeParse(next))});
   }
  }
 }
 return {items,warnings};
}

/** Published events the notice may refer to, under short refs. */
export function noticeRefs(db){
 const refs=new Map();
 db.prepare("SELECT body FROM events WHERE status='published' ORDER BY json_extract(body,'$.start')").all().forEach((row,i)=>{const e=JSON.parse(row.body);refs.set(`E${i+1}`,e);});
 return refs;
}

export const noticeInstruction=({today,refs,plans,catalog,medium='materials'})=>`You turn a school notice into calendar changes, reading it from ${MEDIA[medium].from}. ${MEDIA[medium].untrusted} Today is ${today} (${weekdays[new Date(today+'T12:00:00Z').getUTCDay()]}).
Return ONLY JSON {"items":[],"warnings":[]}. Each item describes ONE change, in the order it appears in the notice:
- {"action":"create","event":{...}} for a new event. event = {title:{zh,en}, type: one of the Event types ids below, start: YYYY-MM-DD, end: YYYY-MM-DD only for multi-day events, time: HH:mm start (for a deadline: the due time, or omitted when the notice gives only a date), endTime: HH:mm, scope: ["schoolwide"] or any of ["primary","middle","high"], grades: grade numbers 1–12 ONLY when the notice explicitly names grades (e.g. 初二 = 8, 高一 = 10, G10 = 10; primary is 1–6, middle 7–9, high 10–12), otherwise [], location:{zh,en}, description:{zh,en} (one or two sentences summarising the details students need; when the notice gives a link to the event itself, such as an event page or details page, append that full URL verbatim at the end of both languages. A registration or sign-up link is NOT an event link: never include it, admins add registration links themselves)}.
- {"action":"reschedule","target":"E3","event":{start,end,time,endTime}} when the notice moves an EXISTING event below; give only the new date/time fields.
- {"action":"cancel","target":"E3","cancelReason":"…"} when the notice cancels an EXISTING event; the reason in the notice's language.
- {"action":"dayPlan","dayPlan":{start,end,kind,title:{zh,en},follows}} for days off (kind "off"), make-up school days on a usual day off (kind "school", follows = 1–5 for the Monday–Friday timetable it uses, or null) and half days (kind "half").
Every item has ${MEDIA[medium].source('this change')} and an optional short note.
Rules: Use a target only when the notice clearly refers to that existing event (same activity and original date); otherwise create a new event and add a warning. Always fill BOTH languages: translate titles, places and descriptions naturally; keep proper nouns. Dates without a year are the next occurrence on or after today minus 30 days. Never invent times, places or audiences: leave them empty and add a warning. Ignore greetings, signatures and items that are not calendar changes. Write warnings and notes in the notice's language.
School divisions: primary (小学部), middle (初中部), high (高中部).
EXISTING events (ref, title, type, dates, time, scope, status): ${JSON.stringify([...refs].map(([ref,e])=>[ref,e.title.filter(Boolean).join(' / '),e.type,e.start+(e.end?'..'+e.end:''),(e.time||'')+(e.endTime?'-'+e.endTime:''),e.scope.join(','),e.cancelled?'cancelled':e.status]))}
EXISTING day plans: ${JSON.stringify(plans)}
Event types: ${JSON.stringify(catalog)}`;

const failure=error=>error.name==='TimeoutError'?'识别超时，请减少材料后重试。':error instanceof z.ZodError||error instanceof SyntaxError?'模型返回格式不正确，请重试。':/^(LLM Worker|请配置|模型)/.test(error.message||'')?error.message:'无法连接 LLM Worker，请检查环境配置或稍后重试。';
// The job keeps the events the notice was read against, under the refs the model saw, so its answer resolves the same
// way however long it runs.
const resolve=(context,list)=>resolveNotice(list,new Map(context.refs),context.types);

export function installNoticeExtract(app,db,{requireAdmin,llm,timeZone,types,jobs}){
 app.get('/api/admin/notice-extract',requireAdmin,(req,res)=>{try{connection(llm);res.json({configured:true});}catch{res.json({configured:false});}});
 // Notices are not tied to anything, so the school has one notice job at a time.
 jobs.register('notice',{scope:()=>'notice',itemKey:'items',failure,
  async prepare(materials){
   const today=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   const refs=noticeRefs(db);
   const plans=db.prepare('SELECT date,kind,follows FROM day_plans WHERE date>=? ORDER BY date LIMIT 120').all(today);
   const catalog=Object.fromEntries(types().map(t=>[t.id,t.name.filter(Boolean).join(' / ')]));
   const {request,source}=await materialsRequest(materials,{instruction:medium=>noticeInstruction({today,refs,plans,catalog,medium}),timeout:120000,empty:'工作簿没有可读取的通知内容。'});
   return {request,...(source?{source}:{}),context:{refs:[...refs],types:types().map(t=>t.id)}};
  },
  // Malformed items are set aside and listed after the rest.
  finish(context,raw){
   const result=lenientList(raw,'items',itemSchema,200),resolved=resolve(context,result.list);
   return {items:resolved.items,warnings:[...result.warnings,...resolved.warnings],invalid:result.invalid};
  },
  salvage(context,list){
   const items=(Array.isArray(list)?list:[]).flatMap(item=>{const r=itemSchema.safeParse(item);return r.success?[r.data]:[];});
   if(!items.length)return null;
   const resolved=resolve(context,items);
   return resolved.items.length?resolved:null;
  }});
}
