export const defaultExamSlots=[{start:'08:10',end:'09:40'},{start:'11:00',end:'12:30'},{start:'13:40',end:'15:10'},{start:'15:40',end:'17:10'},{start:'19:00',end:'20:00'}];
const minutes=time=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
/**
 * The slot a session belongs to: the one containing its start, or else the slot it overlaps most when it
 * starts early (an early paper sits with the regular block it runs into). `early` marks the latter.
 */
export function slotOf(slots,exam){
 const index=slots.findIndex(slot=>slot.start<=exam.start&&exam.start<slot.end);
 if(index>=0)return {index,early:false};
 let best=-1,overlap=0;
 slots.forEach((slot,i)=>{
  if(exam.start>=slot.start)return;
  const shared=Math.min(minutes(exam.end),minutes(slot.end))-minutes(slot.start);
  if(shared>overlap){best=i;overlap=shared;}
 });
 return best>=0?{index:best,early:true}:null;
}
// Retain actual exam times, including longer papers; `early` holds the ids that start before their slot.
export function examSlotRows(slots,sessions){
 const rows=(slots||defaultExamSlots).map(slot=>({...slot,sessions:[],early:new Set()}));
 const slotted=rows.length;
 for(const exam of sessions){
  const found=slotOf(rows.slice(0,slotted),exam);
  let row=found?rows[found.index]:rows.slice(slotted).find(row=>row.start<=exam.start&&exam.start<row.end);
  if(!row){row={start:exam.start,end:exam.end,sessions:[],early:new Set()};rows.push(row);}
  row.sessions.push(exam);
  if(found?.early)row.early.add(exam.id);
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
