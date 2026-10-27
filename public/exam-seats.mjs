/**
 * The exams a seat belongs to. When a room hosts several exams at once and the seating sheet does not say which one a
 * student sits, the seat lists them all in `examIds` (its `examId` is the first) and is shown as e.g. "Chinese B / Honor".
 */
export const seatExamIds=seat=>seat.examIds?.length?seat.examIds:[seat.examId];
/**
 * Whether a seat has a place in the room. An exam is seated either in order (every seat has a row and column) or
 * without order (each room only lists its students); exams sharing a room at the same time use the same mode.
 */
export const placed=seat=>Number.isInteger(seat.row)&&Number.isInteger(seat.column);
/** 'ordered', 'unordered', or null for an exam with no seats yet. */
export function examMode(seats,examId){
 const seat=seats.find(s=>seatExamIds(s).includes(examId));
 return seat?(placed(seat)?'ordered':'unordered'):null;
}
/**
 * The incoming seats that do not match the mode of the seats around them: other seats of the same exam, or seats of
 * exams sharing the room at the same time. Returns one message per exam and room.
 */
export function modeConflicts(sessions,existing,incoming){
 const exams=new Map(sessions.map(s=>[s.id,s])),modes=new Map(),key=(id,room)=>id+'\u0000'+(room??'');
 const note=(id,room,mode)=>{for(const k of [key(id),key(id,room)]){if(!modes.has(k))modes.set(k,new Set());modes.get(k).add(mode);}};
 for(const seat of [...existing,...incoming])for(const id of seatExamIds(seat))note(id,seat.room,placed(seat));
 const messages=new Map();
 for(const seat of incoming){
  const mode=placed(seat),ids=seatExamIds(seat),exam=exams.get(ids[0]);if(!exam)continue;
  const other=k=>modes.get(k)?.has(!mode);
  const sharing=sessions.filter(s=>s.date===exam.date&&s.start<exam.end&&exam.start<s.end&&s.rooms.includes(seat.room)&&!ids.includes(s.id));
  if(!ids.some(id=>other(key(id)))&&!sharing.some(s=>other(key(s.id,seat.room))))continue;
  const label=`${exam.title} · ${seat.room}`;
  if(!messages.has(label))messages.set(label,`${label}：与该场考试其他座位冲突（已有${mode?'不排序':'按座位排序'}的座位）`);
 }
 return [...messages.values()];
}
/** Removes one exam from a seat: an undecided seat narrows to the rest, a seat left without an exam becomes null. */
export function withoutExam(seat,id){
 const ids=seatExamIds(seat).filter(x=>x!==id);
 if(!ids.length)return null;
 const {examIds,...rest}=seat;
 return ids.length>1?{...rest,examId:ids[0],examIds:ids}:{...rest,examId:ids[0]};
}
/** Joins exam names, keeping their shared leading words once: ["Chinese B","Chinese Honor"] → "Chinese B / Honor". */
export function examsLabel(names){
 if(names.length<2)return names[0]||'';
 const words=names.map(n=>n.split(' '));let shared=0;
 while(words.every(w=>w.length>shared+1&&w[shared]===words[0][shared]))shared++;
 return shared?`${words[0].slice(0,shared).join(' ')} ${words.map(w=>w.slice(shared).join(' ')).join(' / ')}`:names.join(' / ');
}
export function roomExamsAt(batch,exam,room,point){
 return batch.sessions.filter(s=>!s.cancelled&&s.date===exam.date&&s.rooms.includes(room)&&s.start<=point&&point<s.end);
}
export function seatViewTimes(batch,exam,room){
 const times=new Set([exam.start]);
 for(const s of batch.sessions){
  if(s.cancelled||s.date!==exam.date||!s.rooms.includes(room))continue;
  for(const time of [s.start,s.end])if(exam.start<time&&time<exam.end)times.add(time);
 }
 return [...times].sort();
}
export function moveSeat(batch,index,row,column,examIds=null){
 const seat=batch.seats[index],exam=seat&&batch.sessions.find(s=>s.id===seat.examId),room=seat&&batch.rooms.find(r=>r.name===seat.room);
 if(!exam||!room||!Number.isInteger(row)||!Number.isInteger(column)||row<1||row>room.rows||column<1||column>room.columns)throw new Error('目标座位无效');
 if(seat.row===row&&seat.column===column)return false;
 const eligible=examIds||[seat.examId];
 const target=batch.seats.find(s=>s.room===seat.room&&eligible.includes(s.examId)&&s.row===row&&s.column===column);
 const occupied=(moving,r,c)=>{const source=batch.sessions.find(e=>e.id===moving.examId);return batch.seats.some(s=>s!==seat&&s!==target&&s.room===moving.room&&s.row===r&&s.column===c&&batch.sessions.some(e=>e.id===s.examId&&e.date===source.date&&e.start<source.end&&source.start<e.end));};
 if(occupied(seat,row,column)||(target&&occupied(target,seat.row,seat.column)))throw new Error('该座位已被同一时间的其他考试占用，请选择其他位置。');
 if(target){target.row=seat.row;target.column=seat.column;}
 seat.row=row;seat.column=column;return true;
}
export const ROOM_MAX=40;
/**
 * Grows rooms so every seat fits: a seating sheet may hold more rows or columns than the room was set up with
 * (rooms from session extraction start at 5 × 5). Rooms only grow, never shrink, and each grown room is flagged
 * `sizeReview` until an administrator confirms it. Sizes beyond ROOM_MAX stay as they are, so seatErrors reports them.
 */
