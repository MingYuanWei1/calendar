import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareSessions,finishSessions} from '../../server/exam-extract.mjs';
import {applySessions,changedFields,withoutRooms} from '../../public/exam-schedule-diff.mjs';

const rules={rules:'',curriculum:'ib'};
const exam=(id,extra={})=>({id,title:'数学 HL',titleEn:'Math HL',subject:'数学',subjectEn:'Mathematics',level:'HL',division:'high',grades:[12],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['101'],note:'',cancelled:false,...extra});
const draft=()=>({title:'期中',start:'2026-09-21',end:'2026-09-25',rooms:[{name:'101',rows:5,columns:5},{name:'102',rows:5,columns:5},{name:'空',rows:5,columns:5}],
 sessions:[exam('a'),exam('b',{title:'物理 SL',subject:'物理',level:'SL',rooms:['101','102'],cancelled:true,note:'带计算器'})],
 seats:[{examId:'b',room:'101',row:1,column:1,name:'甲'},{examId:'b',room:'102',row:1,column:1,name:'乙'},{examId:'a',room:'101',row:2,column:2,name:'丙'}]});

test('pasted materials and screenshots are accepted, and the draft sessions go to the model as refs',async()=>{
 const parts=[{kind:'text',text:'物理 SL 改到 9月22日'},{kind:'image',image:'data:image/png;base64,aGVsbG8=',text:''}];
 const {request,context}=await prepareSessions({parts,workbooks:[]},draft(),[],rules);
 assert.equal(request.parts.length,1);
 const [system,user]=request.parts[0].body.messages;
 assert.match(system.content,/"ref":"S2".*"物理 SL"/);
 assert.match(system.content,/Never delete or cancel sessions/);
 assert.deepEqual(user.content.map(c=>c.type),['text','text','image_url']);
 assert.match(user.content[0].text,/^Material 1 \(pasted text\)/);
 assert.deepEqual(context.refs,{S1:'a',S2:'b'});
 const result=finishSessions(context,{sessions:[{ref:'S2',title:'物理 SL',subject:'物理',level:'SL',division:'high',grades:[12],date:'2026-09-22',start:'08:10',end:'09:40',rooms:['101']},{ref:'S9',title:'化学',subject:'化学',grades:[11],date:'2026-09-23',rooms:['103']},{title:'生物',subject:'生物',grades:[10],date:'2026-09-24',rooms:['101']}],warnings:[]});
 assert.deepEqual(result.sessions.map(s=>s.targetId||null),['b',null,null]);
 assert.match(result.warnings.at(-1),/S9/);
});

test('many materials go to the model eight at a time, each later batch with Material 1 for context and its own numbers',async()=>{
 const page=n=>({kind:'image',image:'data:image/png;base64,aGVsbG8=',text:n===1?'以下均为高二考试':'',file:'a.pdf'});
 const parts=Array.from({length:17},(_,i)=>page(i+1));
 const {request}=await prepareSessions({parts,workbooks:[]},draft(),[],rules);
 assert.equal(request.parts.length,3);
 assert.deepEqual(request.reading,{pages:17,sheets:0});
 const texts=request.parts.map(part=>part.body.messages[1].content.filter(c=>c.type==='text').map(c=>c.text));
 assert.match(texts[0][0],/^Material 1 \(image; embedded PDF text: 以下均为高二考试\)/);
 assert.equal(texts[0].length,8);
 // A later batch starts with the first material's text, then numbers its own materials from where it starts.
 assert.match(texts[1][0],/^For context only.*\n以下均为高二考试$/s);
 assert.match(texts[1][1],/^Material 9 /);
 assert.match(texts[2][1],/^Material 17 /);
});

test('applying keeps exams the material leaves out, changes in place and removes only seats an exam leaves behind',()=>{
 const before=draft();
 const moved={...exam('x'),targetId:'b',title:'物理 SL',subject:'物理',level:'SL',date:'2026-09-22',rooms:['101','103']};
 assert.deepEqual(changedFields(before.sessions[1],moved),['date','rooms']);
 const {batch:next,added,changed,dropped,newRooms,emptied}=applySessions(before,[{item:moved,targetId:'b'},{item:exam('new',{title:'生物',rooms:['104']}),targetId:null}]);
 assert.deepEqual([added,changed],[1,1]);
 assert.deepEqual(next.sessions.map(s=>s.id),['a','b','new']);
 const physics=next.sessions[1];
 assert.deepEqual([physics.date,physics.rooms,physics.cancelled,physics.note],['2026-09-22',['101','103'],true,'带计算器']);
 assert.deepEqual(newRooms,['103','104']);
 assert.deepEqual(next.rooms.slice(-2),[{name:'103',rows:5,columns:5},{name:'104',rows:5,columns:5}]);
 // 乙 sat in 102, which physics no longer uses; 102 is left empty but is only reported, not removed.
 assert.deepEqual(dropped.map(s=>s.name),['乙']);
 assert.deepEqual(next.seats.map(s=>s.name),['甲','丙']);
 assert.deepEqual(emptied,['102']);
 assert.ok(next.rooms.some(r=>r.name==='102'));
 assert.ok(!withoutRooms(next,emptied).rooms.some(r=>r.name==='102'));
 // A change whose exam was deleted meanwhile is added instead; the draft itself is untouched.
 assert.equal(applySessions(before,[{item:moved,targetId:'gone'}]).added,1);
 assert.equal(before.seats.length,3);
});
