import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseStudent,examsLabel,mergeSeats,pickMerge,moveSeat,roomExamsAt,seatExamIds,seatViewTimes,withoutExam} from '../../public/exam-seats.mjs';
import {seatingMarkup} from '../../public/exam-common.js';
import {seatErrors} from '../../server/exam-model.mjs';
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

test('imported seats merge into the draft: new seats append, moved or reassigned seats are corrections',()=>{
 const draft=[
  {examId:'a',room:'A',row:1,column:1,className:'10-1',name:'甲',studentId:'s1'},
  {examId:'a',room:'A',row:1,column:2,className:'10-1',name:'乙',studentId:'s2'},
  {examId:'a',room:'A',row:2,column:1,className:'10-1',name:'丙',studentId:'s3'},
  {examId:'b',room:'A',row:1,column:1,className:'10-1',name:'甲',studentId:'s1'}];
 const imported=[
  {examId:'a',room:'A',row:1,column:1,className:'10-1',name:'甲',studentId:'s1'},
  {examId:'a',room:'A',row:3,column:3,className:'10-1',name:'乙',studentId:'s2'},
  {examId:'a',room:'A',row:2,column:1,className:'10-2',name:'丁',studentId:'s4'},
  {examId:'a',room:'A',row:4,column:4,className:'10-2',name:'戊',studentId:'s5'}];
 const result=mergeSeats(draft,imported);
 assert.equal(result.unchanged,1);
 assert.deepEqual(result.added.map(s=>s.name),['戊']);
 assert.deepEqual(result.changed.map(c=>[c.before.map(s=>s.name),c.after.name]),[[['乙'],'乙'],[['丙'],'丁']]);
 assert.deepEqual(result.seats.map(s=>s.examId+s.name+s.row+s.column),['b甲11','a甲11','a乙33','a丁21','a戊44']);
});

test('undecided seats list every candidate exam and narrow when one is removed',()=>{
 assert.equal(examsLabel(['Chinese B','Chinese Honor']),'Chinese B / Honor');
 assert.equal(examsLabel(['数学 HL','物理 SL']),'数学 HL / 物理 SL');assert.equal(examsLabel(['Math']),'Math');
 const seat={examId:'a',examIds:['a','b','c'],room:'A',row:1,column:1};
 assert.deepEqual(seatExamIds(seat),['a','b','c']);assert.deepEqual(seatExamIds({examId:'a'}),['a']);
 assert.deepEqual(withoutExam(seat,'a'),{examId:'b',examIds:['b','c'],room:'A',row:1,column:1});
 assert.deepEqual(withoutExam(withoutExam(seat,'a'),'c'),{examId:'b',room:'A',row:1,column:1});
 assert.equal(withoutExam({examId:'a'},'a'),null);
 // Deciding an undecided seat is a correction, not an unchanged seat.
 const merged=mergeSeats([{...seat,name:'X'}],[{examId:'a',room:'A',row:1,column:1,name:'X'}]);
 assert.equal(merged.changed.length,1);
 const batch={sessions:[{id:'a',title:'Chinese B',date:'2026-09-21',start:'08:10',end:'09:40',rooms:['A']},{id:'b',title:'Chinese Honor',date:'2026-09-21',start:'08:10',end:'09:40',rooms:['A']}],rooms:[{name:'A',rows:1,columns:1}]};
 const html=seatingMarkup(batch,{rooms:batch.rooms,seats:[{examId:'a',examIds:['a','b'],room:'A',row:1,column:1,className:'10.1',name:'学生',englishName:''}]},batch.sessions[1],'A','08:10',1,false,{room:'A',row:1,column:1});
 assert.match(html,/Chinese B \/ Honor/);assert.match(html,/my-seat/);
 // Candidates must share the room and the time.
 assert.deepEqual(seatErrors(batch,[{examId:'a',examIds:['a','b'],room:'A',row:1,column:1}]),[]);
 const apart={...batch,sessions:[batch.sessions[0],{...batch.sessions[1],start:'10:00',end:'11:00'}]};
 assert.match(seatErrors(apart,[{examId:'a',examIds:['a','b'],room:'A',row:1,column:1}]).join(''),/不在同一时段/);
});

test('an identified namesake keeps its student on re-import and one choice covers the student\'s other exams',()=>{
 const seat={examId:'a',room:'A',row:1,column:1,className:'11.5',name:'王小明',englishName:'Ming'};
 const merged=mergeSeats([{...seat,studentId:'s1'}],[{...seat,candidates:[{id:'s1'},{id:'s2'}]}]);
 assert.equal(merged.seats[0].studentId,'s1');assert.equal(merged.seats[0].candidates,undefined);
 const ambiguous={...seat,candidates:[{id:'s1'},{id:'s2'}]};
 const seats=[ambiguous,{...ambiguous,examId:'b'},{...ambiguous,column:2},{...ambiguous,examId:'c',className:'11.6'}];
 assert.deepEqual(chooseStudent(seats,0,'s1').map(s=>s.studentId),['s1','s1',undefined,undefined]);
 assert.deepEqual(chooseStudent(seats,0,'new').map(s=>s.newStudent),[true,true,undefined,undefined]);
 assert.deepEqual(chooseStudent(chooseStudent(seats,0,'new'),0,'s2').map(s=>s.studentId),['s2','s2',undefined,undefined]);
});

test('draft seats a partial import leaves out are only offered for removal, and only within the exams and rooms it covers',()=>{
 const draft=[
  {examId:'a',room:'A',row:1,column:1,name:'甲',studentId:'s1'},
  {examId:'a',room:'A',row:1,column:2,name:'乙',studentId:'s2'},
  {examId:'a',room:'B',row:1,column:1,name:'丙',studentId:'s3'},
  {examId:'b',room:'A',row:1,column:1,name:'丁',studentId:'s4'}];
 const imported=[{examId:'a',room:'A',row:2,column:2,name:'甲',studentId:'s1'},{examId:'a',room:'A',row:3,column:3,name:'戊',studentId:'s5'}];
 const merge=mergeSeats(draft,imported);
 assert.deepEqual(merge.removed.map(r=>r.seat.name),['乙']);
 // By default nothing is removed; untick the correction and tick the removal instead.
 assert.deepEqual(merge.seats.map(s=>s.name+s.row),['乙1','丙1','丁1','甲2','戊3']);
 assert.deepEqual(pickMerge(draft,merge,{entries:new Set([1]),removed:new Set([0])}).map(s=>s.name+s.row),['甲1','丙1','丁1','戊3']);
});
