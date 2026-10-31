import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduleDiff,seatingDiff} from '../../public/exam-publish-diff.mjs';

const exam=(id,extra={})=>({id,title:'数学',titleEn:'',subject:'数学',subjectEn:'',level:'',division:'high',grades:[10],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['101'],cancelled:false,note:'',...extra});
const batch=extra=>({title:'期中',titleEn:'',start:'2026-09-21',end:'2026-09-25',timeSlots:[{start:'08:10',end:'09:40'}],rooms:[{name:'101',rows:5,columns:5}],sessions:[exam('a'),exam('b',{title:'物理'})],seats:[],...extra});

test('the schedule preview lists only added, changed and removed sessions, batch fields and rooms',()=>{
 const published={...batch(),sessions:batch().sessions.map(s=>({...s,changed:false}))};
 assert.equal(scheduleDiff(published,batch()).empty,true);
 const draft=batch({title:'期中考试',rooms:[{name:'101',rows:6,columns:5,sizeReview:true},{name:'102',rows:5,columns:5}],sessions:[exam('a',{date:'2026-09-22',cancelled:true}),exam('c',{rooms:['102']})]});
 const d=scheduleDiff(published,draft);
 assert.deepEqual(d.batch.map(c=>c.field),['title']);
 assert.deepEqual(d.added.map(s=>s.id),['c']);
 assert.deepEqual(d.removed.map(s=>s.id),['b']);
 assert.deepEqual(d.changed.map(c=>[c.after.id,c.fields]),[['a',['date','cancelled']]]);
 assert.deepEqual(d.rooms.added.map(r=>r.name),['102']);
 assert.deepEqual(d.rooms.resized.map(r=>[r.before.rows,r.after.rows]),[[5,6]]);
 assert.equal(d.empty,false);
});

test('the seating preview pairs a moved or newly linked seat and ignores details the server adds',()=>{
 const seat=(name,row,extra={})=>({examId:'a',room:'101',row,column:1,className:'10A',name,englishName:'',...extra});
 const published={rooms:[{name:'101',rows:5,columns:5}],seats:[seat('甲',1,{matchEmail:'a@x'}),seat('乙',2,{studentId:'s2'}),seat('丙',3),seat('戊',5)]};
 const unchanged={rooms:published.rooms,seats:[seat('甲',1,{grade:10,student:{}}),seat('乙',2,{studentId:'s2'}),seat('丙',3),seat('戊',5)]};
 assert.equal(seatingDiff(published,unchanged).empty,true);
 const d=seatingDiff(published,{rooms:[{name:'101',rows:6,columns:5}],seats:[seat('甲',1),seat('乙',4,{studentId:'s2'}),seat('丙',3,{studentId:'s3'}),seat('丁',5)]});
 assert.deepEqual(d.changed.map(c=>[c.after.name,c.before.row,c.after.row,c.after.studentId]),[['乙',2,4,'s2'],['丙',3,3,'s3']]);
 assert.deepEqual(d.added.map(s=>s.name),['丁']);
 assert.deepEqual(d.removed.map(s=>s.name),['戊']);
 assert.equal(d.rooms.resized.length,1);
});
