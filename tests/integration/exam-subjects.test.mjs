import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';
import {subjectColors,presetSubjects} from '../../public/exam-subjects.mjs';
test('subject colors stay consistent across papers, levels, aliases and custom subjects',()=>{
 const sessions=[{subject:'数学',paper:'Paper 1'},{subject:'数学',paper:'Paper 2'},{subject:'商管'},{subject:'商务管理'},{subject:'自定义甲'},{subject:'自定义乙'},{title:'[示例] 英语阅读与写作'}];
 const color=subjectColors(sessions,presetSubjects);
 assert.equal(color(sessions[0]),color(sessions[1]));assert.equal(color(sessions[2]),color(sessions[3]));
 assert.notEqual(color(sessions[4]),color(sessions[5]));
 assert.equal(color(sessions[6]),color({subject:'英语'}));
 assert.equal(color(sessions[4]),subjectColors([...sessions].reverse(),presetSubjects)(sessions[4]));
});
test('subject management requires admin and persists custom subjects with distinct colors',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'calendar-subjects-')),instance=createApplication({dataDir:directory,origin:'http://calendar.test'}),server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api`;
 const call=(path,method='GET',body,cookie='')=>fetch(base+path,{method,headers:{Origin:'http://calendar.test','Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await (await call('/exam-subjects')).json()).length,12);
  assert.equal((await call('/admin/exam-subjects','POST',{name:'艺术'})).status,401);
  await setAdminPassword(instance.db,'admin','subject-testing-password');const login=await call('/login','POST',{username:'admin',password:'subject-testing-password'}),cookie=login.headers.get('set-cookie').split(';')[0];
  let response=await call('/admin/exam-subjects','POST',{name:'艺术',english:'Art'},cookie);assert.equal(response.status,201);
  const first=await response.json();assert.equal(new Set(first.map(s=>s.hue)).size,13);
  assert.equal((await call('/admin/exam-subjects','POST',{name:'艺术'},cookie)).status,409);
  assert.equal((await call('/admin/exam-subjects','PUT',{name:'艺术',english:'Visual Arts'},cookie)).status,200);
  const batch={title:'自定义学科',start:'2026-09-21',end:'2026-09-21',rooms:[{name:'A',rows:1,columns:1}],seats:[],sessions:[{id:'one',title:'设计',subject:'设计',division:'high',grades:['G12'],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['A']}]};
  response=await call('/admin/exams','POST',batch,cookie);assert.equal(response.status,201);const saved=await response.json();
  const subjects=await (await call('/exam-subjects')).json();assert.equal(subjects.length,14);assert.equal(new Set(subjects.map(s=>s.hue)).size,14);
  assert.equal(subjects.find(s=>s.name==='艺术').hue,first.find(s=>s.name==='艺术').hue);
  assert.equal((await call(`/admin/exams/${saved.id}/publish`,'POST',{version:saved.version},cookie)).status,200);
  assert.equal((await (await call(`/exams/${saved.id}`)).json()).subjects.length,14);
 }finally{await new Promise(r=>server.close(r));instance.close();await rm(directory,{recursive:true,force:true});}
});
