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

// A seat is known by its student (by name and class until the student is identified) and the exams it may be for:
// one exam, or several sharing a room and time when the plan does not say which one the student takes
// (e.g. Chinese A HL / SL). Such a seat is still one seat for one exam.
const who=seat=>seat.studentId||`n:${seat.name}|${seat.className}`;
const seatKey=seat=>`${who(seat)}|${examIds(seat).join('/')}`;
const sameSet=(a,b)=>examIds(a).length===examIds(b).length&&examIds(a).every(id=>examIds(b).includes(id));
/**
 * Compares the seating plan with the draft's seats, identifying each reference row's student the way an import does
 * (`organize`). A row and a draft seat of one student match when they may be for the same exam; a row that names the
 * exam a still undecided draft seat is for decides it. In unordered mode only rooms are compared. Rows whose student
 * is unresolved are left to the administrator.
 */
export function compareSeats(rows,draft,organize,mode='ordered'){
 const organized=organize({...draft,seats:rows.map(withoutSource)},false).seats;
 const matched=new Set(),items=[];
 const titles=seat=>examIds(seat).map(id=>draft.sessions.find(s=>s.id===id)?.title||id).join(' / ');
 const label=seat=>`${seat.name||seat.englishName} · ${titles(seat)}`;
 organized.forEach((seat,index)=>{
  const row=rows[index],base={key:`r${index}`,title:label(seat),row,source:row.source||null,changes:[]};
  if(seat.candidates)return items.push({...base,status:'ambiguous',seat:null,candidates:seat.candidates,note:'身份不明确，请先在考试页处理身份匹配冲突。',apply:false});
  const open=draft.seats.filter(d=>!matched.has(d)&&who(d)===who(seat)&&examIds(d).some(id=>examIds(seat).includes(id)));
  const found=open.find(d=>sameSet(d,seat))||open[0];
  if(!found)return items.push({...base,status:'missing',seat:null,studentId:seat.studentId||null,apply:true});
  matched.add(found);
  const changes=[];
  if(examIds(seat).length===1&&!sameSet(found,seat))changes.push({field:'exam',from:titles(found),to:titles(seat)});
  if(found.room!==seat.room)changes.push({field:'room',from:found.room,to:seat.room});
  if(mode==='ordered'&&seat.row&&(found.row!==seat.row||found.column!==seat.column))changes.push({field:'position',from:found.row?`${found.row}-${found.column}`:'',to:`${seat.row}-${seat.column}`});
  items.push({...base,status:changes.length?'mismatch':'ok',seat:found,changes,apply:changes.length>0});
 });
 for(const seat of draft.seats)if(!matched.has(seat))items.push({key:`x:${seatKey(seat)}`,title:label(seat),status:'extra',row:null,source:null,seat,changes:[],apply:true});
 return {items};
}
/** The draft with the chosen seat items applied; rooms grow to fit the seats. */
export function applySeatItems(draft,items){
 const next=structuredClone(draft);
 for(const item of items){
  if(item.status==='missing'){const {grade,...seat}=withoutSource(item.row);next.seats.push(item.studentId?{...seat,studentId:item.studentId}:seat);continue;}
  const i=next.seats.findIndex(seat=>seatKey(seat)===seatKey(item.seat));if(i<0)continue;
  if(item.status==='extra'){next.seats.splice(i,1);continue;}
  const {room,row,column,examId}=item.row,changed=field=>item.changes.some(c=>c.field===field);
  const {examIds:_,...kept}=next.seats[i];
  next.seats[i]={...(changed('exam')?{...kept,examId}:next.seats[i]),room,...(changed('position')?{row,column}:{})};
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
  // A student clashes only across two seats; one seat's candidate exams (HL / SL) share their time by design.
  const seatsOf=new Map();
  for(const seat of draft.seats)if(seat.studentId)seatsOf.set(seat.studentId,[...(seatsOf.get(seat.studentId)||[]),seat]);
  const sessionsOf=seat=>examIds(seat).map(id=>byId.get(id)).filter(Boolean);
  for(const [,seats] of seatsOf)for(let i=0;i<seats.length;i++)for(let j=i+1;j<seats.length;j++){
   const clash=sessionsOf(seats[i]).flatMap(a=>sessionsOf(seats[j]).filter(b=>a.id!==b.id&&overlap(a,b)).map(b=>[a,b]))[0];
   if(clash)add('seats',`${seats[i].name||'学生'} 同时安排在“${clash[0].title}”和“${clash[1].title}”。`);
  }
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
