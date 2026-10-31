import {installExamMatching} from './exam-matching.mjs';
import {installStudents} from './students.mjs';
import {installExamExtract,prepareSessions,finishSessions,salvageSessions,extractionFailure} from './exam-extract.mjs';
import {prepareSeats,finishSeats,salvageSeats,seatMode,SEAT_TIMEOUT} from './seat-extract.mjs';
import {registerExamChecks} from './exam-check.mjs';
import {installSubjects} from './exam-subjects.mjs';
import {installSchoolRules} from './school-rules.mjs';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {adaptRooms,batchEvent,batchSchema,numberGrades,seatErrors,schedule,scheduleKey} from './exam-model.mjs';
import {seatTemplate,parseSeats} from './exam-files.mjs';
import {examTimetablePdf} from './exam-timetable-pdf.mjs';
import {examPdfName} from '../public/exam-file-name.mjs';
import {modeConflicts} from '../public/exam-seats.mjs';
export function installExams(app,db,{requireAdmin,requireSystemAdmin,isAdmin,user,origin,timeZone,sso={},llm={},jobs,checks}){
 db.exec(`CREATE TABLE IF NOT EXISTS exam_batches(id TEXT PRIMARY KEY,version INTEGER NOT NULL,draft TEXT NOT NULL,published TEXT,seating TEXT);
 CREATE TABLE IF NOT EXISTS exam_choices(user_id TEXT NOT NULL,batch_id TEXT NOT NULL,exam_id TEXT NOT NULL,PRIMARY KEY(user_id,batch_id,exam_id));`);
 const students=installStudents(app,db,requireSystemAdmin);
 const matching=installExamMatching(app,db,{user,students});
 const subjects=installSubjects(app,db,requireAdmin);
 const schoolRules=installSchoolRules(app,db,{requireAdmin,subjects});
 installExamExtract(app,requireAdmin,llm);
 // Grades used to be free-text labels; store them as numbers 1–12 (see numberGrades).
 for(const r of db.prepare('SELECT id,draft,published FROM exam_batches').all()){
  const draft=numberGrades(JSON.parse(r.draft)),published=r.published&&numberGrades(JSON.parse(r.published));
  if(draft)db.prepare('UPDATE exam_batches SET draft=? WHERE id=?').run(JSON.stringify(draft),r.id);
  if(published)db.prepare('UPDATE exam_batches SET published=? WHERE id=?').run(JSON.stringify(published),r.id);
 }
 for(const r of db.prepare('SELECT draft FROM exam_batches').all())subjects.register(JSON.parse(r.draft).sessions);
 const signedIn=(req,res,next)=>{if(!user(req)&&!isAdmin(req))return res.status(401).json({error:'请使用学校 Microsoft 账号登录后查看。'});next();};
 const row=id=>db.prepare('SELECT * FROM exam_batches WHERE id=?').get(id);
 const publicBatch=r=>r?.published?JSON.parse(r.published):null;
 const choices=(req,id)=>{const u=user(req);return u?db.prepare('SELECT exam_id FROM exam_choices WHERE user_id=? AND batch_id=?').all(u.id,id).map(r=>r.exam_id):[];};
 const fail=(res,error)=>res.status(422).json({error});
 const conflict=(req,res,r)=>{if(!r){res.status(404).json({error:'考试批次不存在。'});return true;}if(req.body.version!==r.version){res.status(409).json({error:'其他窗口已修改本批次，请刷新后再试。'});return true;}return false;};
 // Seats compare without the student details that organize adds and publishSeats replaces with matchEmail.
 const sorted=o=>JSON.stringify(o,Object.keys(o).sort());
 const seatingKey=b=>JSON.stringify([b.rooms.map(({sizeReview,...room})=>sorted(room)),b.seats.map(({student,identityIssues,candidates,matchEmail,grade,...seat})=>sorted(seat))]);
 const info=r=>{const draft=JSON.parse(r.draft),published=publicBatch(r),seating=r.seating&&JSON.parse(r.seating);return {id:r.id,...draft,version:r.version,publishedAt:published?.publishedAt||null,scheduleChanged:Boolean(published&&scheduleKey(draft)!==scheduleKey(published)),seatingPublishedAt:seating?.publishedAt||null,seatingChanged:Boolean(seating&&seatingKey(draft)!==seatingKey(seating))};};
 app.get('/api/exams',(req,res)=>res.json(db.prepare('SELECT * FROM exam_batches WHERE published IS NOT NULL').all().map(r=>{const b=publicBatch(r);return {id:b.id,title:b.title,titleEn:b.titleEn,start:b.start,end:b.end};}).sort((a,b)=>b.start.localeCompare(a.start))));
 app.get('/api/exams/:id',(req,res)=>{const r=row(req.params.id),b=publicBatch(r);if(!b)return res.status(404).json({error:'考试安排尚未发布。'});res.json({...b,subjects:subjects.list(),seatingPublished:Boolean(r.seating),seatingPublishedAt:r.seating?JSON.parse(r.seating).publishedAt:null});});
 app.get('/api/exams/:id/seats',signedIn,(req,res)=>{const r=row(req.params.id);if(!r?.published||!r.seating)return res.status(404).json({error:'座位表尚未发布。'});const seating=JSON.parse(r.seating);res.json({...seating,seats:seating.seats.map(({matchEmail,...seat})=>seat),personal:matching.personal(user(req),r.id)});});
 app.get('/api/exams/:id/choices',(req,res)=>{if(!user(req))return res.status(401).json({error:'请先使用学校账号登录。'});res.json(choices(req,req.params.id));});
 app.put('/api/exams/:id/choices',(req,res)=>{
  const u=user(req);if(!u)return res.status(401).json({error:'请先使用学校账号登录。'});
  const b=publicBatch(row(req.params.id)),ids=req.body.ids;
  if(!b)return res.status(404).json({error:'考试批次不存在。'});
  if(!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string'||!b.sessions.some(s=>s.id===id)))return fail(res,'选择中包含未发布的考试。');
  db.transactionSync(()=>{matching.selected(u,b.id,ids);db.prepare('DELETE FROM exam_choices WHERE user_id=? AND batch_id=?').run(u.id,b.id);const put=db.prepare('INSERT INTO exam_choices VALUES(?,?,?)');for(const id of new Set(ids))put.run(u.id,b.id,id);});
  res.json([...new Set(ids)]);
 });
 app.get('/api/exams/:id/pdf',async(req,res)=>{
  const b=publicBatch(row(req.params.id));if(!b)return res.status(404).json({error:'考试批次不存在。'});
  const scope=req.query.scope,english=req.query.lang==='en',grades=[...new Set(String(req.query.grades||'').split(',').map(Number))].filter(g=>Number.isInteger(g)&&g>=1&&g<=12);
  if(!['all','grades','mine'].includes(scope))return fail(res,'请选择导出范围。');
  if(scope==='grades'&&!grades.length)return fail(res,'请至少选择一个年级。');
  const u=user(req);if(scope==='mine'&&!u)return res.status(401).json({error:'请先登录。'});
  const mine=scope==='mine'?choices(req,b.id):[];
  // My exams list only the student's own room once the seating places them.
  const seats=scope==='mine'?matching.personal(u,b.id):{};
  const sessions=b.sessions.filter(s=>!s.cancelled&&(scope==='all'||(scope==='mine'?mine.includes(s.id):s.grades.some(g=>grades.includes(g))))).map(s=>seats[s.id]?{...s,rooms:[seats[s.id].room]}:s);
  if(!sessions.length)return fail(res,'此范围暂无考试。');
  const pdf=await examTimetablePdf(b,sessions,{scope,grades,name:u?.name||'',english,timeZone});
  const name=examPdfName(b,{scope,grades,email:u?.email,english});
  res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${name.replace(/[^\x20-\x7e]|"/g,'_')}"; filename*=UTF-8''${encodeURIComponent(name)}`}).send(pdf);
 });
 app.get('/api/admin/exams',requireAdmin,(req,res)=>res.json(db.prepare('SELECT * FROM exam_batches').all().map(info)));
 // 预览并发布: the published schedule and seating, for the preview to show what the draft changes.
 app.get('/api/admin/exams/:id/published',requireAdmin,(req,res)=>{
  const r=row(req.params.id);if(!r)return res.status(404).json({error:'考试批次不存在。'});
  const seating=r.seating&&JSON.parse(r.seating);
  res.json({schedule:publicBatch(r),seating:seating?{...seating,seats:seating.seats.map(({matchEmail,...seat})=>seat)}:null});
 });
 app.delete('/api/admin/exams/:id',requireAdmin,(req,res)=>{
  const r=row(req.params.id);if(conflict(req,res,r))return;
  db.transactionSync(()=>{
   db.prepare('DELETE FROM exam_choices WHERE batch_id=?').run(r.id);
   db.prepare('DELETE FROM exam_personal_state WHERE batch_id=?').run(r.id);
   db.prepare('DELETE FROM exam_batches WHERE id=?').run(r.id);
  });
  jobs.forScope(r.id);
  res.sendStatus(204);
 });
 app.post('/api/admin/exams',requireAdmin,(req,res)=>{
  const parsed=batchSchema.safeParse(req.body);if(!parsed.success)return fail(res,parsed.error.issues.map(i=>i.message).join('；'));
  const b={...parsed.data,id:randomUUID(),version:1,updatedAt:new Date().toISOString()};const errors=seatErrors(b);if(errors.length)return fail(res,errors.join('；'));
  subjects.register(b.sessions);
  const organized=db.transactionSync(()=>{const value=students.organize(b);db.prepare('INSERT INTO exam_batches VALUES(?,?,?,NULL,NULL)').run(b.id,1,JSON.stringify(value));return value;});res.status(201).json(organized);
 });
 /** Saves `data` as the draft of batch row `r` (an edit, or a check's corrections); returns an error message or null. */
 const saveDraft=(r,data)=>{
  const parsed=batchSchema.safeParse(data);if(!parsed.success)return parsed.error.issues.map(i=>i.message).join('；');
  const errors=seatErrors(parsed.data);if(errors.length)return errors.join('；');
  const b={...parsed.data,id:r.id,version:r.version+1,updatedAt:new Date().toISOString()};subjects.register(b.sessions);db.transactionSync(()=>{const value=students.organize(b);db.prepare('UPDATE exam_batches SET version=?,draft=? WHERE id=?').run(b.version,JSON.stringify(value),r.id);});
  return null;
 };
 app.put('/api/admin/exams/:id',requireAdmin,(req,res)=>{
  const r=row(req.params.id);if(conflict(req,res,r))return;
  const error=saveDraft(r,req.body);if(error)return fail(res,error);
  res.json(info(row(r.id)));
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
  const errors=seatErrors(b);if(errors.length)return fail(res,errors.join('；'));
  const unconfirmed=b.rooms.filter(room=>room.sizeReview).map(room=>room.name);
  if(unconfirmed.length)return fail(res,`教室 ${unconfirmed.join('、')} 的尺寸由座位表自动调整，请先在教室设置中确认。`);
  db.prepare('UPDATE exam_batches SET seating=?,version=? WHERE id=?').run(JSON.stringify({rooms:b.rooms,seats:students.publishSeats(b),publishedAt:new Date().toISOString()}),r.version+1,r.id);res.json(info(row(r.id)));
 });
 // 丢弃未发布修改: put the published schedule and/or published seating back into the draft.
 app.post('/api/admin/exams/:id/discard',requireAdmin,(req,res)=>{
  const r=row(req.params.id);if(conflict(req,res,r))return;
  const restoreSchedule=req.body.schedule===true,restoreSeats=req.body.seats===true;
  if(!restoreSchedule&&!restoreSeats)return fail(res,'请选择要恢复的内容。');
  const published=publicBatch(r),seating=r.seating&&JSON.parse(r.seating);
  if(restoreSchedule&&!published)return fail(res,'考试安排尚未发布，无法恢复。');
  if(restoreSeats&&!seating)return fail(res,'座位表尚未发布，无法恢复。');
  let next=JSON.parse(r.draft);
  if(restoreSchedule){const {title,titleEn,start,end,timeSlots,rooms}=published;next={...next,title,titleEn,start,end,timeSlots,rooms,sessions:published.sessions.map(({changed,...s})=>s)};}
  // Published seating brings back its own room sizes; rooms added since stay.
  if(restoreSeats)next={...next,rooms:[...next.rooms.map(room=>seating.rooms.find(x=>x.name===room.name)||room),...seating.rooms.filter(x=>!next.rooms.some(room=>room.name===x.name))],seats:seating.seats.map(({matchEmail,...seat})=>seat)};
  const parsed=batchSchema.safeParse(next);if(!parsed.success)return fail(res,parsed.error.issues.map(i=>i.message).join('；'));
  const errors=seatErrors(parsed.data);if(errors.length)return fail(res,(restoreSchedule&&!restoreSeats?'草稿中的座位与已发布的考试安排不一致，请同时恢复座位表或先调整座位：':'')+errors.join('；'));
  const b={...parsed.data,id:r.id,version:r.version+1,updatedAt:new Date().toISOString()};subjects.register(b.sessions);db.transactionSync(()=>{const value=students.organize(b);db.prepare('UPDATE exam_batches SET version=?,draft=? WHERE id=?').run(b.version,JSON.stringify(value),r.id);});res.json(info(row(r.id)));
 });
 app.get('/api/admin/exams/:id/template',requireAdmin,async(req,res)=>{const r=row(req.params.id);if(!r)return res.sendStatus(404);res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="exam-seats-template.xlsx"'}).send(Buffer.from(await seatTemplate(JSON.parse(r.draft))));});
 // Imported seats keep the mode of the draft seats they sit with (按座位排序 or 不排序); a mismatch blocks the import.
 const draftConflicts=(draft,seats)=>modeConflicts(draft.sessions,draft.seats,seats);
 const seatFailure=error=>{const message=error.message||'';if(error.name==='TimeoutError')return `模型超过 ${SEAT_TIMEOUT/1000} 秒没有返回新内容，提取已停止。请把工作簿拆成较少的工作表后重试。`;return /^(请|仅|Excel|最多|表格|工作簿|LLM Worker|模型)/.test(message)?message:`与 LLM Worker 的连接中断（${error.name||'Error'}），请稍后重试；如反复出现，请拆分工作簿。`;};
 // Extracted seats are matched to students against the draft as it is when the extraction finishes.
 const organizeSeats=(batchId,result)=>{const r=row(batchId);if(!r)return result;const draft=JSON.parse(r.draft);return {...result,seats:students.organize({...draft,seats:result.seats},false).seats,errors:[...draftConflicts(draft,result.seats),...result.errors]};};
 // Exam extraction jobs belong to their batch and read its draft as it is when they start (or are retried).
 const draftOf=id=>{const r=row(id);if(!r)throw Object.assign(new Error('考试批次不存在。'),{status:404});return {...JSON.parse(r.draft),id:r.id};};
 const batchScope={scope:req=>row(String(req.query.batch||''))?String(req.query.batch):null,missing:'考试批次不存在。'};
 jobs.register('seats',{...batchScope,itemKey:'seats',failure:seatFailure,options:fields=>({mode:seatMode(fields.mode)}),
  async prepare(materials,batchId,options){const prepared=await prepareSeats(materials,draftOf(batchId),seatMode(options?.mode));return {...prepared,context:{...prepared.context,batchId}};},
  finish:(context,raw)=>organizeSeats(context.batchId,finishSeats(context,raw)),
  salvage:(context,items)=>{const partial=salvageSeats(context,items);return partial&&organizeSeats(context.batchId,partial);}});
 jobs.register('sessions',{...batchScope,itemKey:'sessions',failure:extractionFailure,
  prepare:async(materials,batchId)=>prepareSessions(materials,draftOf(batchId),subjects.list(),schoolRules.get()),
  finish:finishSessions,salvage:salvageSessions});
 registerExamChecks(checks,{draftOf,save:saveDraft,organize:students.organize,subjects,schoolRules,
  batches:()=>db.prepare('SELECT * FROM exam_batches').all().map(r=>({row:r,info:info(r),draft:JSON.parse(r.draft),published:publicBatch(r)})),
  dayOff:date=>db.prepare("SELECT 1 FROM day_plans WHERE date=? AND kind='off'").get(date)!==undefined});
 app.post('/api/admin/exams/:id/student-preview',requireAdmin,(req,res)=>{
  const r=row(req.params.id);if(conflict(req,res,r))return;
  const draft=JSON.parse(r.draft),{rooms,changes}=adaptRooms(draft,Array.isArray(req.body.seats)?req.body.seats.filter(s=>Number.isInteger(s?.row)&&Number.isInteger(s?.column)):[]);
  const parsed=batchSchema.safeParse({...draft,rooms,seats:req.body.seats});if(!parsed.success)return fail(res,parsed.error.issues.map(i=>i.message).join('；'));
  res.json({seats:students.organize(parsed.data,false).seats,roomChanges:changes,errors:[...draftConflicts(draft,parsed.data.seats),...seatErrors(parsed.data)],warnings:[]});
 });
 app.post('/api/admin/exams/:id/import-preview',requireAdmin,express.raw({type:'application/octet-stream',limit:'10mb'}),async(req,res)=>{
  const r=row(req.params.id);if(!r)return res.sendStatus(404);if(!Buffer.isBuffer(req.body))return fail(res,'请上传 Excel 文件。');
  try{const draft=JSON.parse(r.draft),result=await parseSeats(req.body,draft);res.json({...result,seats:students.organize({...draft,seats:result.seats},false).seats,errors:[...draftConflicts(draft,result.seats),...result.errors]});}catch(error){return fail(res,error.message||'无法读取 Excel 文件。');}
 });
 // 考试批次事件: every published batch also appears on the school calendar as one exam event.
 const events=()=>db.prepare('SELECT published FROM exam_batches WHERE published IS NOT NULL').all().map(r=>batchEvent(JSON.parse(r.published)));
 return {matching,events,students};
}
