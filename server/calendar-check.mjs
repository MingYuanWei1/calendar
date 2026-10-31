// 核验事件 / 核验放假与调休: the school's official calendar or activity list is compared with the events, day plans and
// terms within the dates it covers. Corrections go through each record's own API (see checks.mjs): a missing event
// becomes a draft, an extra one is cancelled (published) or deleted (draft), and a date of a repeating event is changed
// or cancelled on its own (仅此次 / 本次取消). 考试批次事件 are left out: they belong to the exams page.
// Also the event rules of 自检.
import {z} from 'zod';
import {sourceSchema} from './exam-extract.mjs';
import {MEDIA} from './materials.mjs';
import {timeModeOf} from './notice-extract.mjs';
import {addDays,occurrence,seriesDates} from '../public/recurrence.mjs';

const pair=z.object({zh:z.string().max(250).nullish(),en:z.string().max(250).nullish()}).nullish();
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clock=z.string().regex(/^\d{2}:\d{2}$/).nullish().or(z.literal('')).catch(null);
const eventRow=z.object({title:pair,type:z.string().max(40).nullish(),start:day,end:day.nullish().or(z.literal('')).catch(null),time:clock,endTime:clock,location:pair,target:z.string().max(20).nullish(),source:sourceSchema});
const dayRow=z.object({kind:z.enum(['off','school','half','term']),start:day,end:day.nullish().or(z.literal('')).catch(null),title:pair,follows:z.number().int().min(1).max(5).nullish().catch(null),source:sourceSchema});
const rangeSchema=z.object({from:day.optional(),to:day.optional()}).refine(r=>!r.from||!r.to||r.from<=r.to,'请选择有效的日期范围。');

const text=value=>String(value||'').trim();
const squash=value=>text(value).toLowerCase().replace(/[\s·・,，。.()（）\-—_:：]/g,'');
// Two wordings name the same thing when one contains the other ("科技节" and "2026 科技节").
const similar=(a,b)=>{const x=squash(a),y=squash(b);return x===y||(Boolean(x)&&Boolean(y)&&(x.includes(y)||y.includes(x)));};
const days=(a,b)=>Math.abs(Date.parse(a)-Date.parse(b))/86400000;
const bilingual=value=>[text(value?.zh),text(value?.en)];

/** The dates of `events` within [from, to]: one per single event, one per held date of a series. */
export function occurrencesIn(events,plans,from,to){
 const list=[];
 for(const event of events){
  if(!event.repeat){
   if((event.end||event.start)<from||event.start>to)continue;
   list.push({event,date:null,start:event.start,end:event.end||'',time:event.time||'',endTime:event.endTime||'',title:event.title,location:event.location||['',''],cancelled:Boolean(event.cancelled)});
   continue;
  }
  for(const date of seriesDates(event,plans,to)){
   if(date<from||event.exceptions?.[date]?.deleted)continue;
   const o=occurrence(event,date);
   list.push({event,date,start:o.start,end:'',time:o.time||'',endTime:o.endTime||'',title:o.title,location:o.location||['',''],cancelled:Boolean(o.cancelled)});
  }
 }
 return list.sort((a,b)=>a.start.localeCompare(b.start));
}
const label=o=>o.title.filter(Boolean).join(' / ');
const keyOf=o=>`${o.event.id}@${o.date||''}`;
const when=o=>`${o.start}${o.end&&o.end!==o.start?'..'+o.end:''}${o.time?' '+o.time+(o.endTime?'-'+o.endTime:''):''}`;

/** The requests that change one date (or a single event) to `next` fields, or cancel/remove it. */
function eventRequest(o,next){
 const e=o.event,path=`/admin/events/${encodeURIComponent(e.id)}`;
 if(next){
  // A date of a series starts from that date's own values, which "this date only" compares with the series.
  const merged={...e,...(o.date?{start:o.start,time:o.time||undefined,endTime:o.endTime||undefined,title:o.title,location:o.location}:{}),...next};
  const body={...merged,timeMode:o.date?e.timeMode:timeModeOf(merged),...(o.date?{occurrence:{date:o.date,span:'one'}}:{})};
  if(!body.end||body.end===body.start)delete body.end;
  return {method:'PUT',path,body,record:e.id};
 }
 const occurrenceOf=o.date?{occurrence:{date:o.date,span:'one'}}:{};
 return e.status==='published'?{method:'POST',path:path+'/cancel',body:{version:e.version,reason:'',...occurrenceOf},record:e.id}:{method:'DELETE',path,body:{version:e.version,...occurrenceOf},record:e.id};
}

