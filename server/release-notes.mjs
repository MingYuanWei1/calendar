import {randomBytes,randomUUID} from 'node:crypto';
import {digest} from './passwords.mjs';
import {releaseNoteSchema} from './validation.mjs';

// 更新说明: what changed on the site, popped up once on the calendar and exams pages until the reader confirms.
// A reader is a signed-in account, or a visitor holding the cookie set when they first confirm while signed out;
// either one having read a note is enough. Reads go with the note when it is deleted or its showing period ends.
const MAX_NOTES=200,SHOWN=3,DAY=86400000,COOKIE='release_reader',COOKIE_AGE=400*DAY;
const parts=release=>release.split('.').map(Number);
/** Newest release first: 0.10.0 comes before 0.9.3. */
export const byRelease=(a,b)=>{const [x,y]=[parts(a.release),parts(b.release)];return y[0]-x[0]||y[1]-x[1]||y[2]-x[2];};

export function installReleaseNotes(app,db,{session,requireSystemAdmin,secure,timeZone,now=()=>Date.now()}){
 const schoolDate=at=>at==null?null:new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
 const dated=note=>note&&{...note,date:schoolDate(note.publishedAt)};
 db.exec(`CREATE TABLE IF NOT EXISTS release_notes(id TEXT PRIMARY KEY,version INTEGER NOT NULL,release TEXT NOT NULL UNIQUE,zh TEXT NOT NULL,en TEXT NOT NULL,days INTEGER NOT NULL,status TEXT NOT NULL,published_at INTEGER,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS release_note_reads(note_id TEXT NOT NULL,reader TEXT NOT NULL,PRIMARY KEY(note_id,reader));`);
 const fields='id,version,release,zh,en,days,status,published_at AS publishedAt,updated_at AS updatedAt';
 const get=id=>db.prepare(`SELECT ${fields} FROM release_notes WHERE id=?`).get(id);
 const visitorToken=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
 const readers=req=>{
  const user=session(req),token=visitorToken(req);
  return [...(user?['user:'+user.id]:[]),...(token?['visitor:'+digest(token)]:[])];
 };
 const markRead=(id,reader)=>db.prepare('INSERT OR IGNORE INTO release_note_reads VALUES(?,?)').run(id,reader);
 const forgetExpired=()=>db.prepare("DELETE FROM release_note_reads WHERE note_id IN (SELECT id FROM release_notes WHERE status='published' AND published_at+days*?<=?)").run(DAY,now());

 app.get('/api/release-notes',(req,res)=>{
  forgetExpired();
  const who=readers(req);
  const unread=db.prepare(`SELECT id,release,zh,en,published_at AS publishedAt FROM release_notes n WHERE status='published' AND published_at+days*?>?
   AND NOT EXISTS (SELECT 1 FROM release_note_reads r WHERE r.note_id=n.id AND r.reader IN (SELECT value FROM json_each(?)))`).all(DAY,now(),JSON.stringify(who));
  res.json(unread.sort(byRelease).slice(0,SHOWN).map(dated));
 });
 // 我知道了: marks the notes read for this account and this visitor cookie, giving a signed-out reader one first.
 app.post('/api/release-notes/read',(req,res)=>{
  const ids=req.body?.ids;
  if(!Array.isArray(ids)||!ids.length||ids.length>SHOWN||!ids.every(id=>typeof id==='string'))return res.status(422).json({error:'请求格式不正确。'});
  const who=readers(req);
  if(!who.length){
   const token=randomBytes(32).toString('base64url');
   res.cookie(COOKIE,token,{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:COOKIE_AGE});
   who.push('visitor:'+digest(token));
  }
  db.transactionSync(()=>{
   for(const id of ids)if(db.prepare("SELECT 1 FROM release_notes WHERE id=? AND status='published'").get(id))for(const reader of who)markRead(id,reader);
  });
  res.status(204).end();
 });

 const list=()=>db.prepare(`SELECT ${fields} FROM release_notes`).all().sort(byRelease).map(dated);
 app.get('/api/admin/release-notes',requireSystemAdmin,(req,res)=>{forgetExpired();res.json(list());});
 // The note to save, or null once a 422 has been sent.
 const accept=(res,body,id)=>{
  const parsed=releaseNoteSchema.safeParse(body);
  if(!parsed.success){res.status(422).json({error:'请填写 x.y.z 格式的版本号和中文说明（不超过 4000 字），展示期为 1–365 天。',fields:parsed.error.issues.map(i=>({field:i.path[0],message:i.message}))});return null;}
  if(db.prepare('SELECT 1 FROM release_notes WHERE release=? AND id<>?').get(parsed.data.release,id||'')){res.status(422).json({error:`版本 ${parsed.data.release} 已存在，请换一个版本号。`,fields:[{field:'release',message:'Duplicate release'}]});return null;}
  return parsed.data;
 };
 /** Publishing from a draft starts the showing period; 重新提醒 forgets every read. The publisher has read it either way. */
 function settle(req,id,note,before){
  if(note.status!=='published')return;
  if(note.renotify)db.prepare('DELETE FROM release_note_reads WHERE note_id=?').run(id);
  if(before?.status!=='published'||note.renotify)markRead(id,'user:'+session(req).id);
 }
 app.post('/api/admin/release-notes',requireSystemAdmin,(req,res)=>{
  const note=accept(res,req.body);if(!note)return;
  if(db.prepare('SELECT COUNT(*) AS n FROM release_notes').get().n>=MAX_NOTES)return res.status(422).json({error:`最多保存 ${MAX_NOTES} 条更新说明，请先删除旧的。`});
  const id=randomUUID(),at=now();
  db.transactionSync(()=>{
   db.prepare('INSERT INTO release_notes VALUES(?,1,?,?,?,?,?,?,?)').run(id,note.release,note.zh,note.en,note.days,note.status,note.status==='published'?at:null,at);
   settle(req,id,note,null);
  });
  res.status(201).json(dated(get(id)));
 });
 app.put('/api/admin/release-notes/:id',requireSystemAdmin,(req,res)=>{
  const before=get(req.params.id);if(!before)return res.status(404).json({error:'该更新说明已被删除。'});
  const note=accept(res,req.body,before.id);if(!note)return;
  if(note.version!==before.version)return res.status(409).json({error:'该更新说明已在其他窗口修改，请刷新后再编辑。',code:'CONFLICT'});
  const publishedAt=note.status!=='published'?before.publishedAt:before.status==='published'?before.publishedAt:now();
  db.transactionSync(()=>{
   db.prepare('UPDATE release_notes SET version=?,release=?,zh=?,en=?,days=?,status=?,published_at=?,updated_at=? WHERE id=?').run(before.version+1,note.release,note.zh,note.en,note.days,note.status,publishedAt??null,now(),before.id);
   settle(req,before.id,note,before);
  });
  res.json(dated(get(before.id)));
 });
 app.delete('/api/admin/release-notes/:id',requireSystemAdmin,(req,res)=>{
  db.transactionSync(()=>{
   db.prepare('DELETE FROM release_note_reads WHERE note_id=?').run(req.params.id);
   db.prepare('DELETE FROM release_notes WHERE id=?').run(req.params.id);
  });
  res.status(204).end();
 });
}
