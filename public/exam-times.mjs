export const defaultExamSlots=[{start:'08:10',end:'09:40'},{start:'11:00',end:'12:30'},{start:'13:40',end:'15:10'},{start:'15:40',end:'17:10'},{start:'19:00',end:'20:00'}];
// Group by start time; retain actual exam times, including longer papers.
export function examSlotRows(slots,sessions){
 const rows=(slots||defaultExamSlots).map(slot=>({...slot,sessions:[]}));
 for(const exam of sessions){
  let row=rows.find(row=>row.start<=exam.start&&exam.start<row.end);
  if(!row){row={start:exam.start,end:exam.end,sessions:[]};rows.push(row);}
  row.sessions.push(exam);
 }
 return rows.sort((a,b)=>a.start.localeCompare(b.start));
}

// Called within one date/time-slot cell; division remains part of the grouping key.
export function groupExamLevels(sessions){
 const groups=new Map();
 for(const exam of sessions){
  const key=exam.subject&&exam.level?JSON.stringify([exam.division,exam.date,exam.subject,[...exam.grades].sort()]):exam.id;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(exam);
 }
 return [...groups.values()];
}
