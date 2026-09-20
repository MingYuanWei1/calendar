import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';
import {subjectColors,presetSubjects,normalizeCourse} from '../../public/exam-subjects.mjs';
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
  assert.equal((await (await call('/exam-subjects')).json()).length,presetSubjects.length);
  assert.equal((await call('/admin/exam-subjects','POST',{name:'艺术'})).status,401);
  await setAdminPassword(instance.db,'admin','subject-testing-password');const login=await call('/login','POST',{username:'admin',password:'subject-testing-password'}),cookie=login.headers.get('set-cookie').split(';')[0];
  let response=await call('/admin/exam-subjects','POST',{name:'艺术',english:'Art'},cookie);assert.equal(response.status,201);
  const first=await response.json();assert.equal(new Set(first.map(s=>s.hue)).size,presetSubjects.length+1);
  assert.equal((await call('/admin/exam-subjects','POST',{name:'艺术'},cookie)).status,409);
  assert.equal((await call('/admin/exam-subjects','PUT',{name:'艺术',english:'Visual Arts'},cookie)).status,200);
  const batch={title:'自定义学科',start:'2026-09-21',end:'2026-09-21',rooms:[{name:'A',rows:1,columns:1}],seats:[],sessions:[{id:'one',title:'设计',subject:'设计',division:'high',grades:['G12'],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['A']}]};
  response=await call('/admin/exams','POST',batch,cookie);assert.equal(response.status,201);const saved=await response.json();
  const subjects=await (await call('/exam-subjects')).json();assert.equal(subjects.length,presetSubjects.length+2);assert.equal(new Set(subjects.map(s=>s.hue)).size,presetSubjects.length+2);
  assert.equal(subjects.find(s=>s.name==='艺术').hue,first.find(s=>s.name==='艺术').hue);
  assert.equal((await call(`/admin/exams/${saved.id}/publish`,'POST',{version:saved.version},cookie)).status,200);
  assert.equal((await (await call(`/exams/${saved.id}`)).json()).subjects.length,presetSubjects.length+2);
 }finally{await new Promise(r=>server.close(r));instance.close();await rm(directory,{recursive:true,force:true});}
});

test('numbered courses inherit canonical subjects and keep course numbers as levels',()=>{
 const a=normalizeCourse({title:'Biology 1',subject:'Biology 1',level:'',grades:['G10']});
 assert.equal(a.subject,'生物');assert.equal(a.level,'Biology 1');assert.deepEqual(a.grades,['G10']);
 const b=normalizeCourse({title:'2',subject:'生物',level:''});assert.equal(b.title,'Biology 2');assert.equal(b.subject,'生物');
 assert.equal(normalizeCourse({title:'Biology Honor',subject:'生物',level:'Honor'}).level,'Honor');
 assert.equal(normalizeCourse({title:'Biology Paper 1',subject:'生物',level:''}).level,'');
 assert.equal(normalizeCourse({title:'1',subject:'',level:''}).subject,'');
});

test('curriculum naming preserves language tracks, G10 levels and non-DP grade numbers',()=>{
 const cases=[
  ['Chinese A Literature HL','G12','中文 A','Literature HL'],
  ['Chinese A Language & Literature SL','G11','中文 A','Language & Literature SL'],
  ['Chinese B HL','G11','中文 B','HL'],
  ['Chinese ab initio SL','G12','中文 ab initio','SL'],
  ['English A SL','G11','英语 A','SL'],
  ['English B HL','G12','英语 B','HL'],
  ['Chinese Language and Literature','G10','中文','Honor'],
  ['Chinese Language and Literature Basic','G10','中文','Basic'],
  ['Chinese Language and Literature Advanced','G11','中文 Non-DP','Advanced'],
  ['Chinese Language and Literature Extended','G12','中文 Non-DP','Extended'],
  ['Chinese B','G10','中文','Chinese B'],
  ['中文 B','G10','中文','Chinese B'],
  ...['Advanced','Intermediate','Standard'].map((x,i)=>[`${x} Comprehensive English`,'G10','英语',['ACE','ICE','SCE'][i]]),
  ...['Basic','Core','Advanced'].map(x=>[`Pre-Calculus (${x})`,'G10','数学',x]),
  ...['G11','G12'].flatMap(g=>['AA','AI','AI经管'].flatMap(t=>[[`Mathematics ${t}`,g,'数学',t],[`${t} HL`,g,'数学',`${t} HL`],[`数学 ${t} SL`,g,'数学',`${t} SL`]])),
  ...['G10','G11','G12'].map((g,i)=>['Physics non-dp',g,'物理',`Physics ${i+1}`]),
 ];
 for(const [title,grade,subject,level] of cases){
  const original={title,grades:[grade],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['101']};
  const result=normalizeCourse(original);
  assert.equal(result.subject,subject,title);assert.equal(result.level,level,title);
  for(const key of ['grades','date','start','end','rooms'])assert.deepEqual(result[key],original[key]);
  assert.deepEqual(normalizeCourse(result),result,`idempotent: ${title}`);
 }
 const unknown={title:'Physics non-dp',grades:[]};assert.deepEqual(normalizeCourse(unknown),unknown);
});