/**
 * Compares calendar rows with the events between `from` and `to` (by default the reference's own first and last
 * dates). A row is matched to the date the model named (`targetId`/`targetDate`) or else to the nearest date with a
 * similar title; titles, dates, times and places are compared loosely so a different wording is not a change.
 */
export function compareEvents(rows,events,plans,{from,to,types=[]}){
 const first=from||rows.map(r=>r.start).sort()[0],last=to||rows.map(r=>r.end||r.start).sort().at(-1);
 if(!first)return {items:[],meta:{from:null,to:null}};
 const pool=occurrencesIn(events,plans,addDays(first,-62),addDays(last,62)),used=new Set(),items=[];
 rows.forEach((row,index)=>{
  const [zh,en]=bilingual(row.title);
  let found=row.targetId?pool.find(o=>o.event.id===row.targetId&&(o.date||null)===(row.targetDate||null)&&!used.has(keyOf(o))):null;
  if(!found)found=pool.filter(o=>!used.has(keyOf(o))&&days(o.start,row.start)<=31&&((zh&&similar(o.title[0],zh))||(en&&similar(o.title[1],en)))).sort((a,b)=>days(a.start,row.start)-days(b.start,row.start))[0];
  const base={key:`r${index}`,title:zh||en,row,source:row.source||null};
  if(!found){
   const event={title:[zh,en],type:types.includes(row.type)?row.type:'activity',start:row.start,...(row.end&&row.end!==row.start?{end:row.end}:{}),...(row.time?{time:row.time}:{}),...(row.endTime?{endTime:row.endTime}:{}),scope:['schoolwide'],grades:[],location:bilingual(row.location),host:['',''],description:['',''],status:'draft'};
   return items.push({...base,status:'missing',record:null,changes:[],apply:{method:'POST',path:'/admin/events',body:{...event,timeMode:timeModeOf(event)}}});
  }
  used.add(keyOf(found));
  const record={id:found.event.id,date:found.date,title:label(found),when:when(found),status:found.event.status};
  if(found.cancelled)return items.push({...base,status:'mismatch',record,changes:[{field:'cancelled',from:true,to:false}],note:'该事件已取消；如需恢复，请在事件页操作。',apply:null});
  const changes=[],next={};
  const change=(field,from,to,values)=>{changes.push({field,from,to});Object.assign(next,values);};
  if(zh&&!similar(found.title[0],zh)&&!(en&&similar(found.title[1],en)))change('title',found.title[0],zh,{title:[zh,found.title[1]]});
  if(row.start!==found.start)change('date',found.start,row.start,{start:row.start});
  if(!found.date&&row.end&&row.end!==row.start&&row.end!==found.end)change('end',found.end,row.end,{end:row.end});
  if(row.time&&row.time!==found.time)change('time',found.time,row.time,{time:row.time});
  if(row.endTime&&row.endTime!==found.endTime)change('endTime',found.endTime,row.endTime,{endTime:row.endTime});
  const [place]=bilingual(row.location);
  if(place&&!similar(found.location[0],place))change('location',found.location[0],place,{location:[place,found.location[1]||'']});
  items.push({...base,status:changes.length?'mismatch':'ok',record,changes,apply:changes.length?eventRequest(found,next):null});
 });
 for(const o of pool){
  if(used.has(keyOf(o))||o.cancelled||o.start<first||o.start>last)continue;
  items.push({key:`x:${keyOf(o)}`,title:label(o),status:'extra',row:null,source:null,record:{id:o.event.id,date:o.date,title:label(o),when:when(o),status:o.event.status},changes:[],action:o.event.status==='published'?'cancel':'delete',apply:eventRequest(o,null)});
 }
 return {items,meta:{from:first,to:last}};
}

const datesOf=(start,end)=>{const list=[];for(let d=start;d<=(end||start);d=addDays(d,1))list.push(d);return list;};
/**
 * Compares the school calendar's days off, make-up school days and half days with the day plans in its range, and
 * its terms with the stored terms. A day plan the reference leaves out is extra, removed on apply; so is a term.
 */
