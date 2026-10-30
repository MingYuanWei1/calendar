// 访问统计: the calendar and exams pages report each load once they are running, so crawlers that run no script
// are left out, and administrators' own visits are not counted. 浏览量 are kept per page and day for good;
// 访客 are counted as distinct people per day, week and month. While a period is open, each visitor is held only
// as a hash salted for that period; once it closes, its salt and hashes are deleted and only the counts remain.
import {createHash,randomBytes} from 'node:crypto';

export const PAGES=['calendar','exams'];
// Views beyond this per visitor, page and day are ignored, so a script cannot inflate the counts.
const DAILY_VIEW_CAP=50;
const SERIES={day:30,week:12,month:12};

const shift=(date,days)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
/** The Monday that starts the week holding a school date. */
export const weekOf=date=>shift(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7));
const monthOf=date=>date.slice(0,7);
const shiftMonth=(month,count)=>{const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+count);return d.toISOString().slice(0,7);};

export function installStats(app,db,{session,requireAdmin,timeZone,now=()=>Date.now()}){
 db.exec(`CREATE TABLE IF NOT EXISTS stat_views(day TEXT NOT NULL,page TEXT NOT NULL,views INTEGER NOT NULL,PRIMARY KEY(day,page));
 CREATE TABLE IF NOT EXISTS stat_visitors(unit TEXT NOT NULL,period TEXT NOT NULL,signed_in INTEGER NOT NULL,anonymous INTEGER NOT NULL,PRIMARY KEY(unit,period));
 CREATE TABLE IF NOT EXISTS stat_salts(unit TEXT PRIMARY KEY,period TEXT NOT NULL,salt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS stat_visitor_keys(unit TEXT NOT NULL,key TEXT NOT NULL,PRIMARY KEY(unit,key));
 CREATE TABLE IF NOT EXISTS stat_page_loads(page TEXT NOT NULL,key TEXT NOT NULL,views INTEGER NOT NULL,PRIMARY KEY(page,key));`);
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
 const open=day=>({day,week:weekOf(day),month:monthOf(day)});

 /** This visitor's hash for the open period of a unit; a period that has closed takes its salt and hashes with it. */
 function visitorKey(unit,period,identity){
  let salt=db.prepare('SELECT period,salt FROM stat_salts WHERE unit=?').get(unit);
  if(salt?.period!==period){
   db.prepare('DELETE FROM stat_visitor_keys WHERE unit=?').run(unit);
   if(unit==='day')db.prepare('DELETE FROM stat_page_loads').run();
   salt={period,salt:randomBytes(16).toString('hex')};
   db.prepare('INSERT INTO stat_salts VALUES(?,?,?) ON CONFLICT(unit) DO UPDATE SET period=excluded.period,salt=excluded.salt').run(unit,period,salt.salt);
  }
  return createHash('sha256').update(salt.salt+'\n'+identity).digest('hex');
 }

 app.post('/api/views',(req,res)=>{
  const page=req.body?.page;
  if(!PAGES.includes(page))return res.status(400).json({error:'页面无效。'});
  const user=session(req);
  if(user?.role>=2)return res.status(204).end();
  const identity=user?'user:'+user.id:'address:'+(req.calendarClientAddress||req.ip||'unknown');
  const periods=open(today());
  db.transactionSync(()=>{
   const keys=Object.fromEntries(Object.entries(periods).map(([unit,period])=>[unit,visitorKey(unit,period,identity)]));
   for(const [unit,period] of Object.entries(periods)){
    if(db.prepare('SELECT 1 FROM stat_visitor_keys WHERE unit=? AND key=?').get(unit,keys[unit]))continue;
    db.prepare('INSERT INTO stat_visitor_keys VALUES(?,?)').run(unit,keys[unit]);
    db.prepare(`INSERT INTO stat_visitors VALUES(?,?,?,?) ON CONFLICT(unit,period) DO UPDATE SET signed_in=signed_in+excluded.signed_in,anonymous=anonymous+excluded.anonymous`).run(unit,period,user?1:0,user?0:1);
   }
   const loads=db.prepare('SELECT views FROM stat_page_loads WHERE page=? AND key=?').get(page,keys.day)?.views||0;
   if(loads>=DAILY_VIEW_CAP)return;
   db.prepare('INSERT INTO stat_page_loads VALUES(?,?,1) ON CONFLICT(page,key) DO UPDATE SET views=views+1').run(page,keys.day);
   db.prepare('INSERT INTO stat_views VALUES(?,?,1) ON CONFLICT(day,page) DO UPDATE SET views=views+1').run(periods.day,page);
  });
  res.status(204).end();
 });

 const range={day:start=>[start,start],week:start=>[start,shift(start,6)],month:start=>[start+'-01',start+'-31']};
 const viewsIn=db.prepare('SELECT page,SUM(views) AS views FROM stat_views WHERE day BETWEEN ? AND ? GROUP BY page');
 const visitorsIn=db.prepare('SELECT signed_in,anonymous FROM stat_visitors WHERE unit=? AND period=?');
 function point(unit,start){
  const views=Object.fromEntries(PAGES.map(page=>[page,0]));
  for(const row of viewsIn.all(...range[unit](start)))if(PAGES.includes(row.page))views[row.page]=Number(row.views);
  const visitors=visitorsIn.get(unit,start);
  return {start,views,visitors:{signedIn:Number(visitors?.signed_in||0),anonymous:Number(visitors?.anonymous||0)}};
 }
 /** Every month from the first one with data up to the open one, oldest first. */
 function months(current){
  const first=db.prepare(`SELECT MIN(m) AS m FROM (SELECT MIN(substr(day,1,7)) AS m FROM stat_views UNION ALL SELECT MIN(period) FROM stat_visitors WHERE unit='month')`).get()?.m;
  const list=[];for(let m=first&&first<current?first:current;m<=current;m=shiftMonth(m,1))list.push(m);
  return list;
 }

 // The latest days, weeks and months, oldest first, each ending with the period still open.
 // ?month=YYYY-MM gives that month and its days instead; ?month=all gives every month and the all-time views.
 app.get('/api/admin/stats',requireAdmin,(req,res)=>{
  const current=open(today()),available=months(current.month),month=req.query.month;
  if(month==='all'){
   const list=available.map(m=>point('month',m)),views=Object.fromEntries(PAGES.map(page=>[page,list.reduce((n,p)=>n+p.views[page],0)]));
   return res.json({today:current.day,months:available,all:{views,months:list}});
  }
  if(month!==undefined){
   if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month>current.month)return res.status(400).json({error:'月份无效。'});
   const days=[];for(let d=month+'-01';d.startsWith(month)&&d<=current.day;d=shift(d,1))days.push(point('day',d));
   return res.json({today:current.day,months:available,month:{total:point('month',month),previous:point('month',shiftMonth(month,-1)),days}});
  }
  const starts={
   day:Array.from({length:SERIES.day},(_,i)=>shift(current.day,i-SERIES.day+1)),
   week:Array.from({length:SERIES.week},(_,i)=>shift(current.week,7*(i-SERIES.week+1))),
   month:Array.from({length:SERIES.month},(_,i)=>shiftMonth(current.month,i-SERIES.month+1))
  };
  const series=Object.fromEntries(Object.entries(starts).map(([unit,list])=>[unit,list.map(start=>point(unit,start))]));
  res.json({today:current.day,months:available,series});
 });
}
