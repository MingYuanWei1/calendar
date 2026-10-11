import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import ExcelJS from 'exceljs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';
import {localRunner} from '../../server/extract-jobs.mjs';
import {localStep} from '../../server/extract-run.mjs';
import {RETRY} from '../../server/llm-stream.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('extraction jobs run in the background, survive the page and keep partial results',async()=>{
 const pause=RETRY.pause;RETRY.pause=()=>1;
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('101');sheet.getCell('B3').value='G12A 示例学生';
 const buffer=Buffer.from(await book.xlsx.writeBuffer());
 const seat={examId:'hl',room:'101',row:1,column:1,className:'G12A',name:'示例学生',englishName:'',source:{sheet:'101',cell:'B3'}};
 // The gateway answers each completion according to `mode`: a full answer, a 500, a cut answer, or a slow one.
 const state={mode:'ok',calls:0,release:null};
 const gateway=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/capabilities')return res.end(JSON.stringify({purposes:{flash:{enabled:true}}}));
  let body='';for await(const part of req)body+=part;
  state.calls++;
  if(state.mode==='down'){res.statusCode=500;return res.end('{}');}
  if(state.mode==='slow')await new Promise(r=>{state.release=r;});
  const asked=JSON.parse(body);
  if(JSON.stringify(asked.messages[0]).includes('exam sessions'))return res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({sessions:[{title:'Biology 1',subject:'Biology',grades:['G10'],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['101'],source:{page:1,quote:'Biology 1'}}],warnings:[]})}}]}));
  const content=state.mode==='cut'?`{"seats":[${JSON.stringify(seat)},{"examId":"hl","room":`:JSON.stringify({seats:[seat,{...seat,column:2,name:'第二人',source:{sheet:'101',cell:'C3'}}],warnings:['请核对']});
  res.end(JSON.stringify({choices:[{message:{content}}]}));
 });
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const llm={url:`http://127.0.0.1:${gateway.address().port}`,token:'test-token'};
 const directory=await mkdtemp(join(tmpdir(),'extract-jobs-'));
 const instance=createApplication({dataDir:directory,origin:'http://calendar.test',llm,extractRunner:(ops,config)=>localRunner(ops,config,localStep(10))});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api`;
 try{
  await setAdminPassword(instance.db,'admin','extract-jobs-password');
  const login=await fetch(base+'/login',{method:'POST',headers:{Origin:'http://calendar.test','Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'extract-jobs-password'})});
  const cookie=login.headers.get('set-cookie').split(';')[0],headers={Origin:'http://calendar.test',Cookie:cookie};
  const call=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{...headers,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});return {status:r.status,body:r.status===204?null:await r.json()};};
  const batch=(await call('/admin/exams','POST',{title:'Seats',start:'2026-09-21',end:'2026-09-21',rooms:[{name:'101',rows:2,columns:2}],seats:[],sessions:[{id:'hl',title:'数学 HL',division:'high',grades:[12],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['101']}]})).body;
  const start=(data=buffer,name='seats.xlsx')=>fetch(`${base}/admin/extract-jobs/seats?batch=${batch.id}`,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name)},body:data});
  const settle=async id=>{for(let i=0;i<200;i++){const {body}=await call(`/admin/extract-jobs/${id}/events`);if(body.job.status!=='running')return body;await sleep(20);}throw new Error('job did not finish');};

  assert.equal((await start(buffer,'seats.pdf')).status,422);
  assert.equal((await start(Buffer.from('not xlsx'))).status,422);
  // A finished job keeps its progress and result for whoever opens it later.
  let response=await start();assert.equal(response.status,201);let job=await response.json();assert.equal(job.status,'running');assert.equal(job.batchId,batch.id);
  let settled=await settle(job.id);
  assert.equal(settled.job.status,'done');assert.equal(settled.job.items,2);
  assert.deepEqual(settled.events.map(e=>e.type==='stage'?e.stage:e.type),['source','preparing','connecting','reading','generating','item','item','done']);
  assert.equal(settled.events[0].sheets[0].name,'101');
  const later=(await call(`/admin/extract-jobs/${job.id}/events?after=${settled.events.at(-2).seq}`)).body.events;assert.deepEqual(later.map(e=>e.type),['done']);
  let {result}=(await call(`/admin/extract-jobs/${job.id}/result`)).body;
  assert.equal(result.seats.length,2);assert.ok(result.seats[0].studentId);assert.deepEqual(result.warnings,['请核对']);
  assert.equal((await call('/admin/students')).body.length,0);
  assert.deepEqual((await call('/admin/extract-jobs')).body.map(j=>[j.id,j.status]),[[job.id,'done']]);

  // Only one job runs per batch; cancelling stops it, and a new job replaces the old one.
  state.mode='slow';
  job=await (await start()).json();
  for(let i=0;i<100&&!state.release;i++)await sleep(10);
  assert.equal((await start()).status,409);
  assert.equal((await call(`/admin/extract-jobs/${job.id}/cancel`,'POST')).body.status,'cancelled');
  state.release();state.release=null;await sleep(50);
  assert.equal((await call(`/admin/extract-jobs/${job.id}/events`)).body.job.status,'cancelled');

  // A gateway failure is retried once by the job, then recorded; the retry starts a fresh run.
  state.mode='down';state.calls=0;
  response=await start();job=await response.json();
  assert.deepEqual((await call('/admin/extract-jobs')).body.map(j=>j.id),[job.id]);
  settled=await settle(job.id);
  assert.equal(settled.job.status,'failed');assert.match(settled.job.error,/500/);
  assert.equal(state.calls,22);// 11 gateway attempts per run of the model step, and the step ran twice
  assert.ok(settled.events.some(e=>e.type==='reset'));
  state.mode='ok';
  assert.equal((await call(`/admin/extract-jobs/${job.id}/retry`,'POST')).status,200);
  settled=await settle(job.id);assert.equal(settled.job.status,'done');assert.equal(settled.events[0].type,'source');

  // An answer cut short keeps the finished seats and lists the broken one.
  state.mode='cut';
  assert.equal((await call(`/admin/extract-jobs/${job.id}/retry`,'POST')).status,200);
  settled=await settle(job.id);assert.equal(settled.job.status,'done');
  ({result}=(await call(`/admin/extract-jobs/${job.id}/result`)).body);assert.equal(result.seats.length,1);assert.deepEqual(result.invalid.map(i=>i.reason),['cut']);

  // Deleting a job removes it with its files.
  assert.equal((await call(`/admin/extract-jobs/${job.id}`,'DELETE')).status,204);
  assert.equal((await call(`/admin/extract-jobs/${job.id}/events`)).status,404);

  // A timetable job keeps the PDF pages, so its source can be shown when the job is reopened.
  const pages={images:['data:image/jpeg;base64,aGVsbG8='],text:'Biology 1',start:'2026-09-21',end:'2026-09-21',fileName:'timetable.pdf',items:[[{str:'Biology 1',box:[1,2,3,4]}]]};
  assert.equal((await call(`/admin/extract-jobs/sessions?batch=${batch.id}`,'POST',{...pages,images:[]})).status,422);
  response=await fetch(`${base}/admin/extract-jobs/sessions?batch=${batch.id}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(pages)});
  assert.equal(response.status,201);const timetable=await response.json();assert.equal(timetable.fileName,'timetable.pdf');
  settled=await settle(timetable.id);assert.equal(settled.job.status,'done');
  ({result}=(await call(`/admin/extract-jobs/${timetable.id}/result`)).body);
  assert.equal(result.sessions[0].subject,'生物');assert.deepEqual(result.sessions[0].grades,[10]);
  assert.deepEqual((await call(`/admin/extract-jobs/${timetable.id}/input`)).body.items,pages.items);
  assert.deepEqual((await call('/admin/extract-jobs')).body.map(j=>j.id),[timetable.id]);

  // Deleting the batch removes its job with the job's files.
  assert.equal((await call('/admin/exams/'+batch.id,'DELETE',{version:batch.version})).status,204);
  assert.deepEqual((await call('/admin/extract-jobs')).body,[]);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM extract_job_blobs').get().n,0);
 }finally{RETRY.pause=pause;state.release?.();await new Promise(r=>server.close(r));instance.close();await new Promise(r=>gateway.close(r));await rm(directory,{recursive:true,force:true});}
});
