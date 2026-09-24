import {randomUUID} from 'node:crypto';
export function installExamMatching(app,db,{user,students}){
 db.exec('CREATE TABLE IF NOT EXISTS exam_personal_state(user_id TEXT NOT NULL,batch_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(user_id,batch_id))');
 const choices=(uid,bid)=>db.prepare('SELECT exam_id FROM exam_choices WHERE user_id=? AND batch_id=? ORDER BY exam_id').all(uid,bid).map(r=>r.exam_id);
 const read=(uid,bid)=>{const r=db.prepare('SELECT body FROM exam_personal_state WHERE user_id=? AND batch_id=?').get(uid,bid);return r?JSON.parse(r.body):{initialized:false,seen:[]};};
 const save=(uid,bid,state)=>db.prepare('INSERT INTO exam_personal_state VALUES(?,?,?) ON CONFLICT(user_id,batch_id) DO UPDATE SET body=excluded.body').run(uid,bid,JSON.stringify(state));
 function context(u,bid){
  const row=db.prepare('SELECT published,seating FROM exam_batches WHERE id=?').get(bid);if(!row?.published)return null;
  const batch=JSON.parse(row.published),seating=row.seating?JSON.parse(row.seating):null;
  const email=students.normalizeEmail(u.email),valid=students.validEmail(email);
  const matches=valid?(seating?.seats||[]).filter(s=>s.matchEmail===email):[];
  const identities=new Set(matches.map(s=>s.studentId)),personal=Object.create(null);
  if(identities.size===1)for(const seat of matches){if(matches.filter(s=>s.examId===seat.examId).length===1&&batch.sessions.some(s=>s.id===seat.examId))personal[seat.examId]={studentId:seat.studentId,room:seat.room,row:seat.row,column:seat.column};}
  return {batch,seating,personal,valid};
 }
 function synchronize(u,bid){
  const ctx=context(u,bid);if(!ctx)return null;
  const state=read(u.id,bid),related=Object.keys(ctx.personal);
  if(ctx.valid&&!state.initialized&&related.length){
   for(const id of related)db.prepare('INSERT OR IGNORE INTO exam_choices VALUES(?,?,?)').run(u.id,bid,id);
   state.initialized=true;state.seen=[...new Set([...state.seen,...related,...choices(u.id,bid)])];save(u.id,bid,state);
  }
  const selected=choices(u.id,bid);
  state.observed=Object.assign(Object.create(null),state.observed);state.pending=Object.assign(Object.create(null),state.pending);state.known=Object.assign(Object.create(null),state.known);
  for(const id of Object.keys(state.observed))if(!selected.includes(id)){delete state.observed[id];delete state.pending[id];delete state.known[id];}
  if(ctx.valid)for(const id of selected){
   const next=ctx.seating?(ctx.personal[id]||null):{unavailable:true};
   if(Object.hasOwn(state.observed,id)&&JSON.stringify(state.observed[id])!==JSON.stringify(next)){
    const previous=state.observed[id],before=previous?.unavailable?(state.known[id]||null):previous;
    const kind=next?.unavailable?'unavailable':next?(before?(previous?.unavailable&&JSON.stringify(before)===JSON.stringify(next)?'restored':'changed'):'added'):'removed';
    if(kind==='removed'&&!before)delete state.pending[id];else state.pending[id]={id:randomUUID(),examId:id,kind,before,after:next?.unavailable?null:next};
   }
   state.observed[id]=next;if(next&&!next.unavailable)state.known[id]=next;
  }
  if(ctx.valid)save(u.id,bid,state);
  return {status:ctx.valid?'active':'skipped',initialized:state.initialized,choices:selected,personal:ctx.personal,related,newExams:state.initialized?related.filter(id=>!state.seen.includes(id)&&!selected.includes(id)):[],changes:ctx.valid?Object.values(state.pending):[]};
 }
 app.post('/api/exams/:id/personal-sync',(req,res)=>{
  const u=user(req);if(!u)return res.status(401).json({error:'请先登录。'});
  const result=db.transactionSync(()=>synchronize(u,req.params.id));if(!result)return res.status(404).json({error:'考试批次不存在。'});res.json(result);
 });
 app.post('/api/exams/:id/personal-import',(req,res)=>{
  const u=user(req);if(!u)return res.status(401).json({error:'请先登录。'});
  const {offered,ids}=req.body||{};
  if(!Array.isArray(offered)||!Array.isArray(ids)||offered.length>500||ids.length>500||[...offered,...ids].some(id=>typeof id!=='string')||ids.some(id=>!offered.includes(id)))return res.status(422).json({error:'导入选择无效。'});
  db.transactionSync(()=>{
   const ctx=context(u,req.params.id);if(!ctx||!ctx.valid||ids.some(id=>!ctx.personal[id]))return res.status(409).json({error:'关联考试已变化，请刷新后再导入。'});
   const state=read(u.id,req.params.id);state.seen=[...new Set([...state.seen,...offered])];
   for(const id of new Set(ids))db.prepare('INSERT OR IGNORE INTO exam_choices VALUES(?,?,?)').run(u.id,req.params.id,id);
   save(u.id,req.params.id,state);res.json(synchronize(u,req.params.id));
  });
 });
 app.post('/api/exams/:id/personal-ack',(req,res)=>{
  const u=user(req);if(!u)return res.status(401).json({error:'请先登录。'});
  const ids=req.body?.ids;if(!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string'))return res.status(422).json({error:'确认信息无效。'});
  db.transactionSync(()=>{
   if(!synchronize(u,req.params.id))return res.status(404).json({error:'考试批次不存在。'});
   const state=read(u.id,req.params.id);for(const [examId,change] of Object.entries(state.pending||{}))if(ids.includes(change.id))delete state.pending[examId];
   save(u.id,req.params.id,state);res.json(synchronize(u,req.params.id));
  });
 });
 function selected(u,bid,ids){
  const state=read(u.id,bid),ctx=context(u,bid),previous=choices(u.id,bid);
  state.seen=[...new Set([...state.seen,...previous,...ids])];if(!ids.length)state.initialized=true;
  state.observed=Object.assign(Object.create(null),state.observed);state.pending=Object.assign(Object.create(null),state.pending);state.known=Object.assign(Object.create(null),state.known);
  for(const id of previous)if(!ids.includes(id)){delete state.observed[id];delete state.pending[id];delete state.known[id];}
  if(ctx?.valid)for(const id of ids)if(!previous.includes(id)){state.observed[id]=ctx.seating?(ctx.personal[id]||null):{unavailable:true};if(ctx.personal[id])state.known[id]=ctx.personal[id];}
  save(u.id,bid,state);
 }
 return {selected,personal:(u,bid)=>u?context(u,bid)?.personal||{}:{}};
}
