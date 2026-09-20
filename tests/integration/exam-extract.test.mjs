import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';
test('Worker extraction authenticates, routes purpose aliases, validates previews and never saves automatically',async()=>{
 const calls=[];let malformed=false,flashEnabled=true;
 const gateway=http.createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer fixture-token');res.setHeader('Content-Type','application/json');if(req.url==='/v1/capabilities')return res.end(JSON.stringify({purposes:{flash:{enabled:flashEnabled},think:{enabled:true},vision:{enabled:true}}}));let body='';for await(const part of req)body+=part;calls.push(JSON.parse(body));res.end(JSON.stringify({choices:[{message:{content:malformed?'bad json':JSON.stringify({sessions:[{title:'数学 HL',subject:'数学',level:'HL',division:'high',grades:['G12'],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['101']}],warnings:[]})}}]}));});
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const directory=await mkdtemp(join(tmpdir(),'extract-test-')),instance=createApplication({dataDir:directory,origin:'http://calendar.test',llm:{url:`http://127.0.0.1:${gateway.address().port}`,token:'fixture-token'}}),server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api`,call=(path,method='GET',body,cookie='')=>fetch(base+path,{method,headers:{Origin:'http://calendar.test','Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 try{
  const input={images:['data:image/jpeg;base64,aGVsbG8='],text:'数学 HL 9月21日 08:10-09:40 G12 101',start:'2026-09-21',end:'2026-09-25'};
  assert.equal((await call('/admin/exam-extract','POST',input)).status,401);
  await setAdminPassword(instance.db,'admin','extract-testing-password');const login=await call('/login','POST',{username:'admin',password:'extract-testing-password'}),cookie=login.headers.get('set-cookie').split(';')[0];
  let response=await call('/admin/exam-extract','POST',input,cookie);assert.equal(response.status,200);const result=await response.json();assert.equal(result.sessions[0].subject,'数学');assert.ok(result.sessions[0].id);assert.equal(calls[0].model,'flash');assert.equal(calls[0].stream,false);assert.match(calls[0].messages[0].content,/EVERY subject/);assert.match(calls[0].messages[0].content,/custom subjects/);assert.match(calls[0].messages[0].content,/Course \+ number/);
  for(const rule of ['Chinese ab initio','Language & Literature','Comprehensive English','Pre-Calculus','non-dp'])assert.ok(calls[0].messages[0].content.includes(rule),rule);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM exam_batches').get().n,0);
  const candidate={title:'Test',start:input.start,end:input.end,rooms:[{name:'101',rows:5,columns:5}],sessions:result.sessions,seats:[]};
  assert.equal((await call('/admin/exam-extract/validate','POST',candidate,cookie)).status,200);
  assert.equal((await call('/admin/exam-extract/validate','POST',{...candidate,sessions:[{...result.sessions[0],date:'2027-01-01'}]},cookie)).status,422);
  assert.equal((await call('/admin/exam-extract','POST',{...input,images:[]},cookie)).status,422);
  flashEnabled=false;const count=calls.length;assert.equal((await call('/admin/exam-extract','POST',input,cookie)).status,502);assert.equal(calls.length,count);flashEnabled=true;
  malformed=true;assert.equal((await call('/admin/exam-extract','POST',input,cookie)).status,502);
 }finally{await new Promise(r=>server.close(r));await new Promise(r=>gateway.close(r));instance.close();await rm(directory,{recursive:true,force:true});}
});