export function compareDays(rows,plans,terms,{from,to}){
 const planRows=rows.filter(r=>r.kind!=='term'),termRows=rows.filter(r=>r.kind==='term');
 const first=from||planRows.map(r=>r.start).sort()[0],last=to||planRows.map(r=>r.end||r.start).sort().at(-1);
 const items=[],covered=new Set();
 rows.forEach((row,index)=>{
  const [zh,en]=bilingual(row.title),base={key:`r${index}`,title:zh||en,row,source:row.source||null};
  const end=row.end||row.start;
  if(row.kind==='term'){
   const term=terms.find(t=>(zh&&similar(t.name[0],zh))||(en&&similar(t.name[1],en)))||terms.find(t=>t.start<=end&&t.end>=row.start);
   if(!term)return items.push({...base,status:'missing',record:null,changes:[],apply:{method:'POST',path:'/admin/terms',body:{name:[zh,en],start:row.start,end}}});
   const changes=[];
   if(term.start!==row.start)changes.push({field:'start',from:term.start,to:row.start});
   if(term.end!==end)changes.push({field:'end',from:term.end,to:end});
   return items.push({...base,status:changes.length?'mismatch':'ok',record:{id:term.id,title:term.name.filter(Boolean).join(' / '),when:`${term.start}..${term.end}`},changes,apply:changes.length?{method:'PUT',path:`/admin/terms/${encodeURIComponent(term.id)}`,body:{name:term.name,start:row.start,end,version:term.version},record:term.id}:null});
  }
  const dates=datesOf(row.start,end);dates.forEach(d=>covered.add(d));
  const stored=dates.map(d=>plans[d]);
  const changes=[];
  const kinds=[...new Set(stored.map(p=>p?.kind||'default'))];
  if(kinds.length!==1||kinds[0]!==row.kind)changes.push({field:'kind',from:kinds.join(' / '),to:row.kind});
  else if(zh&&stored.some(p=>!similar(p.title[0],zh)))changes.push({field:'title',from:stored[0].title[0],to:zh});
  const follows=row.kind==='school'?row.follows??null:null;
  const status=stored.every(p=>!p)?'missing':changes.length?'mismatch':'ok';
  items.push({...base,status,record:stored.some(Boolean)?{title:stored.find(Boolean).title.filter(Boolean).join(' / '),when:`${row.start}${end!==row.start?'..'+end:''}`}:null,changes:status==='missing'?[]:changes,
   apply:status==='ok'?null:{method:'PUT',path:'/admin/day-plans',body:{start:row.start,end,kind:row.kind,title:[zh,en],follows}}});
 });
 // Day plans in range the reference does not mention, gathered into runs of consecutive days alike.
 if(first){
  let run=null;
  const flush=()=>{if(run)items.push({key:`x:${run.start}`,title:run.plan.title.filter(Boolean).join(' / ')||run.plan.kind,status:'extra',row:null,source:null,record:{title:run.plan.title.filter(Boolean).join(' / '),kind:run.plan.kind,when:`${run.start}${run.end!==run.start?'..'+run.end:''}`},changes:[],action:'delete',apply:{method:'PUT',path:'/admin/day-plans',body:{start:run.start,end:run.end,kind:'default'}}});run=null;};
  for(const d of datesOf(first,last)){
   const plan=plans[d];
   if(!plan||covered.has(d)){flush();continue;}
   if(run&&run.end===addDays(d,-1)&&run.plan.kind===plan.kind&&JSON.stringify(run.plan.title)===JSON.stringify(plan.title))run.end=d;
   else{flush();run={start:d,end:d,plan};}
  }
  flush();
  for(const term of terms)if(term.start<=last&&term.end>=first&&!items.some(i=>i.record?.id===term.id))
   items.push({key:`x:term:${term.id}`,title:term.name.filter(Boolean).join(' / '),status:'extra',row:null,source:null,record:{id:term.id,title:term.name.filter(Boolean).join(' / '),when:`${term.start}..${term.end}`},changes:[],action:'delete',apply:{method:'DELETE',path:`/admin/terms/${encodeURIComponent(term.id)}`,body:{},record:term.id}});
 }
 return {items,meta:{from:first||null,to:last||null}};
}

