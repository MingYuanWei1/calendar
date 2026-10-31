// 核验考试场次 / 核验座位表: the official timetable or seating plan of ONE exam batch is compared with that batch's
// draft, never with other batches. Corrections go into the draft in one update (see checks.mjs) and reach students
// when the batch is published as usual. Also the exam rules of 自检.
import {extractionInstruction,sessionRow,normalizeSession} from './exam-extract.mjs';
import {seatInstruction,seatRow,seatMode} from './seat-extract.mjs';
import {applySessions} from '../public/exam-schedule-diff.mjs';
import {adaptRooms,seatErrors} from './exam-model.mjs';

const lower=value=>String(value||'').trim().toLowerCase();
// Sessions are matched by course (subject and level, or the title when there is no subject) and grades.
const course=s=>s.subject?`${lower(s.subject)}|${lower(s.level)}`:`t|${lower(s.title)}`;
const gradesText=s=>[...(s.grades||[])].sort((a,b)=>a-b).join(', ');
const examIds=seat=>seat.examIds||[seat.examId];
const withoutSource=({source,targetId,ref,...rest})=>rest;
const minutes=time=>{const [h,m]=String(time||'').split(':').map(Number);return h*60+m;};
const overlap=(a,b)=>a.date===b.date&&a.start&&b.start&&minutes(a.start)<minutes(b.end||b.start)&&minutes(b.start)<minutes(a.end||a.start);

/**
 * Compares the timetable's sessions with the draft's. A reference session the draft lacks is missing (added on
 * apply); a draft session the timetable leaves out is extra: deleted if it was never published, else cancelled so
 * students keep seeing what happened to it. Date, times and grades are compared; rooms are not.
 */
export function compareSessions(rows,draft,publishedIds=new Set()){
 const pool=draft.sessions.slice(),items=[];
 rows.forEach((row,index)=>{
  let found=pool.filter(s=>course(s)===course(row));
  const narrow=test=>{const kept=found.filter(test);if(kept.length)found=kept;};
  if(found.length>1)narrow(s=>gradesText(s)===gradesText(row));
  if(found.length>1)narrow(s=>s.date===row.date);
  const base={key:`r${index}`,title:row.title||row.subject,row,source:row.source||null};
  if(!found.length)return items.push({...base,status:'missing',session:null,changes:[],apply:true});
  const session=found[0],changes=[];
  pool.splice(pool.indexOf(session),1);
  for(const field of ['date','start','end'])if(row[field]&&row[field]!==session[field])changes.push({field,from:session[field]||'',to:row[field]});
  if(row.grades?.length&&gradesText(row)!==gradesText(session))changes.push({field:'grades',from:gradesText(session),to:gradesText(row)});
  if(session.cancelled)changes.push({field:'cancelled',from:true,to:false});
  items.push({...base,status:changes.length?'mismatch':'ok',session,changes,apply:changes.length>0});
 });
 for(const session of pool)if(!session.cancelled)items.push({key:`x:${session.id}`,title:session.title||session.subject,status:'extra',row:null,source:null,session,changes:[],action:publishedIds.has(session.id)?'cancel':'delete',apply:true});
 return {items};
}
/** The draft with the chosen session items applied. */
export function applySessionItems(draft,items){
 let next=structuredClone(draft);
 for(const item of items){
  if(item.status==='missing'){next=applySessions(next,[{item:withoutSource(item.row)}]).batch;continue;}
  const session=next.sessions.find(s=>s.id===item.session.id);if(!session)continue;
  if(item.status==='extra'&&item.action==='cancel')session.cancelled=true;
  else if(item.status==='extra'){next.sessions=next.sessions.filter(s=>s!==session);next.seats=next.seats.filter(seat=>!examIds(seat).includes(session.id));}
  else for(const {field} of item.changes)session[field]=field==='cancelled'?false:item.row[field];
 }
 return next;
}

// A draft seat is known by its student and exam; a seat whose student is not yet identified, by name and class.
const seatKey=(seat,examId=seat.examId)=>seat.studentId?`${seat.studentId}|${examId}`:`n:${seat.name}|${seat.className}|${examId}`;
/**
 * Compares the seating plan with the draft's seats, identifying each reference row's student the way an import does
 * (`organize`). In unordered mode only rooms are compared. Rows whose student or exam is still undecided are left
 * to the administrator.
 */
