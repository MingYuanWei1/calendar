import {placed,seatExamIds} from './exam-seats.mjs';
import {defaultExamSlots} from './exam-times.mjs';

// 预览并发布: what the draft changes against the published schedule or seating, so the preview lists only that.
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const SESSION_FIELDS=['title','titleEn','subject','subjectEn','level','division','grades','date','start','end','rooms','cancelled','note'];
const BATCH_FIELDS=['title','titleEn','start','end','timeSlots'];
const room=({sizeReview,...r})=>r;

/** Rooms added, removed or resized between two room lists. */
function roomsDiff(before,after){
 const find=(list,name)=>list.find(r=>r.name===name);
 return {
  added:after.filter(r=>!find(before,r.name)).map(room),
  removed:before.filter(r=>!find(after,r.name)).map(room),
  resized:after.filter(r=>{const old=find(before,r.name);return old&&(old.rows!==r.rows||old.columns!==r.columns);}).map(r=>({before:room(find(before,r.name)),after:room(r)}))
 };
}
const roomsEmpty=r=>!r.added.length&&!r.removed.length&&!r.resized.length;

/**
 * The schedule changes: batch fields [{field,before,after}], sessions added / removed / changed ({before,after,fields}),
 * and rooms. `empty` is true when publishing would change nothing students see.
 */
export function scheduleDiff(published,draft){
 const get=(b,f)=>f==='timeSlots'?b.timeSlots||defaultExamSlots:b[f];
 const batch=BATCH_FIELDS.filter(f=>!same(get(published,f),get(draft,f))).map(field=>({field,before:get(published,field),after:get(draft,field)}));
 const old=new Map(published.sessions.map(s=>[s.id,s]));
 const added=[],changed=[];
 for(const s of draft.sessions){
  const before=old.get(s.id);
  if(!before){added.push(s);continue;}
  const fields=SESSION_FIELDS.filter(f=>!same(before[f]??'',s[f]??''));
  if(fields.length)changed.push({before,after:s,fields});
 }
 const removed=published.sessions.filter(s=>!draft.sessions.some(x=>x.id===s.id));
 const rooms=roomsDiff(published.rooms,draft.rooms);
 return {batch,added,removed,changed,rooms,empty:!batch.length&&!added.length&&!removed.length&&!changed.length&&roomsEmpty(rooms)};
}

// Seats compare without the details the server adds (student matches, inferred grade, matchEmail).
const seatValue=({student,identityIssues,candidates,matchEmail,grade,...seat})=>seat;
const seatJson=seat=>JSON.stringify(seatValue(seat),Object.keys(seatValue(seat)).sort());
/** One student in one exam: the same key before and after means the seat moved or its student link changed. */
const seatKey=seat=>[seat.className,seat.name,seat.englishName,seatExamIds(seat).join(',')].join('\u0000');

/**
 * The seating changes: rooms added / removed / resized, and seats added, removed or changed ({before,after}: moved to
 * another room or place, or edited). Unchanged seats are left out. `empty` is true when nothing differs.
 */
export function seatingDiff(published,draft){
 const rooms=roomsDiff(published.rooms,draft.rooms);
 const left=new Map();
 for(const seat of published.seats){const k=seatJson(seat);left.set(k,[...(left.get(k)||[]),seat]);}
 const fresh=[];
 for(const seat of draft.seats){const k=seatJson(seat),list=left.get(k);if(list?.length)list.pop();else fresh.push(seat);}
 const gone=[...left.values()].flat();
 const changed=[],added=[];
 for(const seat of fresh){
  const i=gone.findIndex(old=>seatKey(old)===seatKey(seat));
  if(i<0){added.push(seat);continue;}
  changed.push({before:gone[i],after:seat});gone.splice(i,1);
 }
 return {rooms,added,removed:gone,changed,empty:roomsEmpty(rooms)&&!added.length&&!gone.length&&!changed.length};
}

/** A seat's place, e.g. "101 · 2 排 3 列", or just the room for an unordered seat. */
export const seatPlace=(seat,english)=>placed(seat)?(english?`${seat.room} · row ${seat.row}, col ${seat.column}`:`${seat.room} · ${seat.row} 排 ${seat.column} 列`):seat.room;
