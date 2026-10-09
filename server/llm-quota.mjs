// AI 调用限额: every AI request is counted before the model is called, per person for its kind of call,
// per client address across all calls, and against a daily total. Counts live in the application database,
// so they hold across restarts and on the single Durable Object that serves a school on Cloudflare.
const LIMITS={assistant:{count:10,windowMs:60000},extract:{count:6,windowMs:600000}},PER_ADDRESS={count:60,windowMs:600000};
const messages={
 assistant:{rate:'提问太频繁，请一分钟后再试。',quota:'今日 AI 额度已用完，请明天再试。'},
 extract:{rate:'AI 提取太频繁，请稍后再试。',quota:'今日 AI 额度已用完，请明天再试或手工录入。'}
};

export function installQuota(db,{session,timeZone,dailyLimit=1500}){
 db.exec(`CREATE TABLE IF NOT EXISTS llm_calls(key TEXT NOT NULL,at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS llm_calls_key ON llm_calls(key,at);
 CREATE TABLE IF NOT EXISTS llm_daily(day TEXT PRIMARY KEY,count INTEGER NOT NULL);`);
 const used=(key,since)=>db.prepare('SELECT COUNT(*) AS n FROM llm_calls WHERE key=? AND at>?').get(key,since).n;
 /** Resolves to null when the call may go ahead (and counts it), otherwise to a user-facing refusal. */
 function take(req,kind){
  const now=Date.now(),day=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now),{count,windowMs}=LIMITS[kind];
  const address=req.calendarClientAddress||req.ip||'unknown',user=session(req),person=`${kind}:${user?'user:'+user.id:'address:'+address}`;
  return db.transactionSync(()=>{
   db.prepare('DELETE FROM llm_calls WHERE at<?').run(now-Math.max(PER_ADDRESS.windowMs,...Object.values(LIMITS).map(l=>l.windowMs)));
   db.prepare('DELETE FROM llm_daily WHERE day<>?').run(day);
   if((db.prepare('SELECT count FROM llm_daily WHERE day=?').get(day)?.count||0)>=dailyLimit)return {code:'LLM_QUOTA',error:messages[kind].quota};
   if(used(person,now-windowMs)>=count||used('address:'+address,now-PER_ADDRESS.windowMs)>=PER_ADDRESS.count)return {code:'LLM_RATE',error:messages[kind].rate};
   const record=db.prepare('INSERT INTO llm_calls VALUES(?,?)');record.run(person,now);record.run('address:'+address,now);
   db.prepare('INSERT INTO llm_daily VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1').run(day);
   return null;
  });
 }
 return {take};
}
