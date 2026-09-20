import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moveSeat,roomExamsAt,seatViewTimes} from '../../public/exam-seats.mjs';
import {seatingMarkup} from '../../public/exam-common.js';
test('seat moves and swaps preserve identities and reject concurrent occupancy',()=>{
 const batch={rooms:[{name:'A',rows:3,columns:3}],sessions:[{id:'a',date:'2026-09-21',start:'08:10',end:'09:40'},{id:'b',date:'2026-09-21',start:'09:00',end:'10:00'}],seats:[{examId:'a',room:'A',row:1,column:1,name:'A'},{examId:'a',room:'A',row:1,column:2,name:'B'},{examId:'b',room:'A',row:3,column:3,name:'C'}]};
 assert.equal(moveSeat(batch,0,2,1),true);assert.equal(batch.seats[0].row,2);
 moveSeat(batch,0,1,2);assert.deepEqual(batch.seats.slice(0,2).map(s=>[s.name,s.row,s.column]),[['A',1,2],['B',2,1]]);
 const before=JSON.stringify(batch);assert.throws(()=>moveSeat(batch,0,3,3),/占用/);assert.throws(()=>moveSeat(batch,0,4,1),/无效/);assert.equal(JSON.stringify(batch),before);
});

test('mixed rooms restrict exam options to the selected time and room; swaps retain exam assignments',()=>{
 const exam={id:'hl',date:'2026-09-21',start:'08:10',end:'09:40',rooms:['101']};
 const batch={rooms:[{name:'101',rows:2,columns:2}],sessions:[exam,{...exam,id:'sl',end:'09:10'},{...exam,id:'later',start:'11:00',end:'12:30'},{...exam,id:'other-room',rooms:['102']},{...exam,id:'tomorrow',date:'2026-09-22'}],seats:[{examId:'hl',room:'101',row:1,column:1,name:'A'},{examId:'sl',room:'101',row:1,column:2,name:'B'}]};
 const eligible=roomExamsAt(batch,exam,'101',exam.start).map(s=>s.id);assert.deepEqual(eligible,['hl','sl']);
 moveSeat(batch,0,1,2,eligible);assert.deepEqual(batch.seats.map(s=>[s.examId,s.column]),[['hl',2],['sl',1]]);
});

test('seat maps show the occupants at the selected time when a seat is reused',()=>{
 const sessions=[
  {id:'early',title:'Early',date:'2026-09-21',start:'08:00',end:'08:30',rooms:['101']},
  {id:'late',title:'Late',date:'2026-09-21',start:'08:30',end:'09:00',rooms:['101']},
  {id:'long',title:'Long',date:'2026-09-21',start:'08:20',end:'09:30',rooms:['101']},
  {id:'next',title:'Next',date:'2026-09-21',start:'09:00',end:'09:30',rooms:['101']}
 ];
 const batch={sessions,rooms:[{name:'101',rows:1,columns:2}],seats:[
  {examId:'early',room:'101',row:1,column:1,className:'A',name:'Early student',englishName:''},
  {examId:'late',room:'101',row:1,column:1,className:'B',name:'Late student',englishName:''},
  {examId:'long',room:'101',row:1,column:2,className:'C',name:'Long student',englishName:''},
  {examId:'next',room:'101',row:1,column:1,className:'D',name:'Next student',englishName:''}
 ]};
 const late=sessions[1],long=sessions[2];
 assert.deepEqual(roomExamsAt(batch,late,'101',late.start).map(s=>s.id),['late','long']);
 assert.deepEqual(seatViewTimes(batch,long,'101'),['08:20','08:30','09:00']);
 const lateMap=seatingMarkup(batch,batch,late,'101','08:30');
 assert.match(lateMap,/Late student/);assert.match(lateMap,/Long student/);
 assert.doesNotMatch(lateMap,/Early student|Next student/);
 const nextMap=seatingMarkup(batch,batch,long,'101','09:00');
 assert.match(nextMap,/Next student/);assert.match(nextMap,/Long student/);
 assert.doesNotMatch(nextMap,/Early student|Late student/);
});
