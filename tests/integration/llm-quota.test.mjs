import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';
import {materialsForm,followJob} from '../helpers.mjs';

// A gateway that always answers with an empty extraction.
async function gateway(){
 const server=http.createServer(async(req,res)=>{
  for await(const chunk of req);
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/capabilities')return res.end(JSON.stringify({purposes:{flash:{enabled:true}}}));
  res.end(JSON.stringify({choices:[{message:{content:'{"sessions":[],"warnings":[]}'}}]}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {server,url:`http://127.0.0.1:${server.address().port}`};
}

async function start(directory,llm,dailyLimit){
 const instance=createApplication({dataDir:directory,origin:'http://calendar.test',trustProxy:'loopback',llm:{url:llm.url,token:'fixture-token',dailyLimit}});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api`;
 const headers={Origin:'http://calendar.test','Content-Type':'application/json'};
 const signIn=async(username,ip)=>{
  await setAdminPassword(instance.db,username,'quota-testing-password');
  const response=await fetch(base+'/login',{method:'POST',headers:{...headers,'X-Forwarded-For':ip},body:JSON.stringify({username,password:'quota-testing-password'})});
  return response.headers.get('set-cookie').split(';')[0];
 };
 // Each extraction is a timetable job, followed to its end so the next one may start.
 let batch=null;
 const extract=async(cookie,ip)=>{
  batch||=await (await fetch(base+'/admin/exams',{method:'POST',headers:{...headers,Cookie:cookie,'X-Forwarded-For':ip},body:JSON.stringify({title:'Quota',start:'2026-09-21',end:'2026-09-25',rooms:[],sessions:[],seats:[]})})).json();
  const response=await fetch(`${base}/admin/extract-jobs/sessions?batch=${batch.id}`,{method:'POST',headers:{Origin:headers.Origin,Cookie:cookie,'X-Forwarded-For':ip},body:materialsForm({parts:[{kind:'image',image:'data:image/jpeg;base64,aGVsbG8=',text:''}]})});
  if(response.status===201)await followJob(base,cookie,(await response.clone().json()).id);
  return response;
 };
 return {instance,base,headers,signIn,extract,stop:async()=>{await new Promise(r=>server.close(r));instance.close();}};
}

test('AI extraction is limited per person, and other people keep their own allowance',async()=>{
 const llm=await gateway(),directory=await mkdtemp(join(tmpdir(),'quota-test-'));
 const app=await start(directory,llm,1500);
 try{
  const first=await app.signIn('admin','192.0.2.1'),second=await app.signIn('editor','192.0.2.2');
  for(let i=0;i<6;i++)assert.equal((await app.extract(first,'192.0.2.1')).status,201);
  const refused=await app.extract(first,'192.0.2.1');
  assert.equal(refused.status,429);
  const body=await refused.json();
  assert.equal(body.code,'LLM_RATE');assert.match(body.error,/稍后再试/);assert.doesNotMatch(body.error,/预设/);
  assert.equal((await app.extract(second,'192.0.2.2')).status,201);
 }finally{await app.stop();await new Promise(r=>llm.server.close(r));await rm(directory,{recursive:true,force:true});}
});

test('one address is limited across people',async()=>{
 const llm=await gateway(),directory=await mkdtemp(join(tmpdir(),'quota-test-'));
 const app=await start(directory,llm,1500);
 try{
  const ip='192.0.2.9',people=[];
  for(let i=0;i<11;i++)people.push(await app.signIn('admin'+i,ip));
  let allowed=0;
  for(const cookie of people)for(let i=0;i<6;i++)if((await app.extract(cookie,ip)).status===201)allowed++;
  assert.equal(allowed,60);
  const refused=await app.extract(await app.signIn('late','192.0.2.10'),ip);
  assert.equal(refused.status,429);assert.equal((await refused.json()).code,'LLM_RATE');
 }finally{await app.stop();await new Promise(r=>llm.server.close(r));await rm(directory,{recursive:true,force:true});}
});

test('the daily total stops every AI call and survives a restart',async()=>{
 const llm=await gateway(),directory=await mkdtemp(join(tmpdir(),'quota-test-'));
 let app=await start(directory,llm,2);
 try{
  const cookie=await app.signIn('admin','192.0.2.1');
  assert.equal((await app.extract(cookie,'192.0.2.1')).status,201);
  assert.equal((await app.extract(cookie,'192.0.2.1')).status,201);
  let refused=await app.extract(await app.signIn('other','192.0.2.3'),'192.0.2.3');
  assert.equal(refused.status,429);
  const body=await refused.json();assert.equal(body.code,'LLM_QUOTA');assert.match(body.error,/今日/);
  await app.stop();
  app=await start(directory,llm,2);
  refused=await app.extract(await app.signIn('admin','192.0.2.1'),'192.0.2.1');
  assert.equal(refused.status,429);assert.equal((await refused.json()).code,'LLM_QUOTA');
 }finally{await app.stop();await new Promise(r=>llm.server.close(r));await rm(directory,{recursive:true,force:true});}
});

test('seat extraction counts against the same limits',async()=>{
 const llm=await gateway(),directory=await mkdtemp(join(tmpdir(),'quota-test-'));
 const app=await start(directory,llm,1);
 try{
  const cookie=await app.signIn('admin','192.0.2.1'),headers={...app.headers,Cookie:cookie,'X-Forwarded-For':'192.0.2.1'};
  const batch=await (await fetch(app.base+'/admin/exams',{method:'POST',headers,body:JSON.stringify({title:'期中考试',titleEn:'Midterms',start:'2026-09-21',end:'2026-09-25',sessions:[],rooms:[],seats:[]})})).json();
  assert.equal((await app.extract(cookie,'192.0.2.1')).status,201);
  const refused=await fetch(`${app.base}/admin/extract-jobs/seats?batch=${batch.id}`,{method:'POST',headers:{Origin:headers.Origin,Cookie:cookie,'X-Forwarded-For':'192.0.2.1'},body:materialsForm({parts:[{kind:'text',text:'101 示例学生'}]})});
  assert.equal(refused.status,429);assert.equal((await refused.json()).code,'LLM_QUOTA');
 }finally{await app.stop();await new Promise(r=>llm.server.close(r));await rm(directory,{recursive:true,force:true});}
});
