import {normalizeCourse} from '../public/exam-subjects.mjs';
import {z} from 'zod';
import {parseGrade} from '../public/grades.mjs';
import {randomUUID} from 'node:crypto';
import {batchSchema} from './exam-model.mjs';
import {connection,lenientList} from './llm-stream.mjs';
import {MEDIA,materialsRequest} from './materials.mjs';
export {worker} from './llm-stream.mjs';
export const sourceSchema=z.object({page:z.number().int().min(1).max(50).nullish(),quote:z.string().max(300).nullish(),workbook:z.string().max(200).nullish(),sheet:z.string().max(100).nullish(),cell:z.string().max(20).nullish()}).nullish().catch(null);
export const sessionRow=z.object({ref:z.string().max(20).nullish(),title:z.string().max(180).nullish(),titleEn:z.string().max(180).nullish(),subject:z.string().max(100).nullish(),subjectEn:z.string().max(100).nullish(),level:z.string().max(40).nullish(),division:z.string().max(20).nullish(),grades:z.array(z.union([z.number(),z.string().max(30)])).max(20).nullish(),date:z.string().max(20).nullish(),start:z.string().max(10).nullish(),end:z.string().max(10).nullish(),rooms:z.array(z.string().max(60)).max(30).nullish(),note:z.string().max(1000).nullish(),source:sourceSchema});
export const extractionInstruction=(start,end,catalog,rules='',existing=[],medium='materials')=>`Extract exam sessions from ${MEDIA[medium].from}. ${MEDIA[medium].untrusted} Return ONLY a JSON object {"sessions":[],"warnings":[]}. Each session: ref (see below, or empty),title,titleEn,subject,subjectEn,level,division (primary/middle/high),grades (array of grade numbers 1–12: primary is 1–6, middle 7–9, high 10–12; convert the school's own labels such as G10 or 高一 to their number using the school's rules),date (YYYY-MM-DD),start,end (HH:mm),rooms (array of room names),note. Do not invent missing facts: use empty strings/arrays and explain missing or ambiguous fields in warnings. No Paper field. Apply the following naming and classification rules to EVERY subject, including all catalog subjects and custom subjects, not just Biology. Normalize course variants to the parent subject in the catalog, never create subjects named "1", "2", "Biology 1" or "Biology 2". Numbered courses are levels: Biology 1 => subject="生物", subjectEn="Biology", level="Biology 1", title="Biology 1"; Biology 2 likewise. Apply exactly the same pattern to Mathematics 1, Physics 2, Chemistry 1, Chinese 2, English 1, History 2, Computer Science 1, Business Management 2 and all other numbered courses. Use the catalog English course name when available; otherwise use the source course name, followed by one space and the original number. The subject field contains only the parent subject, while title, titleEn (when English is known), and level preserve Course + number. Never discard, renumber, or confuse course numbers with grades, room numbers or exam paper numbers. When a source cell says only "1" or "2", use its explicit subject header to construct Course + number (e.g. Biology 1); if the subject context is missing, warn rather than guess. Keep named levels (e.g. HL, SL, Honor) under the same parent subject. ${rules.trim()?`This school's own rules OVERRIDE the general naming rules above:\n${rules.trim()}\n`:''}Preserve grade, date, times and rooms independently of naming. Never change a grade to make a course fit a naming rule. Preserve each course's original grade, date, time and rooms. Batch date range ${start} to ${end}; dates must be supported by source and context. Subject catalog: ${JSON.stringify(catalog)}. Extract only exams, never student seating or personal names. Each session also has ${MEDIA[medium].source('this session (e.g. the course cell)')}. Output sessions in the order they appear in the source. ${existing.length?`This batch already has the sessions listed below with refs S1…. When the material describes one of them (the same course for the same grades, even with a new date, time or rooms), set ref to its ref and give every field as it should now be, copying from the existing session whatever the material does not change. Leave ref empty for a session that is not in the list. The material may show only part of the timetable (for example a screenshot of the rows that change), so output only sessions the material shows: an existing session the material does not mention is unchanged and must not be output. Never delete or cancel sessions: when the material says a session is cancelled or removed, do not output it; add a warning naming it instead. Existing sessions: ${JSON.stringify(existing)}`:''}`;
export const extractionFailure=error=>error.name==='TimeoutError'?'提取超时，请缩小材料范围后重试。':error instanceof z.ZodError||error instanceof SyntaxError?'模型返回格式不正确，请重试。':/^(LLM Worker|请配置|模型)/.test(error.message||'')?error.message:'无法连接 LLM Worker，请检查环境配置或稍后重试。';
/**
 * Turns the materials into the model request for `batch`; `context` holds what normalising the answer needs later.
 * The draft's sessions go along as refs S1…, and `context.refs` maps each ref back to its session id.
 */
export async function prepareSessions(materials,batch,catalog,rules){
 const sessions=batch.sessions||[];
 const existing=sessions.map((s,i)=>({ref:`S${i+1}`,title:s.title,subject:s.subject,level:s.level,division:s.division,grades:s.grades,date:s.date,start:s.start,end:s.end,rooms:s.rooms,...(s.cancelled?{cancelled:true}:{})}));
 const {request}=await materialsRequest(materials,{instruction:medium=>extractionInstruction(batch.start,batch.end,catalog,rules.rules,existing,medium),timeout:120000,empty:'工作簿没有可读取的考试安排。'});
 return {request,context:{catalog,curriculum:rules.curriculum,refs:Object.fromEntries(sessions.map((s,i)=>[`S${i+1}`,s.id]))}};
}
// A session the model tied to a draft session carries its id as targetId; the review shows it as a change.
export const normalizeSession=({catalog,curriculum,refs},s)=>normalizeCourse({id:randomUUID(),...(refs?.[s.ref]?{targetId:refs[s.ref]}:{}),title:s.title||'',titleEn:s.titleEn||'',subject:s.subject||'',subjectEn:s.subjectEn||'',level:s.level||'',division:s.division||'',grades:[...new Set((s.grades||[]).map(parseGrade).filter(Boolean))].sort((a,b)=>a-b),date:s.date||'',start:s.start||'',end:s.end||'',rooms:s.rooms||[],note:s.note||'',cancelled:false,source:s.source||null},catalog,curriculum);
/** The sessions the model had finished before a failure, so the administrator can add them and retry the rest. */
export function salvageSessions(context,list){
 const sessions=(Array.isArray(list)?list:[]).flatMap(s=>{const r=sessionRow.safeParse(s);return r.success?[normalizeSession(context,r.data)]:[];});
 return sessions.length?{sessions,warnings:[]}:null;
}
/** Normalises the model's answer; malformed sessions are set aside and listed after the rest. */
export function finishSessions(context,raw){
 const {list,warnings,invalid}=lenientList(raw,'sessions',sessionRow,300);
 const unknown=[...new Set(list.map(s=>s.ref).filter(ref=>ref&&!context.refs?.[ref]))];
 return {sessions:list.map(s=>normalizeSession(context,s)),warnings:[...warnings,...unknown.map(ref=>`模型引用了不存在的场次 ${ref}，已按新增处理。`)],invalid};
}
export function installExamExtract(app,requireAdmin,config){
 app.get('/api/admin/exam-extract',requireAdmin,(req,res)=>{try{connection(config);res.json({configured:true});}catch{res.json({configured:false});}});
 app.post('/api/admin/exam-extract/validate',requireAdmin,(req,res)=>{
  const parsed=batchSchema.safeParse(req.body);
  if(!parsed.success)return res.status(422).json({error:parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('；')});
  res.json(parsed.data);
 });
}
