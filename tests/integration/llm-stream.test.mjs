import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';
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

test('exam extraction streams NDJSON stages and items, then the normalised result',async()=>{
 const llm=await gateway();
 llm.state.content=JSON.stringify({sessions:[{title:'Biology 1',subject:'Biology',grades:[10],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['101'],source:{page:1,quote:'Biology 1'}},{title:'Physics HL',subject:'Physics',level:'HL',grades:[11],date:'2026-09-22',start:'08:10',end:'09:40',rooms:['102'],source:{page:2,quote:'Physics HL'}}],warnings:['check rooms']});
 const directory=await mkdtemp(join(tmpdir(),'stream-test-')),instance=createApplication({dataDir:directory,origin:'http://calendar.test',llm:{url:llm.url,token:'fixture-token'}}),server=instance.app.listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api`;
 try{
  await setAdminPassword(instance.db,'admin','stream-testing-password');
  const signIn=await fetch(base+'/login',{method:'POST',headers:{Origin:'http://calendar.test','Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'stream-testing-password'})});
  const cookie=signIn.headers.get('set-cookie').split(';')[0];
  const extract=accept=>fetch(base+'/admin/exam-extract',{method:'POST',headers:{Origin:'http://calendar.test','Content-Type':'application/json',Cookie:cookie,Accept:accept},body:JSON.stringify({images:['data:image/jpeg;base64,aGVsbG8='],text:'',start:'2026-09-21',end:'2026-09-25'})});
  let response=await extract('application/x-ndjson');
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/ndjson/);
  const lines=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(lines.filter(l=>l.type==='stage').map(l=>l.stage),['connecting','reading','generating','validating']);
  assert.deepEqual(lines.filter(l=>l.type==='item').map(l=>[l.index,l.item.title]),[[0,'Biology 1'],[1,'Physics HL']]);
  const done=lines.at(-1);assert.equal(done.type,'done');
  assert.equal(done.result.sessions[0].subject,'生物');assert.equal(done.result.sessions[0].level,'Biology 1');
  assert.deepEqual(done.result.sessions[1].source,{page:2,quote:'Physics HL'});
  assert.deepEqual(done.result.warnings,['check rooms']);
  assert.equal(llm.state.calls[0].stream,true);assert.equal(llm.state.calls[0].reasoning_effort,'low');
  // Without the NDJSON Accept header the endpoint keeps answering with one JSON body.
  response=await extract('application/json');assert.equal(response.status,200);assert.equal((await response.json()).sessions.length,2);
  // A gateway that rejects reasoning_effort is retried without it.
  llm.state.rejectEffort=true;llm.state.calls.length=0;
  response=await extract('application/json');assert.equal(response.status,200);
  assert.deepEqual(llm.state.calls.map(c=>'reasoning_effort' in c),[true,false]);
  // Malformed output ends the stream with an error line.
  llm.state.content='{"sessions":[{"title":';
  response=await extract('application/x-ndjson');
  const last=JSON.parse((await response.text()).trim().split('\n').at(-1));
  assert.equal(last.type,'error');assert.match(last.error,/格式不正确/);
 }finally{await new Promise(r=>server.close(r));await new Promise(r=>llm.server.close(r));instance.close();await rm(directory,{recursive:true,force:true});}
});

test('a failing gateway is retried up to RETRY.times, and a broken answer keeps its finished items or is regenerated once with a reset',async()=>{
 const {streamJson,RETRY,MALFORMED_TAIL}=await import('../../server/llm-stream.mjs');
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
 const events=[],progress={stage:s=>events.push('stage:'+s),item:(k,i)=>events.push(`item:${i}`),reset:()=>events.push('reset'),text(){},source(){}};
 try{
  replies.push({status:503},{status:503},{status:503},{content:'{"sessions":[{"title":"A"}]}'});
  assert.deepEqual(await streamJson(config,{model:'flash',messages:[]},5000,progress),{sessions:[{title:'A'}]});
  assert.equal(calls,4);assert.ok(!events.includes('reset'));
  assert.deepEqual(events.filter(e=>e==='stage:reconnecting').length,3);
  replies.length=0;calls=0;events.length=0;
  // A broken tail is dropped; the finished items are kept without a retry.
  replies.push({content:'{"sessions":[{"title":"A"},{"tit'},{content:'{"sessions":[{"title":"B"}]}'});
  assert.deepEqual(await streamJson(config,{model:'flash',messages:[]},5000,progress),{sessions:[{title:'A'}],warnings:[MALFORMED_TAIL]});
  assert.equal(calls,1);assert.deepEqual(events,['stage:generating','item:0']);
  // An answer with nothing usable is regenerated once, and the client is told to reset.
  replies.length=0;calls=0;events.length=0;
  replies.push({content:'{"sessions":[{"tit'},{content:'{"sessions":[{"title":"B"}]}'});
  assert.deepEqual(await streamJson(config,{model:'flash',messages:[]},5000,progress),{sessions:[{title:'B'}]});
  assert.deepEqual(events,['stage:generating','reset','stage:retrying','stage:generating','item:0']);
  // A second failure is reported rather than retried forever.
  replies.length=0;calls=0;replies.push({content:'not json'});
  await assert.rejects(()=>streamJson(config,{model:'flash',messages:[]},5000,progress),SyntaxError);
  assert.equal(calls,2);
  replies.length=0;calls=0;replies.push({status:502});
  await assert.rejects(()=>streamJson(config,{model:'flash',messages:[]},5000,progress),/502.*重试 10 次/);
  assert.equal(calls,RETRY.times+1);
 }finally{RETRY.pause=pause;await new Promise(r=>server.close(r));}
});
