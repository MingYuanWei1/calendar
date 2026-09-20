import {test} from 'node:test';
import assert from 'node:assert/strict';
import {examSlotRows,groupExamLevels} from '../../public/exam-times.mjs';
import {batchSchema,schedule} from '../../server/exam-model.mjs';
test('level groups preserve independent sessions and separate date, division and slot',()=>{
 const base={title:'Math',subject:'Math',level:'HL',division:'high',grades:['G12'],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['A']};
 const sessions=[{...base,id:'hl'},{...base,id:'sl',level:'SL',end:'09:10'},{...base,id:'g11',grades:['G11']},{...base,id:'middle',division:'middle'},{...base,id:'tomorrow',date:'2026-09-22'},{...base,id:'afternoon',start:'13:40',end:'15:10'},{...base,id:'ungrouped',subject:'',level:''}];
 const batch=batchSchema.parse({title:'Test',start:'2026-09-21',end:'2026-09-22',sessions,rooms:[{name:'A',rows:5,columns:5}],seats:[]});
 const published=schedule(batch);assert.equal(published.sessions[1].level,'SL');
 const rows=examSlotRows(batch.timeSlots,published.sessions);
 const grouped=rows.flatMap(row=>groupExamLevels(row.sessions));
 assert.deepEqual(grouped.find(group=>group.length===2).map(s=>s.id),['hl','sl']);
 assert.equal(grouped.flat().length,sessions.length);
 assert.equal(grouped.filter(group=>group.length===1).length,5);
 assert.equal(batchSchema.safeParse({...batch,sessions:[{...base,id:'bad',subject:''}]}).success,false);
});
