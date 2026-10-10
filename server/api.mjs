import {pageRole} from './page-access.mjs';
import {initializeAccounts,installAccounts} from './accounts.mjs';
import {installSchoolAuth} from './school-auth.mjs';
import express from 'express';
import {schedulePdfSchema,vectorSchedulePdf} from './schedule-pdf.mjs';
import {randomBytes,randomUUID} from 'node:crypto';
import {installExams} from './exams.mjs';
import {digest,verifyPassword} from './passwords.mjs';
import {eventSchema,dayPlanSchema} from './validation.mjs';
import {OVERRIDABLE,addDays,fitsSeries,isSeriesDate,seriesDates} from '../public/recurrence.mjs';
import {installQuota} from './llm-quota.mjs';
import {installFeeds} from './feeds.mjs';
import {installNoticeExtract} from './notice-extract.mjs';
import {installAssistant} from './assistant.mjs';
export function createApi({db,media,installStatic=()=>{},origin,timeZone='Asia/Shanghai',trustProxy='',sso={},llm={}}){
  new Intl.DateTimeFormat('en',{timeZone}).format();
  const base=new URL(origin);if(!['http:','https:'].includes(base.protocol)||base.origin!==origin)throw new Error('APP_ORIGIN must contain only scheme and host/port');
  // Retire the test-only holiday event category; day_plans remains authoritative.
  db.prepare("DELETE FROM events WHERE json_extract(body,'$.type')='holiday'").run();
  // A school day may follow another weekday's timetable (1 = Monday … 5 = Friday).
  if(!db.prepare('PRAGMA table_info(day_plans)').all().some(column=>column.name==='follows'))db.exec('ALTER TABLE day_plans ADD COLUMN follows INTEGER');
  const app=express();
  app.disable('x-powered-by');
  if(trustProxy)app.set('trust proxy',trustProxy.split(',').map(value=>value.trim()));
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
    if(base.protocol==='https:')res.set('Strict-Transport-Security','max-age=31536000');
    if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('Origin')!==origin)return res.status(403).json({error:'请求来源不匹配，请从网站正常操作。',code:'ORIGIN'});
    next();
  });
  const tokenFrom=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('calendar_session='))?.slice(17)||'';
  initializeAccounts(db);
  const localUser=req=>db.prepare("SELECT a.id,a.name,a.role FROM sessions s JOIN accounts a ON a.provider='local' AND a.subject=s.username WHERE s.token=? AND s.expires>? AND a.disabled=0").get(digest(tokenFrom(req)),Date.now());
  const schoolAuth=installSchoolAuth(app,db,{origin,...sso,localUser});
  const session=req=>localUser(req)||schoolAuth.user(req);
  const requireRole=role=>(req,res,next)=>{const user=session(req);if(!user)return res.status(401).json({error:'登录已失效，请重新登录。',code:'AUTH'});if(user.role<role)return res.status(403).json({error:'当前账户没有操作权限。',code:'FORBIDDEN'});next();};
  const requireAdmin=requireRole(2);
  const quota=installQuota(db,{session,timeZone,dailyLimit:llm.dailyLimit});
  const clearCookie=res=>res.clearCookie('calendar_session',{path:'/',httpOnly:true,sameSite:'strict',secure:base.protocol==='https:'});
  app.use('/api/admin/exam-extract',express.json({limit:'20mb'}));
  app.use('/api/admin/notice-extract',express.json({limit:'20mb'}));
  app.use('/api/admin/exams',express.json({limit:'4mb'}));
  app.use('/api/exam-schedule-pdf',express.json({limit:'4mb'}));
  app.use('/api',express.json({limit:'128kb'}));
  app.post('/api/exam-schedule-pdf',async(req,res)=>{
    const parsed=schedulePdfSchema.safeParse(req.body);
    if(!parsed.success)return res.status(422).json({error:'考试表布局无效或内容过多，请缩小导出范围。'});
    res.set({'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="exam-schedule.pdf"'}).send(await vectorSchedulePdf(parsed.data.pages));
  });
  app.get('/api/page-access',(req,res)=>{
    const required=pageRole(new URL(origin+(typeof req.query.path==='string'&&req.query.path.startsWith('/')?req.query.path:'/')));
    const user=required?session(req):null;
    res.status(!required||user?.role>=required?204:user?403:401).end();
  });
  app.get('/api/config',(req,res)=>res.json({timeZone}));
  app.get('/api/session',(req,res)=>res.json({authenticated:Boolean(session(req)),user:session(req)||null}));
  app.post('/api/login',schoolAuth.requireSignedOut,async(req,res)=>{
    const {username,password}=req.body||{};
    if(typeof username!=='string'||typeof password!=='string'||username.length>64||password.length>256)return res.status(400).json({error:'请输入账号和密码。'});
    const address=req.calendarClientAddress||req.ip||req.socket.remoteAddress||'unknown',now=Date.now();
    db.prepare('DELETE FROM login_attempts WHERE reset<?').run(now);
    db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
    const attempt=db.prepare('SELECT * FROM login_attempts WHERE address=?').get(address);
    if(attempt?.count>=10){res.set('Retry-After',String(Math.ceil((attempt.reset-now)/1000)));return res.status(429).json({error:'尝试次数过多，请 15 分钟后重试。'});}
    db.prepare('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(address) DO UPDATE SET count=count+1').run(address,now+15*60*1000);
    if(!await verifyPassword(db,username,password))return res.status(401).json({error:'账号或密码错误。'});
    let account=db.prepare("SELECT * FROM accounts WHERE provider='local' AND subject=?").get(username);
    if(!account){initializeAccounts(db);account=db.prepare("SELECT * FROM accounts WHERE provider='local' AND subject=?").get(username);}
    if(account.disabled)return res.status(403).json({error:'此账户已停用。'});
    db.prepare('DELETE FROM login_attempts WHERE address=?').run(address);
    db.prepare('DELETE FROM sessions WHERE token=?').run(digest(tokenFrom(req)));
    const token=randomBytes(32).toString('hex'),duration=8*60*60*1000;
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),username,now+duration);
    res.cookie('calendar_session',token,{httpOnly:true,sameSite:'strict',secure:base.protocol==='https:',path:'/',maxAge:duration});
    schoolAuth.clearSession(req,res);
    res.json({authenticated:true,user:{id:account.id,name:account.name,role:account.role}});
  });
  app.post('/api/logout',(req,res)=>{db.prepare('DELETE FROM sessions WHERE token=?').run(digest(tokenFrom(req)));clearCookie(res);schoolAuth.logout(req,res);});
  const rowsToEvents=rows=>rows.map(row=>JSON.parse(row.body));
  // 考试批次事件 come from the exam batches, installed below; they are read-only here.
  let examEvents=()=>[];
  const byStart=(a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id);
  app.get('/api/events',(req,res)=>res.json([...rowsToEvents(db.prepare("SELECT body FROM events WHERE status IN ('published','cancelled')").all()),...examEvents()].sort(byStart)));
  app.get('/api/admin/events',requireAdmin,(req,res)=>res.json([...rowsToEvents(db.prepare('SELECT body FROM events').all()),...examEvents()].sort(byStart)));
  app.get('/api/day-plans',(req,res)=>res.json(db.prepare('SELECT date,kind,title,follows FROM day_plans ORDER BY date').all().map(({follows,...row})=>({...row,title:JSON.parse(row.title),...(follows?{follows}:{})}))));
  app.put('/api/admin/day-plans',requireAdmin,(req,res)=>{
    const parsed=dayPlanSchema.safeParse(req.body);
    if(!parsed.success)return res.status(422).json({error:'请选择有效日期范围（不超过 366 天），名称不超过 60 字。'});
    const {start,end,kind,title,follows}=parsed.data;
    const put=db.prepare('INSERT INTO day_plans(date,kind,title,follows) VALUES(?,?,?,?) ON CONFLICT(date) DO UPDATE SET kind=excluded.kind,title=excluded.title,follows=excluded.follows');
    const remove=db.prepare('DELETE FROM day_plans WHERE date=?');
    db.transactionSync(()=>{
      for(let day=new Date(start+'T12:00:00Z');day.toISOString().slice(0,10)<=end;day.setUTCDate(day.getUTCDate()+1)){
        const iso=day.toISOString().slice(0,10);
        if(kind==='default')remove.run(iso);else put.run(iso,kind,JSON.stringify(title),follows);
      }
      });res.status(204).end();
  });
  const getEvent=id=>{const row=db.prepare('SELECT body FROM events WHERE id=?').get(id);return row?JSON.parse(row.body):null;};
  const conflict=(res)=>res.status(409).json({error:'事件已在其他窗口更新。请保留输入，返回列表刷新后再编辑。',code:'CONFLICT'});
  const dayPlans=()=>Object.fromEntries(db.prepare('SELECT date,kind FROM day_plans').all().map(plan=>[plan.date,plan]));
  const write=event=>db.prepare('UPDATE events SET status=?,version=?,body=? WHERE id=?').run(event.status,event.version,JSON.stringify(event),event.id);
  const insert=event=>db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(event.id,event.status,event.version,JSON.stringify(event));
  const bump=event=>({...event,version:event.version+1,updatedAt:new Date().toISOString()});
  // Dates with their own changes must still be dates of the series after its rule changes.
  const unfit=(series,plans)=>Object.keys(series.exceptions||{}).filter(date=>!fitsSeries(series,plans,date)).sort();
  const unfitError=(res,dates)=>res.status(422).json({error:`这些日期有单独的修改或取消，新的重复规则不再包含它们：${dates.join('、')}。请先在“重复日期”中恢复这些日期。`,fields:[{field:'repeat',message:'Restore the changed dates first'}]});
  /** Which single date of a series a request targets; null when it targets the whole event. */
  function targetDate(req,res,event){
   const date=req.body?.occurrence?.date;
   if(date===undefined)return null;
   if(typeof date!=='string'||!isSeriesDate(event,dayPlans(),date)){res.status(422).json({error:'这一天不在该重复事件的日期中，请刷新后重试。'});return false;}
   return date;
  }
  /**
   * Ends a series the day before `date` and starts `next` as a new series from that date, which takes the
   * later dates' own changes with it. A count carries over as the number of dates still to come.
   */
  function split(res,existing,date,next){
   const plans=dayPlans(),held=seriesDates(existing,plans,addDays(date,-1)).length;
   const {count,...rule}=existing.repeat;
   const keep=([key])=>key<date,entries=Object.entries(existing.exceptions||{});
   const old=bump({...existing,repeat:{...rule,until:addDays(date,-1)},exceptions:Object.fromEntries(entries.filter(keep))});
   const repeat=next.repeat&&count&&next.repeat.count===count?{...next.repeat,count:Math.max(1,count-held)}:next.repeat;
   const created={...next,repeat,id:randomUUID(),exceptions:Object.fromEntries(entries.filter(entry=>!keep(entry))),previousSchedule:undefined,oldDate:undefined,version:1,updatedAt:new Date().toISOString()};
   const bad=unfit(created,plans);
   if(bad.length)return unfitError(res,bad);
   db.transactionSync(()=>{write(old);insert(created);});
   res.json(created);
  }
  function persist(req,res,existing){
   // A single date follows the series' rule, which need not hold on the date it moves to.
   const parsed=eventSchema.safeParse(req.body?.occurrence?.span==='one'?{...req.body,repeat:undefined}:req.body);
   if(!parsed.success)return res.status(422).json({error:'请检查事件内容。',fields:parsed.error.issues.map(i=>({field:i.path[0],message:i.message}))});
   const value=parsed.data;
   if(existing&&value.version!==existing.version)return conflict(res);
   if((!existing&&value.status==='cancelled')||(existing&&value.status==='cancelled'&&existing.status!=='cancelled'))return res.status(422).json({error:'请使用取消事件操作。'});
   for(const path of [value.poster,value.qr])if(path&&!db.prepare('SELECT id FROM media WHERE id=?').get(path.split('/').at(-1)))return res.status(422).json({error:'图片不存在，请重新上传。'});
   const date=existing&&targetDate(req,res,existing);
   if(date===false)return;
   if(date)return persistDate(req,res,existing,value,date);
   const updated={...value,id:existing?.id||randomUUID(),status:existing?.cancelled?'cancelled':value.status,cancelled:existing?.cancelled||false,cancelReason:existing?.cancelReason,previousSchedule:existing?.previousSchedule,oldDate:existing?.oldDate,exceptions:existing?.exceptions,version:(existing?.version||0)+1,updatedAt:new Date().toISOString()};
   if(updated.repeat||existing?.repeat){
    // Changing a series is not a reschedule; single dates record their own moves.
    Object.assign(updated,{previousSchedule:undefined,oldDate:undefined});
    const bad=unfit(updated,dayPlans());
    if(bad.length)return unfitError(res,bad);
   }else if(existing&&existing.status!=='draft'&&['start','end','time','endTime'].some(key=>existing[key]!==updated[key])){
    updated.previousSchedule={start:existing.start,end:existing.end,time:existing.time,endTime:existing.endTime,type:existing.type};updated.oldDate=existing.start;
   }
   if(existing)write(updated);else insert(updated);
   res.status(existing?200:201).json(updated);
  }
  /** "This event only" stores the fields that differ from the series; "this and future" splits the series. */
  function persistDate(req,res,existing,value,date){
   if(req.body.occurrence.span==='future'){
    const next={...value,repeat:value.repeat||existing.repeat,status:existing.status,cancelled:false,cancelReason:undefined};
    if(date===existing.start)return persist({body:{...req.body,...next,occurrence:undefined}},res,existing);
    return split(res,existing,date,next);
   }
   if(req.body.occurrence.span!=='one')return res.status(422).json({error:'请选择修改范围。'});
   if(value.type!==existing.type||value.timeMode!==existing.timeMode||value.scope.join()!==existing.scope.join())return res.status(422).json({error:'单次修改不能更改类型、时间形式或适用范围，请修改整个系列。'});
   const own={...existing.exceptions?.[date]};delete own.deleted;
   for(const key of OVERRIDABLE){
    const series=key==='start'?date:existing[key];
    if(JSON.stringify(value[key])!==JSON.stringify(series))own[key]=value[key];else delete own[key];
   }
   const exceptions={...existing.exceptions,[date]:own};
   if(!Object.keys(own).length)delete exceptions[date];
   const updated=bump({...existing,exceptions});
   write(updated);res.json(updated);
  }
  app.post('/api/admin/events',requireAdmin,(req,res)=>persist(req,res,null));
  app.put('/api/admin/events/:id',requireAdmin,(req,res)=>{const event=getEvent(req.params.id);if(!event)return res.status(404).json({error:'事件不存在。'});persist(req,res,event);});
  app.post('/api/admin/events/:id/cancel',requireAdmin,(req,res)=>{
   const event=getEvent(req.params.id);if(!event)return res.status(404).json({error:'事件不存在。'});
   if(req.body?.version!==event.version)return conflict(res);
   if(event.status!=='published')return res.status(422).json({error:'只能取消已发布的事件。'});
   if(typeof req.body.reason!=='string'||req.body.reason.length>2000)return res.status(422).json({error:'取消原因不能超过 2000 字。'});
   const reason=req.body.reason.trim(),date=targetDate(req,res,event);
   if(date===false)return;
   // 本次取消: the date stays visible with its own reason while the rest of the series continues.
   if(date&&req.body.occurrence.span==='one'){
    const updated=bump({...event,exceptions:{...event.exceptions,[date]:{...event.exceptions?.[date],cancelled:true,cancelReason:reason}}});
    write(updated);return res.json(updated);
   }
   if(date&&date!==event.start)return split(res,event,date,{...event,start:date,status:'cancelled',cancelled:true,cancelReason:reason});
   const updated=bump({...event,status:'cancelled',cancelled:true,cancelReason:reason});
   write(updated);res.json(updated);
  });
  // Restoring a date drops its own changes, cancellation or deletion so it follows the series again.
  app.post('/api/admin/events/:id/restore',requireAdmin,(req,res)=>{
   const event=getEvent(req.params.id);if(!event)return res.status(404).json({error:'事件不存在。'});
   if(req.body?.version!==event.version)return conflict(res);
   const date=req.body.occurrence?.date;
   if(!event.exceptions?.[date])return res.status(422).json({error:'这一天没有单独的修改。'});
   const exceptions={...event.exceptions};delete exceptions[date];
   const updated=bump({...event,exceptions});
   write(updated);res.json(updated);
  });
  app.delete('/api/admin/events/:id',requireAdmin,(req,res)=>{
   const event=getEvent(req.params.id);if(!event)return res.status(404).json({error:'事件不存在。'});
   if(req.body?.version!==event.version)return conflict(res);
   const date=targetDate(req,res,event);
   if(date===false)return;
   if(date){const updated=bump({...event,exceptions:{...event.exceptions,[date]:{deleted:true}}});write(updated);return res.json(updated);}
   db.prepare('DELETE FROM events WHERE id=?').run(event.id);res.status(204).end();
  });
  app.post('/api/admin/media',requireAdmin,express.raw({type:['image/png','image/jpeg','image/webp'],limit:'5mb'}),async(req,res)=>{
    if(!Buffer.isBuffer(req.body))return res.status(415).json({error:'请上传 PNG、JPEG 或 WebP 图片。'});
    const id=randomUUID();
    try{await media.save(id,req.body);}
    catch{return res.status(422).json({error:'图片无法读取或尺寸过大，请换一张图片。'});}
    db.prepare('INSERT INTO media VALUES(?,?)').run(id,Date.now());res.status(201).json({url:'/api/media/'+id});
  });
  app.get('/api/media/:id',async(req,res)=>{
    if(!/^[a-f0-9-]{36}$/.test(req.params.id)||!db.prepare('SELECT id FROM media WHERE id=?').get(req.params.id))return res.sendStatus(404);
    const path='/api/media/'+req.params.id;
    // A single date of a series may carry its own poster, so look through the whole stored event.
    const published=db.prepare("SELECT id FROM events WHERE status IN ('published','cancelled') AND instr(body,?)>0 LIMIT 1").get(JSON.stringify(path));
    if(!published&&!(session(req)?.role>=2))return res.sendStatus(404);
    const bytes=await media.read(req.params.id);
    if(!bytes)return res.sendStatus(404);
    res.type('image/webp').send(bytes);
  });
  installAccounts(app,db,{requireRole,currentUser:session});
  const exams=installExams(app,db,{requireAdmin,isAdmin:req=>session(req)?.role>=2,user:session,origin,timeZone,llm,quota});
  examEvents=exams.events;
  installFeeds(app,db,{user:session,account:schoolAuth.account,origin,timeZone,matching:exams.matching,examEvents});
  installNoticeExtract(app,db,{requireAdmin,llm,timeZone,quota});
  installAssistant(app,db,{session,llm,matching:exams.matching,timeZone,quota});
  app.use('/api',(req,res)=>res.status(404).json({error:'接口不存在。'}));
  app.use((req,res,next)=>{
    const required=pageRole(new URL(origin+req.originalUrl));
    if(!required)return next();
    res.set('Cache-Control','no-store');
    const user=session(req);
    if(!user||user.role<required)return res.status(user?403:401).end();
    next();
  });
  installStatic(app);
  app.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    if(error.type==='entity.too.large')return res.status(413).json({error:'内容过大。图片最大 5 MB。'});
    if(error.status===404)return res.status(404).json({error:'文件不存在。'});
    if(error instanceof SyntaxError)return res.status(400).json({error:'请求格式不正确。'});
    console.error('Request failed:',error.message);res.status(500).json({error:'服务暂时不可用，请稍后重试。'});
  });
  return {app,db,close:()=>db.close()};
}
