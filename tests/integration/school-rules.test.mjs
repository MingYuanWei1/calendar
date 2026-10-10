import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';

const origin='http://calendar.test';

test('school rules choose the course naming that AI exam extraction follows',async t=>{
 const calls=[];
 const gateway=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/capabilities')return res.end(JSON.stringify({purposes:{flash:{enabled:true}}}));
  let body='';for await(const part of req)body+=part;calls.push(JSON.parse(body));
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({sessions:[{title:'Physics non-DP',subject:'物理',subjectEn:'Physics',level:'',division:'high',grades:[11],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['101']}],warnings:[]})}}]}));
 });
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const directory=await mkdtemp(join(tmpdir(),'school-rules-test-'));
 const instance=createApplication({dataDir:directory,origin,llm:{url:`http://127.0.0.1:${gateway.address().port}`,token:'fixture-token'}});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>gateway.close(r));instance.close();await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}/api`;
 const call=(path,method='GET',body,cookie='')=>fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 const signIn=async(username,password)=>(await call('/login','POST',{username,password})).headers.get('set-cookie').split(';')[0];
 await setAdminPassword(instance.db,'admin','rules-testing-password');
 const admin=await signIn('admin','rules-testing-password');
 assert.equal((await call('/admin/accounts','POST',{username:'reader',password:'rules-reader-password',name:'Reader',role:1},admin)).status,201);
 const reader=await signIn('reader','rules-reader-password');

 assert.equal((await call('/admin/school-rules')).status,401);
 assert.equal((await call('/admin/school-rules','GET',null,reader)).status,403);
 assert.equal((await call('/admin/school-rules','PUT',{template:'general',rules:''},reader)).status,403);

 // A school that never chose rules uses the IB template, so extraction behaves as before.
 const initial=await (await call('/admin/school-rules','GET',null,admin)).json();
 assert.equal(initial.template,'ib');assert.match(initial.rules,/non-dp/);assert.deepEqual(Object.keys(initial.templates),['ib','general']);
 const input={images:['data:image/jpeg;base64,aGVsbG8='],text:'Physics non-DP G11',start:'2026-09-21',end:'2026-09-25'};
 const extract=async()=>(await (await call('/admin/exam-extract','POST',input,admin)).json()).sessions[0];
 assert.equal((await extract()).level,'Physics 2');
 const ibPrompt=calls.at(-1).messages[0].content;
 assert.match(ibPrompt,/Comprehensive English/);assert.match(ibPrompt,/AI经管/);assert.match(ibPrompt,/Return ONLY a JSON object/);

 // A public high school: its own rules replace the IB ones, and the code renumbers nothing afterwards.
 const general=await (await call('/admin/school-rules','PUT',{template:'general',rules:initial.templates.general.rules},admin)).json();
 assert.equal(general.template,'general');
 const plain=await extract();
 assert.equal(plain.level,'');assert.equal(plain.title,'Physics non-DP');
 const prompt=calls.at(-1).messages[0].content;
 assert.match(prompt,/思想政治/);assert.doesNotMatch(prompt,/Comprehensive English|non-dp/);assert.match(prompt,/Return ONLY a JSON object/);
 // Its subjects join the catalog.
 const subjects=(await (await call('/exam-subjects')).json()).map(s=>s.name);
 for(const name of ['语文','思想政治','地理'])assert.ok(subjects.includes(name),name);

 // Edited rules are kept as written and survive a reload; bad input is refused.
 await call('/admin/school-rules','PUT',{template:'general',rules:'- Grades are 初一 to 初三.'},admin);
 assert.equal((await (await call('/admin/school-rules','GET',null,admin)).json()).rules,'- Grades are 初一 to 初三.');
 await extract();assert.match(calls.at(-1).messages[0].content,/Grades are 初一 to 初三/);
 assert.equal((await call('/admin/school-rules','PUT',{template:'other',rules:''},admin)).status,422);
 assert.equal((await call('/admin/school-rules','PUT',{template:'ib',rules:'x'.repeat(6001)},admin)).status,422);
});