export function compareSeats(rows,draft,organize,mode='ordered'){
 const organized=organize({...draft,seats:rows.map(withoutSource)},false).seats;
 const drafts=new Map(draft.seats.map(seat=>[seatKey(seat),seat])),matched=new Set(),items=[];
 const title=id=>draft.sessions.find(s=>s.id===id)?.title||id;
 organized.forEach((seat,index)=>{
  const row=rows[index],base={key:`r${index}`,title:`${seat.name||seat.englishName} · ${title(seat.examId)}`,row,source:row.source||null,changes:[]};
  if(seat.candidates)return items.push({...base,status:'ambiguous',seat:null,candidates:seat.candidates,note:'身份不明确，请先在考试页处理身份匹配冲突。',apply:false});
  if(seat.examIds)return items.push({...base,status:'ambiguous',seat:null,note:'座位表没有说明该学生参加同一时段的哪场考试。',apply:false});
  const found=drafts.get(seatKey(seat));
  if(!found||matched.has(seatKey(found)))return items.push({...base,status:'missing',seat:null,studentId:seat.studentId||null,apply:true});
  matched.add(seatKey(found));
  const changes=[];
  if(found.room!==seat.room)changes.push({field:'room',from:found.room,to:seat.room});
  if(mode==='ordered'&&seat.row&&(found.row!==seat.row||found.column!==seat.column))changes.push({field:'position',from:found.row?`${found.row}-${found.column}`:'',to:`${seat.row}-${seat.column}`});
  items.push({...base,status:changes.length?'mismatch':'ok',seat:found,changes,apply:changes.length>0});
 });
 for(const [key,seat] of drafts)if(!matched.has(key))items.push({key:`x:${key}`,title:`${seat.name||seat.englishName} · ${title(seat.examId)}`,status:'extra',row:null,source:null,seat,changes:[],apply:true});
 return {items};
}
/** The draft with the chosen seat items applied; rooms grow to fit the seats. */
export function applySeatItems(draft,items){
 const next=structuredClone(draft);
 for(const item of items){
  if(item.status==='missing'){const {grade,...seat}=withoutSource(item.row);next.seats.push(item.studentId?{...seat,studentId:item.studentId}:seat);continue;}
  const i=next.seats.findIndex(seat=>seatKey(seat)===seatKey(item.seat));if(i<0)continue;
  if(item.status==='extra'){next.seats.splice(i,1);continue;}
  const {room,row,column}=item.row;
  next.seats[i]={...next.seats[i],room,...(item.changes.some(c=>c.field==='position')?{row,column}:{})};
 }
 next.rooms=adaptRooms(next,next.seats).rooms;
 return next;
}

/**
 * `batches()` lists the stored batches {row, info, draft, published}; `draftOf(id)` reads one (throwing a 404 error
 * when it is gone) and `save(row, data)` stores a draft, returning an error message or null.
 */
export function registerExamChecks(checks,{batches,draftOf,save,organize,subjects,schoolRules,dayOff}){
 const batchScope={scope:req=>batches().some(b=>b.row.id===String(req.query.batch||''))?String(req.query.batch):null,missing:'考试批次不存在。'};
 const commit=(batchId,next)=>{
  const target=batches().find(b=>b.row.id===batchId);
  if(!target)throw Object.assign(new Error('考试批次不存在。'),{status:404});
  const error=save(target.row,next);if(error)throw new Error(error);
  return {version:target.row.version+1};
 };
 checks.register('sessions',{...batchScope,row:sessionRow,key:'sessions',max:300,empty:'工作簿没有可读取的考试安排。',
  instruction:(medium,batchId)=>{const batch=draftOf(batchId);return extractionInstruction(batch.start,batch.end,subjects.list(),schoolRules.get().rules,[],medium);},
  context:()=>({catalog:subjects.list(),curriculum:schoolRules.get().curriculum,refs:{}}),
  normalize:normalizeSession,
  compare:(rows,batchId)=>{const target=batches().find(b=>b.row.id===batchId);if(!target)throw Object.assign(new Error('考试批次不存在。'),{status:404});return compareSessions(rows,target.draft,new Set((target.published?.sessions||[]).map(s=>s.id)));},
  apply:(batchId,items)=>commit(batchId,applySessionItems(draftOf(batchId),items))});
 checks.register('seats',{...batchScope,row:seatRow,key:'seats',max:20000,empty:'工作簿没有可提取的文字座位数据。',
  options:fields=>({mode:seatMode(fields.mode)}),
  instruction:(medium,batchId,{mode})=>seatInstruction(draftOf(batchId),mode,medium),
  normalize:(context,seat)=>seat,
  compare:(rows,batchId,{mode})=>compareSeats(rows,draftOf(batchId),organize,mode),
  apply:(batchId,items)=>commit(batchId,applySeatItems(draftOf(batchId),items))});

 // 自检: the drafts' seats and sessions, and changes waiting to be published.
 checks.selfCheck(()=>batches().flatMap(({row,info,draft})=>{
  const issues=[],link=`#exams/${encodeURIComponent(row.id)}`,batch=draft.title;
  const add=(area,message)=>issues.push({area,message,batch,link});
  for(const error of seatErrors(draft))add('seats',error);
  const unidentified=draft.seats.filter(seat=>!seat.studentId).length;
  if(unidentified)add('seats',`${unidentified} 个座位的学生身份尚未确认。`);
  const live=draft.sessions.filter(s=>!s.cancelled),byId=new Map(live.map(s=>[s.id,s]));
  const taken=new Map();
  for(const seat of draft.seats){if(!seat.studentId)continue;const list=taken.get(seat.studentId)||[];list.push(...examIds(seat).map(id=>byId.get(id)).filter(Boolean));taken.set(seat.studentId,list);}
  for(const [,sessions] of taken)for(let i=0;i<sessions.length;i++)for(let j=i+1;j<sessions.length;j++)
   if(sessions[i].id!==sessions[j].id&&overlap(sessions[i],sessions[j])){const seat=draft.seats.find(s=>examIds(s).includes(sessions[i].id));add('seats',`${seat?.name||'学生'} 同时安排在“${sessions[i].title}”和“${sessions[j].title}”。`);}
  for(const s of live)if(dayOff(s.date))add('sessions',`“${s.title}”安排在放假日 ${s.date}。`);
  // The same course twice for one grade at overlapping times is almost always a duplicate.
  for(let i=0;i<live.length;i++)for(let j=i+1;j<live.length;j++){
   const a=live[i],b=live[j];
   if(course(a)===course(b)&&a.grades.some(g=>b.grades.includes(g))&&overlap(a,b))add('sessions',`“${a.title}”与“${b.title}”是同一年级同一课程，时间重叠。`);
  }
  if(info.scheduleChanged)add('publish','考试安排有尚未发布的修改。');
  if(info.seatingChanged)add('publish','座位表有尚未发布的修改。');
  return issues;
 }));
}
