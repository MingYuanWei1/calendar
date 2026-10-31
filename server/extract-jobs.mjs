// 提取任务: AI readings that keep running after the administrator closes the page (ADR 0001). A job belongs to a
// scope — an exam batch's id for the exam kinds, or a kind's own scope for the rest — and every administrator who may
// use its kind sees it. Its input materials, the prepared model request and the results are kept in chunks (Durable
// Object SQLite stores at most 2 MB per value); progress is an append-only list of the same messages the streaming
// endpoints send, which the console polls.
import express from 'express';
import {randomUUID} from 'node:crypto';
import {runExtraction,localStep,unpackAnswer} from './extract-run.mjs';
import {readMaterials,materialsName,UPLOAD_LIMIT} from './materials.mjs';

const CHUNK=512*1024,KEEP_MS=7*86400000,STALE_MS=4*60000,EVENTS_PER_READ=500;
const OPS=['begin','part','record','generated','finalize','fail'];
export const JOB_OPS=OPS;

/** Node: jobs run in this process. */
export const localRunner=(ops,config,step=localStep())=>({
 start:(jobId,run)=>{setImmediate(()=>runExtraction({jobId,run,ops,config,step}));},
 cancel(){}
});

/**
 * A task (`register(kind, task)`): {scope(req) → the scope its jobs belong to, or null when that does not exist,
 * missing (the message for a null scope), allowed?(req) → whether this administrator may use the kind,
 * options?(fields) → the settings sent with the materials, kept with the job so a retry prepares the same way,
 * prepare(materials {parts, workbooks, fields}, scope, options) → {request, context, source?}, finish(context, raw),
 * salvage(context, items) → partial|null, failure(error) → message, itemKey}. `prepare` throws an error whose
 * message the administrator sees (status 404 when the scope is gone, else 422).
 */
