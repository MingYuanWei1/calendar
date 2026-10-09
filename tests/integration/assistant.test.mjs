import {request as httpRequest} from 'node:http';
import http from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/passwords.mjs';

const origin='http://localhost:3000';
async function setup(t){
 const state={prompts:[],pieces:['你本周有 ','数学 [[X','1]]，另见 [[E1]] 和 [[E999]]。']};
 const gateway=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  if(req.url==='/v1/capabilities'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({purposes:{flash:{enabled:true}}}));}
  state.prompts.push(JSON.parse(body));
  res.setHeader('Content-Type','text/event-stream');
  for(const piece of state.pieces)res.write(`data: ${JSON.stringify({choices:[{delta:{content:piece}}]})}\n\n`);
  res.end('data: [DONE]\n\n');
 });
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const directory=await mkdtemp(join(tmpdir(),'assistant-test-'));
 const instance=createApplication({dataDir:directory,origin,timeZone:'Asia/Shanghai',llm:{url:`http://127.0.0.1:${gateway.address().port}`,token:'fixture-token'},sso:{preview:true,previewEmail:'29wangxiaoming@school.edu.cn'}});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>gateway.close(r));instance.close();await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 // On the local preview, the preview student is signed in unless school_preview_out=1 is sent.
 const request=(path,{method='GET',body,cookie='school_preview_out=1',accept='application/json'}={})=>new Promise((resolve,reject)=>{
  const req=httpRequest(base+path,{method,headers:{Host:'localhost:3000',Origin:origin,'Content-Type':'application/json',Accept:accept,Cookie:cookie}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));});
  req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
 await setAdminPassword(instance.db,'admin','assistant-testing-password');
 const login=await request('/api/login',{method:'POST',body:{username:'admin',password:'assistant-testing-password'}});
 const admin=login.headers['set-cookie'][0].split(';')[0]+'; school_preview_out=1';
 const call=async(path,method='GET',body)=>{const r=await request(path,{method,body,cookie:admin});assert.ok(r.status<300,`${path} ${r.status} ${r.text}`);return r.text?JSON.parse(r.text):null;};
 const ask=(cookie,messages,accept='application/x-ndjson')=>request('/api/assistant',{method:'POST',body:{messages},cookie,accept});
 const lines=response=>response.text.trim().split('\n').map(line=>JSON.parse(line));
 return {state,request,call,ask,lines,student:'',visitor:'school_preview_out=1'};
}
async function seed(call){
 await call('/api/admin/events','POST',{title:['运动会','Sports day'],type:'activity',scope:['schoolwide'],status:'published',start:'2026-10-12',timeMode:'allDay'});
 await call('/api/admin/events','POST',{title:['秘密草稿','Secret draft'],type:'activity',scope:['schoolwide'],status:'draft',start:'2026-10-13',timeMode:'allDay'});
 await call('/api/admin/day-plans','PUT',{start:'2026-10-01',end:'2026-10-07',kind:'off',title:['国庆节','National Day']});
 await call('/api/admin/students/settings','PUT',{domain:'school.edu.cn'});
 const exams={title:'期中考试',titleEn:'Midterms',start:'2026-09-21',end:'2026-10-04',academicYear:2026,rooms:[{name:'A',rows:3,columns:3},{name:'B',rows:3,columns:3}],
  sessions:[{id:'math',title:'数学',titleEn:'Mathematics',division:'high',grades:['G10'],date:'2026-09-23',start:'08:00',end:'09:00',rooms:['A','B']}],
  seats:[{examId:'math',room:'B',row:1,column:2,className:'10.5',name:'王小明',englishName:'Ming'},{examId:'math',room:'A',row:2,column:1,className:'10.5',name:'李华',englishName:'Hua'}]};
 let b=await call('/api/admin/exams','POST',exams);
 b=await call(`/api/admin/exams/${b.id}/publish`,'POST',{version:b.version});
 b=await call(`/api/admin/exams/${b.id}/publish-seats`,'POST',{version:b.version});
 await call('/api/admin/exams','POST',{...exams,title:'未发布的期末考试',sessions:[{...exams.sessions[0],id:'secret',title:'未发布考试'}],seats:[]});
 return b;
}

