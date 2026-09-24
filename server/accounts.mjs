import {passwordCredentials} from './passwords.mjs';

export function initializeAccounts(db){
 db.exec(`CREATE TABLE IF NOT EXISTS accounts(
  id TEXT PRIMARY KEY,provider TEXT NOT NULL,subject TEXT NOT NULL,name TEXT NOT NULL,
  role INTEGER NOT NULL DEFAULT 1 CHECK(role IN (1,2,3)),disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,UNIQUE(provider,subject));
  INSERT OR IGNORE INTO accounts(id,provider,subject,name,role,created_at)
  SELECT 'local:'||username,'local',username,username,3,strftime('%Y-%m-%dT%H:%M:%SZ','now') FROM admins;`);
}
export function schoolAccount(db,id,name){
 db.prepare("INSERT INTO accounts(id,provider,subject,name,role,created_at) VALUES(?,'microsoft',?,?,1,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name").run(id,id,name,new Date().toISOString());
 return db.prepare('SELECT id,name,role,disabled FROM accounts WHERE id=?').get(id);
}
export function installAccounts(app,db,{requireRole,currentUser}){
 const fields='id,provider,subject,name,role,disabled,created_at';
 app.get('/api/admin/accounts',requireRole(3),(req,res)=>res.json(db.prepare(`SELECT ${fields} FROM accounts ORDER BY created_at,id`).all()));
 app.post('/api/admin/accounts',requireRole(3),async(req,res)=>{
  const {username,password,name,role=1}=req.body||{};
  if(typeof username!=='string'||!/^[a-zA-Z0-9_.-]{3,64}$/.test(username)||typeof password!=='string'||password.length<12||password.length>256||typeof name!=='string'||!name.trim()||name.length>160||![1,2,3].includes(role))return res.status(422).json({error:'请填写有效姓名、账号（3–64 位字母、数字、_.-）、密码（12–256 位）和角色。'});
  if(db.prepare('SELECT username FROM admins WHERE username=?').get(username))return res.status(409).json({error:'账号已存在。'});
  // Hash before entering the synchronous transaction, then recheck permissions and uniqueness.
  const credentials=await passwordCredentials(username,password);
  if(currentUser(req)?.role!==3)return res.status(403).json({error:'无账户管理权限。'});
  db.transactionSync(()=>{
   if(db.prepare('SELECT username FROM admins WHERE username=?').get(username)){res.status(409).json({error:'账号已存在。'});return;}
   db.prepare('INSERT INTO admins VALUES(?,?,?)').run(...credentials);
   db.prepare("INSERT INTO accounts(id,provider,subject,name,role,created_at) VALUES(?,'local',?,?,?,?)").run('local:'+username,username,name.trim(),role,new Date().toISOString());
   res.status(201).json(db.prepare(`SELECT ${fields} FROM accounts WHERE id=?`).get('local:'+username));
  });
 });
 app.delete('/api/admin/accounts/:id',requireRole(3),(req,res)=>{
  db.transactionSync(()=>{
   const account=db.prepare('SELECT * FROM accounts WHERE id=?').get(req.params.id);
   if(!account)return res.status(404).json({error:'账户不存在。'});
   if(account.id===currentUser(req).id)return res.status(409).json({error:'不能删除当前登录账户。'});
   if(account.role===3&&!account.disabled&&db.prepare('SELECT count(*) AS count FROM accounts WHERE role=3 AND disabled=0').get().count<=1)return res.status(409).json({error:'至少保留一个可用管理员账户。'});
   if(account.provider==='local'){
    db.prepare('DELETE FROM sessions WHERE username=?').run(account.subject);
    db.prepare('DELETE FROM admins WHERE username=?').run(account.subject);
   }
   db.prepare('DELETE FROM school_sessions WHERE user_id=?').run(account.id);
   db.prepare('DELETE FROM exam_choices WHERE user_id=?').run(account.id);
   db.prepare('DELETE FROM accounts WHERE id=?').run(account.id);
   res.status(204).end();
  });
 });
 app.patch('/api/admin/accounts/:id',requireRole(3),(req,res)=>{
  const {role,disabled}=req.body||{};
  if(![1,2,3].includes(role)||typeof disabled!=='boolean')return res.status(422).json({error:'角色或账户状态无效。'});
  db.transactionSync(()=>{
   const account=db.prepare('SELECT * FROM accounts WHERE id=?').get(req.params.id);
   if(!account)return res.status(404).json({error:'账户不存在。'});
   if(account.id===currentUser(req).id&&(role!==3||disabled))return res.status(409).json({error:'不能降低自己的管理员权限或停用当前账户。'});
   if(account.role===3&&!account.disabled&&(role!==3||disabled)&&db.prepare('SELECT count(*) AS count FROM accounts WHERE role=3 AND disabled=0').get().count<=1)return res.status(409).json({error:'至少保留一个可用管理员账户。'});
   db.prepare('UPDATE accounts SET role=?,disabled=? WHERE id=?').run(role,Number(disabled),account.id);
   if(disabled){
    if(account.provider==='local')db.prepare('DELETE FROM sessions WHERE username=?').run(account.subject);
    else db.prepare('DELETE FROM school_sessions WHERE user_id=?').run(account.id);
   }
   res.json(db.prepare(`SELECT ${fields} FROM accounts WHERE id=?`).get(account.id));
  });
 });
}
