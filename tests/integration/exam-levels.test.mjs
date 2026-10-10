import {test} from 'node:test';
import assert from 'node:assert/strict';
import {examSlotRows,groupExamLevels,slotOf} from '../../public/exam-times.mjs';
import {batchSchema,schedule} from '../../server/exam-model.mjs';
test('level groups preserve independent sessions and separate date, division and slot',()=>{
 const base={title:'Math',subject:'Math',level:'HL',division:'high',grades:[12],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['A']};
 const sessions=[{...base,id:'hl'},{...base,id:'sl',level:'SL',end:'09:10'},{...base,id:'g11',grades:[11]},{...base,id:'middle',division:'middle',grades:[8]},{...base,id:'tomorrow',date:'2026-09-22'},{...base,id:'afternoon',start:'13:40',end:'15:10'},{...base,id:'ungrouped',subject:'',level:''}];
 const batch=batchSchema.parse({title:'Test',start:'2026-09-21',end:'2026-09-22',sessions,rooms:[{name:'A',rows:5,columns:5}],seats:[]});
 const published=schedule(batch);assert.equal(published.sessions[1].level,'SL');
 const rows=examSlotRows(batch.timeSlots,published.sessions);
 const grouped=rows.flatMap(row=>groupExamLevels(row.sessions));
 assert.deepEqual(grouped.find(group=>group.length===2).map(s=>s.id),['hl','sl']);
 assert.equal(grouped.flat().length,sessions.length);
 assert.equal(grouped.filter(group=>group.length===1).length,5);
 assert.equal(batchSchema.safeParse({...batch,sessions:[{...base,id:'bad',subject:''}]}).success,false);
});

test('an early paper joins the slot it runs into and is flagged, while a late one is not',()=>{
 const base={title:'English',subject:'英语',division:'high',grades:[11],date:'2026-09-21',rooms:['A']};
 const sessions=[{...base,id:'early',level:'B HL',start:'10:30',end:'12:30'},{...base,id:'late',level:'B SL',start:'11:15',end:'12:30'},{...base,id:'apart',level:'B SL',start:'10:00',end:'10:45'}];
 const rows=examSlotRows([{start:'08:10',end:'09:40'},{start:'11:00',end:'12:30'}],sessions);
 const slot=rows.find(row=>row.start==='11:00');
 assert.deepEqual(slot.sessions.map(s=>s.id),['early','late']);assert.deepEqual([...slot.early],['early']);
 assert.deepEqual(groupExamLevels(slot.sessions).map(group=>group.length),[2]);
 assert.deepEqual(rows.find(row=>row.start==='10:00').sessions.map(s=>s.id),['apart']);
 assert.equal(slotOf([{start:'11:00',end:'12:30'}],sessions[2]),null);
});

