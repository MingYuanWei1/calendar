import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';
import {materialsForm,runJob} from '../helpers.mjs';
import {jsonItems,streamChat} from '../../server/llm-stream.mjs';

test('jsonItems reports each finished array item, whatever the chunking',()=>{
 const text='```json\n{"sessions":[{"title":"A } { \\" ","rooms":["1",{"x":[2]}]},{"title":"B"}],"warnings":["w"]}\n```';
 for(const size of [1,3,text.length]){
  const seen=[],feed=jsonItems((key,item)=>seen.push([key,item.title]));
  for(let i=0;i<text.length;i+=size)feed(text.slice(i,i+size));
  assert.deepEqual(seen,[['sessions','A } { " '],['sessions','B']]);
 }
});

// Real gateways send one token per SSE event with a large envelope, so the wire size far exceeds the text.
test('streamChat limits the answer text, not the SSE envelope around it',async()=>{
 const pad='x'.repeat(400),server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/event-stream');
  for(let i=0;i<12000;i++)res.write(`data: ${JSON.stringify({id:pad,choices:[{delta:{content:'ab'}}]})}\n\n`);
  res.end('data: [DONE]\n\n');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{assert.equal((await streamChat({url:`http://127.0.0.1:${server.address().port}`,token:'t'},{model:'flash',messages:[]},5000,()=>{})).length,24000);}
 finally{server.close();}
});

// A gateway that streams SSE chunks, rejects reasoning_effort when asked to, and can fail mid-request.
async function gateway(){
 const state={calls:[],rejectEffort:false,content:''};
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  if(req.url==='/v1/capabilities'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({purposes:{flash:{enabled:true}}}));}
  const parsed=JSON.parse(body);state.calls.push(parsed);
  if(state.rejectEffort&&'reasoning_effort' in parsed){res.statusCode=400;return res.end('{"error":"unsupported"}');}
  res.setHeader('Content-Type','text/event-stream');
  for(let i=0;i<state.content.length;i+=7){res.write(`data: ${JSON.stringify({choices:[{delta:{content:state.content.slice(i,i+7)}}]})}\n\n`);await new Promise(r=>setImmediate(r));}
  res.end('data: [DONE]\n\n');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {state,server,url:`http://127.0.0.1:${server.address().port}`};
}

