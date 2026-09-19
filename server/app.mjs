import express from 'express';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {openStore,digest,verifyPassword} from './store.mjs';
import {eventSchema} from './validation.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));

export function createApplication({dataDir,origin,schoolName='学校校历',schoolNameEn='School calendar',timeZone='Asia/Shanghai'}){
  new Intl.DateTimeFormat('en',{timeZone}).format();
  const base=new URL(origin);if(!['http:','https:'].includes(base.protocol)||base.origin!==origin)throw new Error('APP_ORIGIN must contain only scheme and host/port');
  const db=openStore(dataDir),app=express();
  const mediaDirectory=join(resolve(dataDir),'media');mkdirSync(mediaDirectory,{recursive:true,mode:0o700});
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
    if(base.protocol==='https:')res.set('Strict-Transport-Security','max-age=31536000');
    if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('Origin')!==origin)return res.status(403).json({error:'请求来源不匹配，请从网站正常操作。',code:'ORIGIN'});
    next();
  });
  const tokenFrom=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('calendar_session='))?.slice(17)||'';
  const session=req=>db.prepare('SELECT username FROM sessions WHERE token=? AND expires>?').get(digest(tokenFrom(req)),Date.now());
  const requireAdmin=(req,res,next)=>{if(!session(req))return res.status(401).json({error:'登录已失效，请重新登录。',code:'AUTH'});next();};
  const clearCookie=res=>res.clearCookie('calendar_session',{path:'/',httpOnly:true,sameSite:'strict',secure:base.protocol==='https:'});
  app.use('/api',express.json({limit:'128kb'}));
  app.get('/api/config',(req,res)=>res.json({schoolName,schoolNameEn,timeZone}));
  app.get('/api/session',(req,res)=>res.json({authenticated:Boolean(session(req))}));
  app.post('/api/login',async(req,res)=>{
    const {username,password}=req.body||{};
    if(typeof username!=='string'||typeof password!=='string'||username.length>64||password.length>256)return res.status(400).json({error:'请输入账号和密码。'});
    const address=req.socket.remoteAddress||'unknown',now=Date.now();
    db.prepare('DELETE FROM login_attempts WHERE reset<?').run(now);
    db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
    const attempt=db.prepare('SELECT * FROM login_attempts WHERE address=?').get(address);
    if(attempt?.count>=10){res.set('Retry-After',String(Math.ceil((attempt.reset-now)/1000)));return res.status(429).json({error:'尝试次数过多，请 15 分钟后重试。'});}
    db.prepare('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(address) DO UPDATE SET count=count+1').run(address,now+15*60*1000);
    if(!await verifyPassword(db,username,password))return res.status(401).json({error:'账号或密码错误。'});
    db.prepare('DELETE FROM login_attempts WHERE address=?').run(address);
    db.prepare('DELETE FROM sessions WHERE token=?').run(digest(tokenFrom(req)));
    const token=randomBytes(32).toString('hex'),duration=8*60*60*1000;
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),username,now+duration);
    res.cookie('calendar_session',token,{httpOnly:true,sameSite:'strict',secure:base.protocol==='https:',path:'/',maxAge:duration});
    res.json({authenticated:true});
  });
  app.post('/api/logout',(req,res)=>{db.prepare('DELETE FROM sessions WHERE token=?').run(digest(tokenFrom(req)));clearCookie(res);res.status(204).end();});
  const rowsToEvents=rows=>rows.map(row=>JSON.parse(row.body));
  app.get('/api/events',(req,res)=>res.json(rowsToEvents(db.prepare("SELECT body FROM events WHERE status IN ('published','cancelled') ORDER BY json_extract(body,'$.start'),id").all())));
  app.get('/api/admin/events',requireAdmin,(req,res)=>res.json(rowsToEvents(db.prepare('SELECT body FROM events ORDER BY json_extract(body,\'$.start\'),id').all())));
  const getEvent=id=>{const row=db.prepare('SELECT body FROM events WHERE id=?').get(id);return row?JSON.parse(row.body):null;};
  const conflict=(res)=>res.status(409).json({error:'事件已在其他窗口更新。请保留输入，返回列表刷新后再编辑。',code:'CONFLICT'});
  function persist(req,res,existing){
    const parsed=eventSchema.safeParse(req.body);
    if(!parsed.success)return res.status(422).json({error:'请检查事件内容。',fields:parsed.error.issues.map(i=>({field:i.path[0],message:i.message}))});
    const value=parsed.data;
    if(existing&&value.version!==existing.version)return conflict(res);
    if((!existing&&value.status==='cancelled')||(existing&&value.status==='cancelled'&&existing.status!=='cancelled'))return res.status(422).json({error:'请使用取消事件操作。'});
    for(const path of [value.poster,value.qr])if(path&&!db.prepare('SELECT id FROM media WHERE id=?').get(path.split('/').at(-1)))return res.status(422).json({error:'图片不存在，请重新上传。'});
    const updated={...value,id:existing?.id||randomUUID(),status:existing?.cancelled?'cancelled':value.status,cancelled:existing?.cancelled||false,cancelReason:existing?.cancelReason,previousSchedule:existing?.previousSchedule,oldDate:existing?.oldDate,version:(existing?.version||0)+1,updatedAt:new Date().toISOString()};
    if(existing&&existing.status!=='draft'&&['start','end','time','endTime'].some(key=>existing[key]!==updated[key])){
      updated.previousSchedule={start:existing.start,end:existing.end,time:existing.time,endTime:existing.endTime,type:existing.type};updated.oldDate=existing.start;
    }
    if(existing)db.prepare('UPDATE events SET status=?,version=?,body=? WHERE id=?').run(updated.status,updated.version,JSON.stringify(updated),updated.id);
    else db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(updated.id,updated.status,updated.version,JSON.stringify(updated));
    res.status(existing?200:201).json(updated);
  }
  app.post('/api/admin/events',requireAdmin,(req,res)=>persist(req,res,null));
  app.put('/api/admin/events/:id',requireAdmin,(req,res)=>{const event=getEvent(req.params.id);if(!event)return res.status(404).json({error:'事件不存在。'});persist(req,res,event);});
  app.post('/api/admin/events/:id/cancel',requireAdmin,(req,res)=>{
    const event=getEvent(req.params.id);if(!event)return res.status(404).json({error:'事件不存在。'});
    if(req.body?.version!==event.version)return conflict(res);
    if(event.status!=='published')return res.status(422).json({error:'只能取消已发布的事件。'});
    if(typeof req.body.reason!=='string'||req.body.reason.length>2000)return res.status(422).json({error:'取消原因不能超过 2000 字。'});
    Object.assign(event,{status:'cancelled',cancelled:true,cancelReason:req.body.reason.trim(),version:event.version+1,updatedAt:new Date().toISOString()});
    db.prepare('UPDATE events SET status=?,version=?,body=? WHERE id=?').run(event.status,event.version,JSON.stringify(event),event.id);res.json(event);
  });
  app.delete('/api/admin/events/:id',requireAdmin,(req,res)=>{
    const event=getEvent(req.params.id);if(!event)return res.status(404).json({error:'事件不存在。'});
    if(req.body?.version!==event.version)return conflict(res);
    db.prepare('DELETE FROM events WHERE id=?').run(event.id);res.status(204).end();
  });
  app.post('/api/admin/media',requireAdmin,express.raw({type:['image/png','image/jpeg','image/webp'],limit:'5mb'}),async(req,res)=>{
    if(!Buffer.isBuffer(req.body))return res.status(415).json({error:'请上传 PNG、JPEG 或 WebP 图片。'});
    const id=randomUUID();
    try{await sharp(req.body,{limitInputPixels:40000000}).rotate().webp({quality:88}).toFile(join(mediaDirectory,id+'.webp'));}
    catch{return res.status(422).json({error:'图片无法读取或尺寸过大，请换一张图片。'});}
    db.prepare('INSERT INTO media VALUES(?,?)').run(id,Date.now());res.status(201).json({url:'/api/media/'+id});
  });
  app.get('/api/media/:id',(req,res)=>{
    if(!/^[a-f0-9-]{36}$/.test(req.params.id)||!db.prepare('SELECT id FROM media WHERE id=?').get(req.params.id))return res.sendStatus(404);
    const path='/api/media/'+req.params.id;
    const published=db.prepare("SELECT id FROM events WHERE status IN ('published','cancelled') AND (json_extract(body,'$.poster')=? OR json_extract(body,'$.qr')=?) LIMIT 1").get(path,path);
    if(!published&&!session(req))return res.sendStatus(404);
    res.type('image/webp').sendFile(join(mediaDirectory,req.params.id+'.webp'),{dotfiles:'allow'});
  });
  app.use('/api',(req,res)=>res.status(404).json({error:'接口不存在。'}));
  app.use(express.static(join(root,'public'),{etag:true,maxAge:0}));
  app.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    if(error.type==='entity.too.large')return res.status(413).json({error:'内容过大。图片最大 5 MB。'});
    if(error.status===404)return res.status(404).json({error:'文件不存在。'});
    if(error instanceof SyntaxError)return res.status(400).json({error:'请求格式不正确。'});
    console.error('Request failed:',error.message);res.status(500).json({error:'服务暂时不可用，请稍后重试。'});
  });
  return {app,db,close:()=>db.close()};
}
