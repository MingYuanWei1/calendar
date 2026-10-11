// 提取任务: AI extractions that keep running after the administrator closes the page (ADR 0001). A job belongs to an
// exam batch and is visible to every administrator. Its input, the prepared model request and the results are kept
// in chunks (Durable Object SQLite stores at most 2 MB per value); progress is an append-only list of the same
// messages the streaming endpoints send, which the console polls.
import express from 'express';
import {randomUUID} from 'node:crypto';
import {runExtraction,localStep,unpackAnswer} from './extract-run.mjs';

const CHUNK=512*1024,KEEP_MS=7*86400000,STALE_MS=4*60000,MAX_FILE=10*1024*1024,EVENTS_PER_READ=500;
const OPS=['begin','record','generated','finalize','fail'];
export const JOB_OPS=OPS;

/** Node: jobs run in this process. */
export const localRunner=(ops,config,step=localStep())=>({
 start:(jobId,run)=>{setImmediate(()=>runExtraction({jobId,run,ops,config,step}));},
 cancel(){}
});

/**
 * `tasks.seats` / `tasks.sessions`: {prepare(input Buffer, draft) → {request, context, source?}, finish(context, raw),
 * salvage(context, items) → partial|null, failure(error) → message, itemKey}. `draft(batchId)` returns the batch draft.
 */