test('a timetable job streams its stages and items, then the normalised result',async()=>{
 const llm=await gateway();
 llm.state.content=JSON.stringify({sessions:[{title:'Biology 1',subject:'Biology',grades:[10],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['101'],source:{page:1,quote:'Biology 1'}},{title:'Physics HL',subject:'Physics',level:'HL',grades:[11],date:'2026-09-22',start:'08:10',end:'09:40',rooms:['102'],source:{page:2,quote:'Physics HL'}}],warnings:['check rooms']});
 const directory=await mkdtemp(join(tmpdir(),'stream-test-')),instance=createApplication({dataDir:directory,origin:'http://calendar.test',llm:{url:llm.url,token:'fixture-token'}}),server=instance.app.listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api`;
 try{
  await setAdminPassword(instance.db,'admin','stream-testing-password');
  const signIn=await fetch(base+'/login',{method:'POST',headers:{Origin:'http://calendar.test','Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'stream-testing-password'})});
  const cookie=signIn.headers.get('set-cookie').split(';')[0];
  const batch=await (await fetch(base+'/admin/exams',{method:'POST',headers:{Origin:'http://calendar.test','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({title:'Stream',start:'2026-09-21',end:'2026-09-25',rooms:[],sessions:[],seats:[]})})).json();
  const extract=()=>runJob(base,cookie,'sessions',batch.id,materialsForm({parts:[{kind:'image',image:'data:image/jpeg;base64,aGVsbG8=',text:''}]}));
  let run=await extract();
  assert.equal(run.status,'done');
  const lines=run.events;
  assert.deepEqual(lines.filter(l=>l.type==='stage').map(l=>l.stage),['preparing','connecting','reading','generating']);
  assert.deepEqual(lines.filter(l=>l.type==='item').map(l=>[l.index,l.item.title]),[[0,'Biology 1'],[1,'Physics HL']]);
  assert.equal(lines.at(-1).type,'done');
  assert.equal(run.result.sessions[0].subject,'生物');assert.equal(run.result.sessions[0].level,'Biology 1');
  assert.deepEqual(run.result.sessions[1].source,{page:2,quote:'Physics HL'});
  assert.deepEqual(run.result.warnings,['check rooms']);
  assert.equal(llm.state.calls[0].stream,true);assert.equal(llm.state.calls[0].reasoning_effort,'low');
  // A gateway that rejects reasoning_effort is retried without it.
  llm.state.rejectEffort=true;llm.state.calls.length=0;
  run=await extract();assert.equal(run.status,'done');
  assert.deepEqual(llm.state.calls.map(c=>'reasoning_effort' in c),[true,false]);
  // An answer cut off before its first item (even after the retry) ends normally, listing the broken text.
  llm.state.content='{"sessions":[{"title":';
  run=await extract();
  assert.deepEqual(run.events.filter(l=>l.type==='invalid').map(l=>l.reason),['cut','cut']);assert.ok(run.events.some(l=>l.type==='reset'));
  assert.equal(run.status,'done');assert.deepEqual(run.result.sessions,[]);assert.deepEqual(run.result.invalid,[{text:'{"title":',reason:'cut'}]);
 }finally{await new Promise(r=>server.close(r));await new Promise(r=>llm.server.close(r));instance.close();await rm(directory,{recursive:true,force:true});}
});

test('a failing gateway is retried up to RETRY.times, and a broken answer keeps its finished items or is regenerated once with a reset',async()=>{
 const {streamJson,RETRY,INVALID}=await import('../../server/llm-stream.mjs');
 const pause=RETRY.pause;RETRY.pause=()=>5;
 const replies=[];let calls=0;
 const server=http.createServer(async(req,res)=>{
  for await(const chunk of req);
  const reply=replies[calls++]||replies.at(-1);
  if(reply.status){res.statusCode=reply.status;return res.end('{}');}
  res.setHeader('Content-Type','text/event-stream');
  res.end(`data: ${JSON.stringify({choices:[{delta:{content:reply.content}}]})}\n\ndata: [DONE]\n\n`);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const config={url:`http://127.0.0.1:${server.address().port}`,token:'t'};
 const events=[],progress={stage:s=>events.push('stage:'+s),item:(k,i)=>events.push(`item:${i}`),invalid:e=>events.push(`invalid:${e.reason}`),reset:()=>events.push('reset'),text(){},source(){}};
 try{
  replies.push({status:503},{status:503},{status:503},{content:'{"sessions":[{"title":"A"}]}'});
  assert.deepEqual(await streamJson(config,{model:'flash',messages:[]},5000,progress),{sessions:[{title:'A'}]});
  assert.equal(calls,4);assert.ok(!events.includes('reset'));
  assert.deepEqual(events.filter(e=>e==='stage:reconnecting').length,3);
  replies.length=0;calls=0;events.length=0;
  // Prose around a complete object is ignored rather than treated as a broken answer.
  replies.length=0;calls=0;events.length=0;
  replies.push({content:'好的，结果如下：\n```json\n{"sessions":[{"title":"A }"}]}\n```\n如有问题请告诉我。'});
  assert.deepEqual(await streamJson(config,{model:'flash',messages:[]},5000,progress),{sessions:[{title:'A }'}]});
  assert.equal(calls,1);
  replies.length=0;calls=0;events.length=0;
  // A fault after a complete array (here in warnings) loses no items and lists nothing.
  replies.push({content:'{"sessions":[{"title":"A"},{"title":"B"}],"warnings":["unclosed]}'});
  let answer=await streamJson(config,{model:'flash',messages:[]},5000,progress);
  assert.deepEqual(answer.sessions,[{title:'A'},{title:'B'}]);assert.deepEqual(answer[INVALID],[]);
  replies.length=0;calls=0;events.length=0;
  // A broken item is marked and skipped, later items still arrive, and a cut-off tail is marked too — without a retry.
  replies.push({content:'{"sessions":[{"title":"A"},{"title":"B",,},{"title":"他说"好"了"},{"title":"D"},{"tit'});
  answer=await streamJson(config,{model:'flash',messages:[]},5000,progress);
  assert.deepEqual(answer.sessions,[{title:'A'},{title:'D'}]);
  assert.deepEqual(answer[INVALID].map(e=>[e.reason,e.text]),[['json','{"title":"B",,}'],['json','{"title":"他说"好"了"}'],['cut','{"tit']]);
  assert.equal(calls,1);assert.deepEqual(events,['stage:generating','item:0','invalid:json','invalid:json','item:1','invalid:cut']);
  // Warnings written before the break are kept.
  replies.length=0;calls=0;events.length=0;
  replies.push({content:'{"warnings":["check rooms"],"sessions":[{"title":"A"},{"tit'});
  answer=await streamJson(config,{model:'flash',messages:[]},5000,progress);
  assert.deepEqual(answer.warnings,['check rooms']);assert.deepEqual(answer.sessions,[{title:'A'}]);
  // An answer with nothing usable is regenerated once, and the client is told to reset.
  replies.length=0;calls=0;events.length=0;
  replies.push({content:'not json'},{content:'{"sessions":[{"title":"B"}]}'});
  assert.deepEqual(await streamJson(config,{model:'flash',messages:[]},5000,progress),{sessions:[{title:'B'}]});
  assert.deepEqual(events,['stage:generating','reset','stage:retrying','stage:generating','item:0']);
  // A second failure is reported rather than retried forever.
  replies.length=0;calls=0;replies.push({content:'not json'});
  await assert.rejects(()=>streamJson(config,{model:'flash',messages:[]},5000,progress),SyntaxError);
  assert.equal(calls,2);
  // An empty answer is reported as such (with the gateway's reason), not as malformed output, and is not retried.
  replies.length=0;calls=0;replies.push({content:''});
  await assert.rejects(()=>streamJson(config,{model:'flash',messages:[]},5000,progress),/没有返回任何内容（连接提前结束）/);
  assert.equal(calls,1);
  replies.length=0;calls=0;replies.push({status:502});
  await assert.rejects(()=>streamJson(config,{model:'flash',messages:[]},5000,progress),/502.*重试 10 次/);
  assert.equal(calls,RETRY.times+1);
 }finally{RETRY.pause=pause;await new Promise(r=>server.close(r));}
});