export function adaptRooms(batch,seats=batch.seats){
 const changes=[];
 const rooms=batch.rooms.map(room=>{
  const own=seats.filter(s=>s.room===room.name&&placed(s));
  const rows=Math.max(room.rows,...own.map(s=>s.row)),columns=Math.max(room.columns,...own.map(s=>s.column));
  if((rows===room.rows&&columns===room.columns)||rows>ROOM_MAX||columns>ROOM_MAX)return room;
  changes.push({name:room.name,from:{rows:room.rows,columns:room.columns},to:{rows,columns}});
  return {...room,rows,columns,sizeReview:true};
 });
 return {rooms,changes};
}
/**
 * Merges imported seats into the draft instead of replacing it. Within one exam, an imported seat takes over the draft
 * seats of the same student and any draft seat at the same position; seats the import does not mention are kept.
 * Returns the merged list plus which imported seats were added, unchanged, or corrected (with the seats they replaced).
 */
export function mergeSeats(existing,incoming){
 const who=s=>JSON.stringify([s.name||'',s.englishName||'',s.className||'']);
 const sameStudent=(a,b)=>a.studentId&&b.studentId?a.studentId===b.studentId:who(a)===who(b);
 const fields=['room','row','column','className','name','englishName'];
 const same=(a,b)=>fields.every(f=>(a[f]??'')===(b[f]??''))&&seatExamIds(a).join()===seatExamIds(b).join()&&(a.grade==null||b.grade==null||a.grade===b.grade);
 const replaced=new Set(),added=[],changed=[],merged=[];let unchanged=0;
 for(let seat of incoming){
  const before=existing.filter((s,i)=>!replaced.has(i)&&s.examId===seat.examId&&(sameStudent(s,seat)||(placed(s)&&placed(seat)&&s.room===seat.room&&s.row===seat.row&&s.column===seat.column)));
  before.forEach(s=>replaced.add(existing.indexOf(s)));
  // A namesake the administrator already identified in the draft keeps that choice when the sheet is imported again.
  if(!seat.studentId&&!seat.newStudent&&before.length===1&&before[0].studentId&&who(before[0])===who(seat)){const {candidates:_,...rest}=seat;seat={...rest,studentId:before[0].studentId};}
  if(!before.length)added.push(seat);
  else if(before.length===1&&same(before[0],seat))unchanged++;
  else changed.push({before,after:seat});
  merged.push(seat);
 }
 return {seats:[...existing.filter((_,i)=>!replaced.has(i)),...merged],added,changed,unchanged};
}

/** A seat's student choice: a student id, 'new' for a new student, or '' while undecided. */
export const studentChoice=s=>s.newStudent?'new':s.studentId||'';
/** Identifies an ambiguous seat as one candidate student (or 'new'); the same person's seats in other exams that had
 * the same choice follow it. */
export function chooseStudent(seats,index,choice){
 const who=s=>JSON.stringify([s.name||'',s.englishName||'',s.className||'']),seat=seats[index];
 const set=s=>{const {studentId:_,newStudent:__,...rest}=s;return choice==='new'?{...rest,newStudent:true}:choice?{...rest,studentId:choice}:rest;};
 return seats.map((s,i)=>i===index||(s.candidates?.length&&studentChoice(s)===studentChoice(seat)&&who(s)===who(seat)&&!seatExamIds(s).some(id=>seatExamIds(seat).includes(id)))?set(s):s);
}