export function installExtractJobs(app,db,{requireAdmin,quota,user,llm,runner=localRunner}){
 db.exec(`CREATE TABLE IF NOT EXISTS extract_jobs(id TEXT PRIMARY KEY,scope TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,file_name TEXT NOT NULL,created_by TEXT NOT NULL,created_at INTEGER NOT NULL,started_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,finished_at INTEGER,run INTEGER NOT NULL,attempt INTEGER NOT NULL,items INTEGER NOT NULL,error TEXT);
 CREATE TABLE IF NOT EXISTS extract_job_events(job_id TEXT NOT NULL,seq INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(job_id,seq));
 CREATE TABLE IF NOT EXISTS extract_job_blobs(job_id TEXT NOT NULL,name TEXT NOT NULL,part INTEGER NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(job_id,name,part));`);
 // Jobs used to belong to exam batches only.
 if(db.prepare('PRAGMA table_info(extract_jobs)').all().some(column=>column.name==='batch_id'))db.exec('ALTER TABLE extract_jobs RENAME COLUMN batch_id TO scope');
 const tasks={};

 /* — storage — */
 const putBlob=(id,name,buffer)=>{
  db.prepare('DELETE FROM extract_job_blobs WHERE job_id=? AND name=?').run(id,name);
  const bytes=new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.byteLength);
  for(let offset=0,part=0;offset<bytes.length||part===0;offset+=CHUNK,part++)db.prepare('INSERT INTO extract_job_blobs VALUES(?,?,?,?)').run(id,name,part,bytes.slice(offset,offset+CHUNK));
 };
 const getBlob=(id,name)=>{
  const rows=db.prepare('SELECT bytes FROM extract_job_blobs WHERE job_id=? AND name=? ORDER BY part').all(id,name);
  return rows.length?Buffer.concat(rows.map(r=>Buffer.from(r.bytes))):null;
 };
 const putJson=(id,name,value)=>putBlob(id,name,Buffer.from(JSON.stringify(value)));
 const getJson=(id,name)=>{const buffer=getBlob(id,name);return buffer?JSON.parse(buffer.toString()):null;};
 // The materials: parts and settings as JSON, each workbook as its own blob.
 const putMaterials=(id,{parts,workbooks,fields})=>{
  putJson(id,'input',{parts,fields,workbooks:workbooks.map(w=>w.name)});
  workbooks.forEach((w,i)=>putBlob(id,`workbook:${i}`,w.buffer));
 };
 const getMaterials=r=>{
  const raw=getBlob(r.id,'input');
  // Jobs started before materials were uploaded as one form kept a seating workbook as the whole input…
  if(raw[0]!==0x7b)return {parts:[],workbooks:[{name:r.file_name,buffer:raw}],fields:{}};
  const input=JSON.parse(raw.toString());
  if(input.fields)return {parts:input.parts,fields:input.fields,workbooks:input.workbooks.map((name,i)=>({name,buffer:getBlob(r.id,`workbook:${i}`)}))};
  // …or the JSON body itself, which once held PDF pages as {images, text}.
  const {parts,images,text,items:_,...fields}=input;
  return {parts:parts||(images||[]).map((image,i)=>({kind:'image',image,text:i?'':String(text||'').slice(0,20000)})),workbooks:[],fields};
 };
 const append=(id,messages)=>{
  if(!messages.length)return;
  let seq=db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM extract_job_events WHERE job_id=?').get(id).n;
  for(const message of messages)db.prepare('INSERT INTO extract_job_events VALUES(?,?,?)').run(id,++seq,JSON.stringify(message));
  const items=messages.filter(m=>m.type==='item').length,reset=messages.some(m=>m.type==='reset');
  db.prepare(`UPDATE extract_jobs SET items=${reset?'0':'items'}+?,updated_at=? WHERE id=?`).run(items,Date.now(),id);
 };
 const remove=id=>{for(const table of ['extract_job_events','extract_job_blobs'])db.prepare(`DELETE FROM ${table} WHERE job_id=?`).run(id);db.prepare('DELETE FROM extract_jobs WHERE id=?').run(id);};
 const purge=()=>{for(const r of db.prepare('SELECT id FROM extract_jobs WHERE created_at<?').all(Date.now()-KEEP_MS))db.transactionSync(()=>remove(r.id));};
 const job=id=>db.prepare('SELECT * FROM extract_jobs WHERE id=?').get(id);
 // A running job whose runner stopped reporting (a restart, a lost Workflow) is shown as interrupted.
 const status=r=>r.status==='running'&&r.updated_at<Date.now()-STALE_MS?'interrupted':r.status;
 const summary=r=>({id:r.id,scope:r.scope,kind:r.kind,status:status(r),fileName:r.file_name,createdBy:r.created_by,createdAt:r.created_at,startedAt:r.started_at,updatedAt:r.updated_at,finishedAt:r.finished_at,items:r.items,error:r.error});
 const allowed=(req,kind)=>Boolean(tasks[kind])&&(tasks[kind].allowed?.(req)??true);

 /* — the runner's view of a job; every call names its run so a superseded runner changes nothing — */
 const current=(id,run)=>{const r=job(id);return r&&r.run===run&&r.status==='running'?r:null;};
 const end=(id,fields,message)=>db.transactionSync(()=>{
  db.prepare('UPDATE extract_jobs SET status=?,error=?,finished_at=?,updated_at=? WHERE id=?').run(fields.status,fields.error||null,Date.now(),Date.now(),id);
  append(id,[message]);
 });
 const ops={
  async begin(id,run){
   const r=current(id,run);if(!r)return null;
   const attempt=r.attempt+1;
   db.transactionSync(()=>{db.prepare('UPDATE extract_jobs SET attempt=? WHERE id=?').run(attempt,id);if(attempt>1)append(id,[{type:'reset'}]);});
   return {request:getJson(id,'prepared').request,attempt};
  },
  // The parts' model requests are kept apart and handed over one at a time: together they may exceed what one
  // Workflow RPC (or its memory) can carry.
  async part(id,run,index){return current(id,run)?getJson(id,`part:${index}`):null;},
  async record(id,run,messages){
   if(!current(id,run))return {stop:true};
   db.transactionSync(()=>{if(messages.length)append(id,messages);else db.prepare('UPDATE extract_jobs SET updated_at=? WHERE id=?').run(Date.now(),id);});
   return {stop:false};
  },
  async generated(id,run,answer){if(current(id,run))putJson(id,'answer',answer);},
  async finalize(id,run){
   const r=current(id,run);if(!r)return;
   const task=tasks[r.kind],{context}=getJson(id,'prepared');
   let result;
   try{result=task.finish(context,unpackAnswer(getJson(id,'answer')));}
   catch(error){return ops.fail(id,run,{name:error.name,message:error.message},null);}
   putJson(id,'result',result);
   end(id,{status:'done'},{type:'done',elapsed:Date.now()-r.started_at,count:result[task.itemKey].length});
  },
  async fail(id,run,error,items){
   const r=current(id,run);if(!r)return;
   const task=tasks[r.kind],{context}=getJson(id,'prepared');
   const partial=task.salvage(context,items?.[task.itemKey]);
   if(partial)putJson(id,'partial',partial);
   const cause=error.name==='SyntaxError'?new SyntaxError(error.message):Object.assign(new Error(error.message),{name:error.name,status:error.status});
   const message=task.failure(cause);
   console.error('Extraction job failed:',id,error.name,error.message);
   end(id,{status:'failed',error:message},{type:'error',error:message,partial:partial?partial[task.itemKey].length:0});
  }
 };
 const runs=runner(ops,llm);

 /** Stores the prepared request (made from the materials and the current data) and starts a new run. */
 async function launch(id,prepared,{fresh}){
  const r=job(id),run=fresh?1:r.run+1;
  const parts=prepared.request.parts||[{body:prepared.request.body}];
  db.transactionSync(()=>{
   db.prepare("DELETE FROM extract_job_blobs WHERE job_id=? AND (name IN ('prepared','answer','result','partial') OR name LIKE 'part:%')").run(id);
   db.prepare('DELETE FROM extract_job_events WHERE job_id=?').run(id);
   const {body:_,...request}=prepared.request;
   putJson(id,'prepared',{request:{...request,parts:parts.map(({body,...rest})=>rest)},context:prepared.context});
   parts.forEach((part,i)=>putJson(id,`part:${i}`,part.body));
   db.prepare("UPDATE extract_jobs SET status='running',run=?,attempt=0,items=0,error=NULL,finished_at=NULL,started_at=?,updated_at=? WHERE id=?").run(run,Date.now(),Date.now(),id);
   append(id,[...(prepared.source?[{type:'source',...prepared.source}]:[]),{type:'stage',stage:'preparing'}]);
  });
  try{await runs.start(id,run);}
  catch(error){console.error('Extraction job did not start:',error.message);await ops.fail(id,run,{name:'Error',message:'后台任务未能启动，请稍后重试。'},null);}
 }
 const refuse=(res,status,error)=>res.status(status).json({error});
 const prepare=async(res,task,materials,scope,options)=>{
  try{return await task.prepare(materials,scope,options);}
  catch(error){refuse(res,error.status===404?404:422,error.message||'无法读取材料。');return null;}
 };

 // The materials come as one multipart form (see readMaterials).
 app.post('/api/admin/extract-jobs/:kind',requireAdmin,express.raw({type:'multipart/form-data',limit:UPLOAD_LIMIT}),async(req,res)=>{
  const kind=req.params.kind,task=tasks[kind];if(!task)return res.sendStatus(404);
  if(!allowed(req,kind))return refuse(res,403,'当前账户没有操作权限。');
  const scope=task.scope(req);if(!scope)return refuse(res,404,task.missing);
  let materials;
  try{materials=await readMaterials(req);}catch(error){return refuse(res,error.status||422,error.message);}
  purge();
  const running=db.prepare("SELECT * FROM extract_jobs WHERE scope=? AND kind=? AND status='running'").all(scope,kind).find(r=>status(r)==='running');
  if(running)return refuse(res,409,'已有同类提取任务正在进行，请等待完成或先取消。');
  let options;
  try{options=task.options?.(materials.fields)??null;}catch(error){return refuse(res,422,error.message);}
  const prepared=await prepare(res,task,materials,scope,options);if(!prepared)return;
  const refused=quota.take(req,'extract');if(refused)return res.status(429).json(refused);
  const id=randomUUID(),now=Date.now();
  db.transactionSync(()=>{
   for(const r of db.prepare('SELECT id FROM extract_jobs WHERE scope=? AND kind=?').all(scope,kind))remove(r.id);
   db.prepare("INSERT INTO extract_jobs VALUES(?,?,?,'running',?,?,?,?,?,NULL,1,0,0,NULL)").run(id,scope,kind,materialsName(materials),user(req)?.name||'',now,now,now);
   putMaterials(id,materials);
   if(options!=null)putJson(id,'options',options);
  });
  await launch(id,prepared,{fresh:true});
  res.status(201).json(summary(job(id)));
 });
 app.get('/api/admin/extract-jobs',requireAdmin,(req,res)=>{purge();res.json(db.prepare('SELECT * FROM extract_jobs ORDER BY created_at DESC').all().filter(r=>allowed(req,r.kind)).map(summary));});
 const found=(req,res)=>{const r=job(req.params.id);if(!r||!allowed(req,r.kind)){res.status(404).json({error:'提取任务不存在或已过期。'});return null;}return r;};
 app.get('/api/admin/extract-jobs/:id/events',requireAdmin,(req,res)=>{
  const r=found(req,res);if(!r)return;
  const after=Number(req.query.after)||0;
  const events=db.prepare('SELECT seq,body FROM extract_job_events WHERE job_id=? AND seq>? ORDER BY seq LIMIT ?').all(r.id,after,EVENTS_PER_READ).map(e=>({seq:e.seq,...JSON.parse(e.body)}));
  res.json({job:summary(r),events});
 });
 app.get('/api/admin/extract-jobs/:id/input',requireAdmin,(req,res)=>{
  const r=found(req,res);if(!r)return;
  // Workbooks have their own source pane (the sheets, sent as the job's source message); only materials come back.
  const input=getBlob(r.id,'input');if(input[0]!==0x7b)return res.sendStatus(404);
  res.set('Content-Type','application/json').send(input);
 });
 app.get('/api/admin/extract-jobs/:id/result',requireAdmin,(req,res)=>{const r=found(req,res);if(!r)return;res.json({result:getJson(r.id,'result'),partial:getJson(r.id,'partial')});});
 app.post('/api/admin/extract-jobs/:id/cancel',requireAdmin,async(req,res)=>{
  const r=found(req,res);if(!r)return;
  if(r.status==='running'){end(r.id,{status:'cancelled'},{type:'cancelled'});await Promise.resolve(runs.cancel(r.id,r.run)).catch(()=>{});}
  res.json(summary(job(r.id)));
 });
 app.post('/api/admin/extract-jobs/:id/retry',requireAdmin,async(req,res)=>{
  const r=found(req,res);if(!r)return;
  if(status(r)==='running')return refuse(res,409,'提取任务仍在进行。');
  const prepared=await prepare(res,tasks[r.kind],getMaterials(r),r.scope,getJson(r.id,'options'));if(!prepared)return;
  const refused=quota.take(req,'extract');if(refused)return res.status(429).json(refused);
  await launch(r.id,prepared,{fresh:false});
  res.json(summary(job(r.id)));
 });
 app.delete('/api/admin/extract-jobs/:id',requireAdmin,async(req,res)=>{
  const r=found(req,res);if(!r)return;
  if(r.status==='running')await Promise.resolve(runs.cancel(r.id,r.run)).catch(()=>{});
  db.transactionSync(()=>remove(r.id));res.sendStatus(204);
 });
 return {
  ops,
  register(kind,task){tasks[kind]=task;},
  /** Removes every job of `scope`, e.g. when its exam batch is deleted. */
  forScope:scope=>db.prepare('SELECT id FROM extract_jobs WHERE scope=?').all(scope).forEach(r=>db.transactionSync(()=>remove(r.id)))
 };
}