test('the assistant answers from published data, cites real items and sees only the asker’s own seat',async t=>{
 const {state,request,call,ask,lines,student,visitor}=await setup(t);
 const batch=await seed(call);
 assert.deepEqual(JSON.parse((await request('/api/assistant',{cookie:visitor})).text),{configured:true});

 const answer=lines(await ask(student,[{role:'user',content:'我这周有哪些考试？'}]));
 assert.equal(answer.filter(l=>l.type==='text').map(l=>l.delta).join(''),'你本周有 数学 [[X1]]，另见 [[E1]] 和 [[E999]]。');
 const {result}=answer.at(-1);
 assert.equal(result.answer,'你本周有 数学 [[X1]]，另见 [[E1]] 和 [[E999]]。');
 assert.deepEqual(Object.keys(result.citations).sort(),['E1','X1']);
 assert.equal(result.citations.X1.kind,'exam');assert.equal(result.citations.X1.batchId,batch.id);assert.equal(result.citations.X1.id,'math');
 assert.deepEqual(result.citations.X1.seat,{room:'B',row:1,column:2});
 assert.equal(result.citations.E1.kind,'event');assert.deepEqual(result.citations.E1.title,['运动会','Sports day']);

 // Only published data reaches the model, with the student's own seat but nobody else's.
 const system=state.prompts[0].messages[0].content;
 assert.match(system,/运动会/);assert.match(system,/国庆节/);assert.match(system,/数学/);
 assert.doesNotMatch(system,/秘密草稿|未发布/);
 assert.match(system,/"mySeat":\{"room":"B","row":1,"column":2\}/);assert.match(system,/"inMyExams":true/);
 assert.doesNotMatch(system,/李华|王小明|"room":"A","row":2/);
 assert.match(system,/Today is \d{4}-\d{2}-\d{2}/);
 assert.equal(state.prompts[0].messages.at(-1).content,'我这周有哪些考试？');

 // Visitors get no personal data and are told to sign in for their own exams.
 await ask(visitor,[{role:'user',content:'我的考试在哪？'}]);
 const anonymous=state.prompts.at(-1).messages[0].content;
 assert.doesNotMatch(anonymous,/mySeat|inMyExams/);assert.match(anonymous,/nobody is signed in/);assert.match(anonymous,/sign in/i);
 assert.doesNotMatch(anonymous,/identity|demo bar|身份/);

 // A conversation continues with earlier turns; plain JSON is still available.
 const plain=await ask(visitor,[{role:'user',content:'下次放假？'},{role:'assistant',content:'10 月 1 日。'},{role:'user',content:'放几天？'}],'application/json');
 assert.equal(plain.status,200);assert.ok(JSON.parse(plain.text).answer);
 assert.deepEqual(state.prompts.at(-1).messages.slice(1).map(m=>m.role),['user','assistant','user']);
});

test('invalid questions are refused before the model, and each person may ask ten a minute',async t=>{
 const {state,ask,student,visitor}=await setup(t);
 assert.equal((await ask(visitor,[{role:'assistant',content:'hi'}])).status,422);
 assert.equal((await ask(visitor,[{role:'user',content:'x'.repeat(501)}])).status,422);
 assert.equal((await ask(visitor,[])).status,422);
 assert.equal((await ask(visitor,Array.from({length:13},()=>({role:'user',content:'hi'})))).status,422);
 assert.equal(state.prompts.length,0);
 const statuses=[];for(let i=0;i<11;i++)statuses.push((await ask(student,[{role:'user',content:'今天有什么活动？'}])).status);
 assert.deepEqual(statuses,[...Array(10).fill(200),429]);
 const refused=await ask(student,[{role:'user',content:'今天有什么活动？'}]);
 assert.equal(JSON.parse(refused.text).code,'LLM_RATE');assert.match(JSON.parse(refused.text).error,/一分钟/);
});
