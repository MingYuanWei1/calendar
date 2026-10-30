import {seatExamIds} from './exam-seats.mjs';

// 导入考试安排: extracted sessions either add a new exam or change one draft exam (targetId). Nothing is ever
// deleted from the material: the material may show only part of the timetable.
export const SESSION_FIELDS=['title','subject','level','division','date','start','end'];
const LIST_FIELDS=['grades','rooms'];
const value=(s,f)=>LIST_FIELDS.includes(f)?(s[f]||[]).join(','):String(s[f]??'');
/** The fields an extracted session would change on its draft exam. */
export const changedFields=(target,item)=>[...SESSION_FIELDS,...LIST_FIELDS].filter(f=>value(target,f)!==value(item,f));

/**
 * Applies the picked rows to a copy of the draft. Each row is {item, targetId}: with a targetId still in the draft
 * the exam is changed in place (keeping its id, cancellation and note), otherwise item is added as a new exam.
 * Rooms named by the exams are added at 5 × 5. Seats in a room their exam no longer uses are removed.
 * Rooms that the import leaves without exams and seats are reported as `emptied`, not removed.
 */
export function applySessions(draft,rows){
 const next=structuredClone(draft);let added=0,changed=0;
 for(const {item,targetId} of rows){
  const {targetId:_,source,...fields}=item;
  const i=targetId?next.sessions.findIndex(s=>s.id===targetId):-1;
  if(i<0){next.sessions.push(fields);added++;continue;}
  const kept=next.sessions[i];
  next.sessions[i]={...kept,...Object.fromEntries([...SESSION_FIELDS,...LIST_FIELDS].map(f=>[f,fields[f]])),
   titleEn:fields.titleEn||kept.titleEn,subjectEn:fields.subjectEn||kept.subjectEn,id:kept.id};
  changed++;
 }
 const newRooms=[...new Set(next.sessions.flatMap(s=>s.rooms))].filter(name=>!next.rooms.some(r=>r.name===name));
 next.rooms.push(...newRooms.map(name=>({name,rows:5,columns:5})));
 const dropped=next.seats.filter(seat=>seatExamIds(seat).some(id=>{const s=next.sessions.find(x=>x.id===id);return s&&!s.rooms.includes(seat.room);}));
 next.seats=next.seats.filter(seat=>!dropped.includes(seat));
 const used=b=>name=>b.sessions.some(s=>s.rooms.includes(name))||b.seats.some(s=>s.room===name);
 const emptied=draft.rooms.map(r=>r.name).filter(name=>used(draft)(name)&&!used(next)(name));
 return {batch:next,added,changed,dropped,newRooms,emptied};
}
/** Removes rooms by name (the import's emptied rooms the administrator ticked). */
export const withoutRooms=(b,names)=>({...b,rooms:b.rooms.filter(r=>!names.includes(r.name))});