const rangeText=({from,to})=>from||to?`It covers ${from||'its first date'} to ${to||'its last date'}; leave out anything outside these dates. `:'';
export const eventCheckInstruction=({today,refs,catalog,range,medium})=>`You read a school's official calendar or activity list from ${MEDIA[medium].from} so the school's calendar events can be checked against it. ${MEDIA[medium].untrusted} Today is ${today}. ${rangeText(range)}
Return ONLY JSON {"rows":[],"warnings":[]}, one entry per event or activity in the order it appears: {title:{zh,en} (as written; translate only to fill the other language), type (one of the Event types ids below), start (YYYY-MM-DD), end (YYYY-MM-DD, only for an event over several days), time (HH:mm, only when given), endTime (HH:mm, only when given), location:{zh,en} (only when given), target (the ref of the EXISTING date below that is this same event, or empty), ${MEDIA[medium].source('this event')}}.
Use a target only when the material clearly means that existing event on or near that date; never force a match. Leave out days off, make-up school days and exams: they are kept elsewhere. Dates without a year are the next occurrence on or after today minus 200 days. Never invent times or places. Warn about unreadable entries; write warnings in the material's language.
Event types: ${JSON.stringify(catalog)}
EXISTING dates (ref, title, date and time, place): ${JSON.stringify(refs.map(([ref,o])=>[ref,label(o),when(o),o.location[0]||'']))}`;
export const dayCheckInstruction=({today,range,medium})=>`You read a school's official calendar from ${MEDIA[medium].from} so its days off, make-up school days, half days and terms can be checked. ${MEDIA[medium].untrusted} Today is ${today}. ${rangeText(range)}
Return ONLY JSON {"rows":[],"warnings":[]}, one entry per item in the order it appears: {kind ("off" for days off and holidays, "school" for a make-up school day on a usual day off, "half" for a half day, "term" for a term or semester), start (YYYY-MM-DD), end (YYYY-MM-DD, the last day, for a range), title:{zh,en} (the holiday or term name as written; translate only to fill the other language), follows (for "school": 1–5 for the Monday–Friday timetable the day uses, when stated), ${MEDIA[medium].source('this item')}}.
Leave out ordinary weekends, events and exams. Dates without a year are the next occurrence on or after today minus 200 days. Warn about unreadable entries; write warnings in the material's language.`;

/**
 * `events()` lists the school's own events (no 考试批次事件), `plans()` the day plans by date, `terms()` the terms,
 * `types()` the event type ids and catalog, and `today()` the school's date.
 */
export function registerCalendarChecks(checks,{events,plans,terms,types,today}){
 const range=fields=>{const parsed=rangeSchema.safeParse({from:fields.from||undefined,to:fields.to||undefined});if(!parsed.success)throw new Error('请选择有效的日期范围。');return parsed.data;};
 // The model sees the event dates around the reference's range under refs E1…, and the job keeps what each ref meant.
 const refsFor=({from,to})=>occurrencesIn(events(),plans(),from||addDays(today(),-200),to||addDays(today(),400)).slice(0,600).map((o,i)=>[`E${i+1}`,o]);
 checks.register('events',{scope:()=>'events',row:eventRow,max:1000,empty:'工作簿没有可读取的日程。',options:range,
  instruction:(medium,scope,options)=>eventCheckInstruction({today:today(),refs:refsFor(options),catalog:types().catalog,range:options,medium}),
  context:(scope,options)=>({refs:Object.fromEntries(refsFor(options).map(([ref,o])=>[ref,[o.event.id,o.date]]))}),
  normalize:(context,{target,...row})=>{const [targetId,targetDate]=context.refs?.[target]||[];return targetId?{...row,targetId,targetDate}:row;},
  compare:(rows,scope,options)=>compareEvents(rows,events(),plans(),{...options,types:types().ids})});
 checks.register('days',{scope:()=>'days',row:dayRow,max:400,empty:'工作簿没有可读取的校历。',options:range,
  instruction:(medium,scope,options)=>dayCheckInstruction({today:today(),range:options,medium}),
  compare:(rows,scope,options)=>compareDays(rows,plans(),terms(),options)});

 // 自检: drafts left for two weeks, and series whose every date is skipped. Events on days off are not reported.
 checks.selfCheck(()=>{
  const issues=[],dayPlans=plans(),stale=Date.now()-14*86400000;
  for(const event of events()){
   const name=event.title.filter(Boolean).join(' / '),link=`#events/${encodeURIComponent(event.id)}`;
   if(event.cancelled)continue;
   if(event.status==='draft'&&Date.parse(event.updatedAt||'')<stale)issues.push({area:'events',message:`草稿“${name}”已超过 14 天未发布。`,link});
   if(event.repeat&&!seriesDates(event,dayPlans,event.repeat.until||addDays(event.start,730)).some(d=>!event.exceptions?.[d]?.deleted))issues.push({area:'events',message:`重复事件“${name}”的所有日期都被跳过。`,link});
  }
  return issues;
 });
}