export function installExtractJobs(app,db,{requireAdmin,quota,user,llm,tasks,draft,runner=localRunner}){
 db.exec(`CREATE TABLE IF NOT EXISTS extract_jobs(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,file_name TEXT NOT NULL,created_by TEXT NOT NULL,created_at INTEGER NOT NULL,started_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,finished_at INTEGER,run INTEGER NOT NULL,attempt INTEGER NOT NULL,items INTEGER NOT NULL,error TEXT);
 CREATE TABLE IF NOT EXISTS extract_job_events(job_id TEXT NOT NULL,seq INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(job_id,seq));
 CREATE TABLE IF NOT EXISTS extract_job_blobs(job_id TEXT NOT NULL,name TEXT NOT NULL,part INTEGER NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(job_id,name,part));`);

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
 const summary=r=>({id:r.id,batchId:r.batch_id,kind:r.kind,status:status(r),fileName:r.file_name,createdBy:r.created_by,createdAt:r.created_at,startedAt:r.started_at,updatedAt:r.updated_at,finishedAt:r.finished_at,items:r.items,error:r.error});

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

 /** Stores the prepared request (made from the input and the current draft) and starts a new run. */
 async function launch(id,prepared,{fresh}){
  const r=job(id),run=fresh?1:r.run+1;
  db.transactionSync(()=>{
   for(const name of ['prepared','answer','result','partial'])db.prepare('DELETE FROM extract_job_blobs WHERE job_id=? AND name=?').run(id,name);
   db.prepare('DELETE FROM extract_job_events WHERE job_id=?').run(id);
   putJson(id,'prepared',{request:prepared.request,context:prepared.context});
   db.prepare("UPDATE extract_jobs SET status='running',run=?,attempt=0,items=0,error=NULL,finished_at=NULL,started_at=?,updated_at=? WHERE id=?").run(run,Date.now(),Date.now(),id);
   append(id,[...(prepared.source?[{type:'source',...prepared.source}]:[]),{type:'stage',stage:'preparing'}]);
  });
  try{await runs.start(id,run);}
  catch(error){console.error('Extraction job did not start:',error.message);await ops.fail(id,run,{name:'Error',message:'后台任务未能启动，请稍后重试。'},null);}
 }
 const refuse=(res,status,error)=>res.status(status).json({error});

 app.post('/api/admin/extract-jobs/:kind',requireAdmin,express.raw({type:'application/octet-stream',limit:MAX_FILE}),async(req,res)=>{
  const kind=req.params.kind,task=tasks[kind];if(!task)return res.sendStatus(404);
  const batchId=String(req.query.batch||''),batch=draft(batchId);if(!batch)return refuse(res,404,'考试批次不存在。');
  let input,fileName;
  if(kind==='seats'){
   fileName=decodeURIComponent(String(req.headers['x-file-name']||''));
   if(!Buffer.isBuffer(req.body)||!fileName.toLowerCase().endsWith('.xlsx'))return refuse(res,422,'仅支持 .xlsx 文件（最大 10 MB）。');
   input=req.body;
  }else{
   const invalid=task.validate(req.body);if(invalid)return refuse(res,422,invalid);
   fileName=String(req.body.fileName||'exam.pdf').slice(0,200);input=Buffer.from(JSON.stringify(req.body));
  }
  purge();
  const running=db.prepare("SELECT * FROM extract_jobs WHERE batch_id=? AND status='running'").all(batchId).find(r=>status(r)==='running');
  if(running)return refuse(res,409,'本批次已有提取任务正在进行，请等待完成或先取消。');
  let prepared;
  try{prepared=await task.prepare(input,batch);}catch(error){return refuse(res,422,error.message||'无法读取文件。');}
  const refused=quota.take(req,'extract');if(refused)return res.status(429).json(refused);
  const id=randomUUID(),now=Date.now();
  db.transactionSync(()=>{
   for(const r of db.prepare('SELECT id FROM extract_jobs WHERE batch_id=?').all(batchId))remove(r.id);
   db.prepare("INSERT INTO extract_jobs VALUES(?,?,?,'running',?,?,?,?,?,NULL,1,0,0,NULL)").run(id,batchId,kind,fileName,user(req)?.name||'',now,now,now);
   putBlob(id,'input',input);
  });
  await launch(id,prepared,{fresh:true});
  res.status(201).json(summary(job(id)));
 });
 app.get('/api/admin/extract-jobs',requireAdmin,(req,res)=>{purge();res.json(db.prepare('SELECT * FROM extract_jobs ORDER BY created_at DESC').all().map(summary));});
 const found=(req,res)=>{const r=job(req.params.id);if(!r)res.status(404).json({error:'提取任务不存在或已过期。'});return r;};
 app.get('/api/admin/extract-jobs/:id/events',requireAdmin,(req,res)=>{
  const r=found(req,res);if(!r)return;
  const after=Number(req.query.after)||0;
  const events=db.prepare('SELECT seq,body FROM extract_job_events WHERE job_id=? AND seq>? ORDER BY seq LIMIT ?').all(r.id,after,EVENTS_PER_READ).map(e=>({seq:e.seq,...JSON.parse(e.body)}));
  res.json({job:summary(r),events});
 });
 app.get('/api/admin/extract-jobs/:id/input',requireAdmin,(req,res)=>{
  const r=found(req,res);if(!r)return;
  if(r.kind!=='sessions')return res.sendStatus(404);
  res.set('Content-Type','application/json').send(getBlob(r.id,'input'));
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
  const batch=draft(r.batch_id);if(!batch)return refuse(res,404,'考试批次不存在。');
  let prepared;
  try{prepared=await tasks[r.kind].prepare(getBlob(r.id,'input'),batch);}catch(error){return refuse(res,422,error.message||'无法读取文件。');}
  const refused=quota.take(req,'extract');if(refused)return res.status(429).json(refused);
  await launch(r.id,prepared,{fresh:false});
  res.json(summary(job(r.id)));
 });
 app.delete('/api/admin/extract-jobs/:id',requireAdmin,async(req,res)=>{
  const r=found(req,res);if(!r)return;
  if(r.status==='running')await Promise.resolve(runs.cancel(r.id,r.run)).catch(()=>{});
  db.transactionSync(()=>remove(r.id));res.sendStatus(204);
 });
 return {ops,forBatch:batchId=>db.prepare('SELECT id FROM extract_jobs WHERE batch_id=?').all(batchId).forEach(r=>db.transactionSync(()=>remove(r.id)))};
}
