import {installExamExtract} from './exam-extract.mjs';
import {extractSeats} from './seat-extract.mjs';
import {installSubjects} from './exam-subjects.mjs';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {batchSchema,seatErrors,schedule} from './exam-model.mjs';
import {seatTemplate,parseSeats,makeSchedulePdf} from './exam-files.mjs';
export function installExams(app,db,{requireAdmin,isAdmin,user,origin,schoolName,timeZone,sso={},llm={}}){
 db.exec(`CREATE TABLE IF NOT EXISTS exam_batches(id TEXT PRIMARY KEY,version INTEGER NOT NULL,draft TEXT NOT NULL,published TEXT,seating TEXT);
 CREATE TABLE IF NOT EXISTS exam_choices(user_id TEXT NOT NULL,batch_id TEXT NOT NULL,exam_id TEXT NOT NULL,PRIMARY KEY(user_id,batch_id,exam_id));`);
 const subjects=installSubjects(app,db,requireAdmin);
 installExamExtract(app,requireAdmin,llm,subjects.list);
 for(const r of db.prepare('SELECT draft FROM exam_batches').all())subjects.register(JSON.parse(r.draft).sessions);
 const signedIn=(req,res,next)=>{if(!user(req)&&!isAdmin(req))return res.status(401).json({error:'请使用学校 Microsoft 账号登录后查看。'});next();};
 const row=id=>db.prepare('SELECT * FROM exam_batches WHERE id=?').get(id);
 const publicBatch=r=>r?.published?JSON.parse(r.published):null;
 const choices=(req,id)=>{const u=user(req);return u?db.prepare('SELECT exam_id FROM exam_choices WHERE user_id=? AND batch_id=?').all(u.id,id).map(r=>r.exam_id):[];};
 const fail=(res,error)=>res.status(422).json({error});
 const conflict=(req,res,r)=>{if(!r){res.status(404).json({error:'考试批次不存在。'});return true;}if(req.body.version!==r.version){res.status(409).json({error:'其他窗口已修改本批次，请刷新后再试。'});return true;}return false;};
 const info=r=>({id:r.id,...JSON.parse(r.draft),version:r.version,publishedAt:publicBatch(r)?.publishedAt||null,seatingPublishedAt:r.seating?JSON.parse(r.seating).publishedAt:null});
 app.get('/api/exams',(req,res)=>res.json(db.prepare('SELECT * FROM exam_batches WHERE published IS NOT NULL').all().map(r=>{const b=publicBatch(r);return {id:b.id,title:b.title,titleEn:b.titleEn,start:b.start,end:b.end};}).sort((a,b)=>b.start.localeCompare(a.start))));
 app.get('/api/exams/:id',(req,res)=>{const r=row(req.params.id),b=publicBatch(r);if(!b)return res.status(404).json({error:'考试安排尚未发布。'});res.json({...b,subjects:subjects.list(),seatingPublished:Boolean(r.seating)});});
 app.get('/api/exams/:id/seats',signedIn,(req,res)=>{const r=row(req.params.id);if(!r?.published||!r.seating)return res.status(404).json({error:'座位表尚未发布。'});res.json(JSON.parse(r.seating));});
 app.get('/api/exams/:id/choices',(req,res)=>{if(!user(req))return res.status(401).json({error:'请先使用学校账号登录。'});res.json(choices(req,req.params.id));});
 app.put('/api/exams/:id/choices',(req,res)=>{
  const u=user(req);if(!u)return res.status(401).json({error:'请先使用学校账号登录。'});
  const b=publicBatch(row(req.params.id)),ids=req.body.ids;
  if(!b)return res.status(404).json({error:'考试批次不存在。'});
  if(!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string'||!b.sessions.some(s=>s.id===id)))return fail(res,'选择中包含未发布的考试。');
  db.transactionSync(()=>{db.prepare('DELETE FROM exam_choices WHERE user_id=? AND batch_id=?').run(u.id,b.id);const put=db.prepare('INSERT INTO exam_choices VALUES(?,?,?)');for(const id of new Set(ids))put.run(u.id,b.id,id);});
  res.json([...new Set(ids)]);
 });
 app.get('/api/exams/:id/pdf',async(req,res)=>{
  const b=publicBatch(row(req.params.id));if(!b)return res.status(404).json({error:'考试批次不存在。'});
  let sessions=b.sessions,scope;
  if(req.query.mine==='1'){if(!user(req))return res.status(401).json({error:'请先登录。'});const ids=choices(req,b.id);sessions=sessions.filter(s=>ids.includes(s.id));scope='我的考试 / My exams';}
  else{if(!['primary','middle','high'].includes(req.query.division))return fail(res,'请选择学部。');sessions=sessions.filter(s=>s.division===req.query.division&&(!req.query.grade||s.grades.includes(req.query.grade)));scope=`${{primary:'小学部',middle:'初中部',high:'高中部'}[req.query.division]}${req.query.grade?' · '+req.query.grade:''}`;}
  sessions.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
  const pdf=await makeSchedulePdf(b,sessions,{schoolName,timeZone,scope,english:req.query.lang==='en'});
  res.set({'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="exam-schedule.pdf"'}).send(pdf);
 });
 app.get('/api/admin/exams',requireAdmin,(req,res)=>res.json(db.prepare('SELECT * FROM exam_batches').all().map(info)));
 app.delete('/api/admin/exams/:id',requireAdmin,(req,res)=>{
  const r=row(req.params.id);if(conflict(req,res,r))return;
  db.transactionSync(()=>{
   db.prepare('DELETE FROM exam_choices WHERE batch_id=?').run(r.id);
   db.prepare('DELETE FROM exam_batches WHERE id=?').run(r.id);
  });
  res.sendStatus(204);
 });
 app.post('/api/admin/exams',requireAdmin,(req,res)=>{
  const parsed=batchSchema.safeParse(req.body);if(!parsed.success)return fail(res,parsed.error.issues.map(i=>i.message).join('；'));
  const b={...parsed.data,id:randomUUID(),version:1,updatedAt:new Date().toISOString()};const errors=seatErrors(b);if(errors.length)return fail(res,errors.join('；'));
  subjects.register(b.sessions);
  db.prepare('INSERT INTO exam_batches VALUES(?,?,?,NULL,NULL)').run(b.id,1,JSON.stringify(b));res.status(201).json(b);
 });
 app.put('/api/admin/exams/:id',requireAdmin,(req,res)=>{
  const r=row(req.params.id);if(conflict(req,res,r))return;
  const parsed=batchSchema.safeParse(req.body);if(!parsed.success)return fail(res,parsed.error.issues.map(i=>i.message).join('；'));
  const data=parsed.data;
  const errors=seatErrors(data);if(errors.length)return fail(res,errors.join('；'));
  const b={...data,id:r.id,version:r.version+1,updatedAt:new Date().toISOString()};subjects.register(b.sessions);db.prepare('UPDATE exam_batches SET version=?,draft=? WHERE id=?').run(b.version,JSON.stringify(b),r.id);res.json(info(row(r.id)));
 });
 app.post('/api/admin/exams/:id/publish',requireAdmin,(req,res)=>{
  const r=row(req.params.id);if(conflict(req,res,r))return;
  const b=JSON.parse(r.draft),previous=publicBatch(r),publishedAt=new Date().toISOString();
  if(!b.sessions.length&&!previous)return fail(res,'至少添加一场考试再发布。');
  const published=schedule(b);published.publishedAt=publishedAt;
  published.sessions=b.sessions.map(s=>{const old=previous?.sessions.find(e=>e.id===s.id);return {...s,changed:Boolean(old&&(old.changed||JSON.stringify({...old,changed:undefined})!==JSON.stringify({...s,changed:undefined})))};});
  // A changed schedule can invalidate room occupancy; require a fresh seating publication.
  const layoutChanged=previous&&JSON.stringify(previous.sessions.map(s=>[s.id,s.date,s.start,s.end,s.rooms,s.cancelled]))!==JSON.stringify(published.sessions.map(s=>[s.id,s.date,s.start,s.end,s.rooms,s.cancelled]));
  db.transactionSync(()=>{
   db.prepare('UPDATE exam_batches SET published=?,seating=?,version=? WHERE id=?').run(JSON.stringify(published),layoutChanged?null:r.seating,r.version+1,r.id);
   const removeChoice=db.prepare('DELETE FROM exam_choices WHERE batch_id=? AND exam_id=?');
   for(const exam of previous?.sessions||[])if(!published.sessions.some(s=>s.id===exam.id))removeChoice.run(r.id,exam.id);
  });
  res.json(info(row(r.id)));
 });
 app.post('/api/admin/exams/:id/publish-seats',requireAdmin,(req,res)=>{
  const r=row(req.params.id);if(conflict(req,res,r))return;
  const b=JSON.parse(r.draft),published=publicBatch(r);if(!published)return fail(res,'请先发布考试安排。');
  if(JSON.stringify(b.sessions)!==JSON.stringify(published.sessions.map(({changed,...s})=>s)))return fail(res,'考试安排有未发布修改，请先发布考试安排。');
  const errors=seatErrors(b);if(errors.length)return fail(res,errors.join('；'));if(!b.seats.length)return fail(res,'请先填写座位。');
  db.prepare('UPDATE exam_batches SET seating=?,version=? WHERE id=?').run(JSON.stringify({rooms:b.rooms,seats:b.seats,publishedAt:new Date().toISOString()}),r.version+1,r.id);res.json(info(row(r.id)));
 });
 app.get('/api/admin/exams/:id/template',requireAdmin,async(req,res)=>{const r=row(req.params.id);if(!r)return res.sendStatus(404);res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="exam-seats-template.xlsx"'}).send(Buffer.from(await seatTemplate(JSON.parse(r.draft))));});
 app.post('/api/admin/exams/:id/seat-extract',requireAdmin,express.raw({type:'application/octet-stream',limit:'2mb'}),async(req,res)=>{
  const r=row(req.params.id);if(!r)return res.sendStatus(404);
  if(Number(req.headers['x-draft-version'])!==r.version)return res.status(409).json({error:'草稿已修改，请刷新后重新提取。'});
  if(!Buffer.isBuffer(req.body)||!String(req.headers['x-file-name']||'').toLowerCase().endsWith('.xlsx'))return fail(res,'仅支持 .xlsx 文件。');
  try{res.json(await extractSeats(req.body,JSON.parse(r.draft),llm));}catch(error){const message=error.message||'';return fail(res,/^(请|仅|Excel|最多|表格|工作簿|LLM Worker|模型)/.test(message)?message:'无法提取座位表，请检查文件及 LLM Worker 配置后重试。');}
 });
 app.post('/api/admin/exams/:id/import-preview',requireAdmin,express.raw({type:'application/octet-stream',limit:'2mb'}),async(req,res)=>{
  const r=row(req.params.id);if(!r)return res.sendStatus(404);if(!Buffer.isBuffer(req.body))return fail(res,'请上传 Excel 文件。');
  try{res.json(await parseSeats(req.body,JSON.parse(r.draft)));}catch(error){return fail(res,error.message||'无法读取 Excel 文件。');}
 });
}
