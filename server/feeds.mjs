import {randomBytes} from 'node:crypto';

// 日历订阅: iCalendar (RFC 5545) feeds that phone and desktop calendars poll. The school calendar and all
// published exams are public; "my exams" belongs to one student and is reached through a personal token,
// because calendar apps cannot sign in. A token can be regenerated, which stops the old link working.
const tokenPattern=/^[a-f0-9]{40}$/;

/** Folds a content line at 75 octets without splitting a UTF-8 character. */
function fold(line){
 const bytes=Buffer.from(line);if(bytes.length<=75)return line;
 const parts=[];let current='',size=0,limit=75;
 for(const char of line){const n=Buffer.byteLength(char);if(size+n>limit){parts.push(current);current='';size=0;limit=74;}current+=char;size+=n;}
 return [...parts,current].join('\r\n ');
}
const text=value=>String(value??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/[,;]/g,c=>'\\'+c);
const compact=iso=>iso.replaceAll('-','');
const nextDay=iso=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
const stamp=ms=>new Date(ms).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');

/** The UTC instant of a wall-clock time in the school's time zone. */
function instant(date,time,timeZone){
 const offset=ms=>{
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(ms)).map(x=>[x.type,x.value]));
  return Date.UTC(+p.year,p.month-1,+p.day,+p.hour,+p.minute,+p.second)-ms;
 };
 const wall=Date.parse(`${date}T${time}:00Z`);let ms=wall-offset(wall);
 const corrected=wall-offset(ms);if(corrected!==ms)ms=corrected;
 return stamp(ms);
}

export function calendarFile({name,description,items}){
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//School Calendar//Calendar//ZH','CALSCALE:GREGORIAN','METHOD:PUBLISH',
  `X-WR-CALNAME:${text(name)}`,`X-WR-CALDESC:${text(description)}`,'REFRESH-INTERVAL;VALUE=DURATION:PT1H','X-PUBLISHED-TTL:PT1H'];
 const now=stamp(Date.now());
 for(const item of items){
  lines.push('BEGIN:VEVENT',`UID:${item.uid}`,`DTSTAMP:${now}`,...item.when,`SUMMARY:${text(item.summary)}`);
  if(item.location)lines.push(`LOCATION:${text(item.location)}`);
  if(item.description)lines.push(`DESCRIPTION:${text(item.description)}`);
  if(item.url)lines.push(`URL:${item.url}`);
  if(item.sequence)lines.push(`SEQUENCE:${item.sequence}`);
  if(item.cancelled)lines.push('STATUS:CANCELLED');
  if(item.transparent)lines.push('TRANSP:TRANSPARENT');
  lines.push('END:VEVENT');
 }
 lines.push('END:VCALENDAR');
 return lines.map(fold).join('\r\n')+'\r\n';
}

const allDay=(start,end=start)=>[`DTSTART;VALUE=DATE:${compact(start)}`,`DTEND;VALUE=DATE:${compact(nextDay(end))}`];
const timed=(date,start,end,timeZone)=>[`DTSTART:${instant(date,start,timeZone)}`,`DTEND:${instant(date,end,timeZone)}`];

export function installFeeds(app,db,{user,account,origin,timeZone,matching}){
 db.exec('CREATE TABLE IF NOT EXISTS feed_tokens(token TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE,created TEXT NOT NULL)');
 const L=(req,zh,en)=>req.query.lang==='en'?en:zh;
 const pick=(req,pair)=>(req.query.lang==='en'?(pair?.[1]||pair?.[0]):(pair?.[0]||pair?.[1]))||'';
 const base=`${origin}/api/feeds/`;
 const send=(res,file)=>res.set({'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'no-cache'}).send(calendarFile(file));
 const weekdays=[['周一','Monday'],['周二','Tuesday'],['周三','Wednesday'],['周四','Thursday'],['周五','Friday']];
 const kinds={off:['放假','No school'],school:['调休上课','Make-up school day'],half:['半天','Half day']};

 function calendarItems(req){
  const items=[];
  for(const row of db.prepare("SELECT body FROM events WHERE status IN ('published','cancelled')").all()){
   const e=JSON.parse(row.body),cancelled=e.cancelled||e.status==='cancelled';
   const when=e.timeMode==='timed'?timed(e.start,e.time,e.endTime,timeZone):e.timeMode==='deadline'?timed(e.start,e.time,e.time,timeZone):allDay(e.start,e.timeMode==='multi'?e.end:e.start);
   const moved=e.previousSchedule?L(req,`已改期，原定 ${e.previousSchedule.start}${e.previousSchedule.time?' '+e.previousSchedule.time:''}`,`Rescheduled from ${e.previousSchedule.start}${e.previousSchedule.time?' '+e.previousSchedule.time:''}`):'';
   const notes=[cancelled?L(req,`已取消：${e.cancelReason||''}`,`Cancelled: ${e.cancelReason||''}`):'',moved,pick(req,e.description),e.registrationUrl?L(req,`报名：${e.registrationUrl}`,`Registration: ${e.registrationUrl}`):''].filter(Boolean);
   items.push({uid:`event-${e.id}@calendar`,when,summary:`${cancelled?L(req,'[已取消] ','[Cancelled] '):''}${e.type==='deadline'?L(req,'截止：','Due: '):''}${pick(req,e.title)}`,location:pick(req,e.location),description:notes.join('\n\n'),url:`${origin}/?event=${encodeURIComponent(e.id)}`,sequence:e.version,cancelled,transparent:e.type==='deadline'});
  }
  // Consecutive days with the same plan become one all-day entry.
  const plans=db.prepare('SELECT date,kind,title,follows FROM day_plans ORDER BY date').all();
  for(let i=0;i<plans.length;){
   const first=plans[i];let last=first;
   while(plans[i+1]&&plans[i+1].kind===first.kind&&plans[i+1].title===first.title&&plans[i+1].follows===first.follows&&plans[i+1].date===nextDay(last.date))last=plans[++i];
   i++;
   if(!kinds[first.kind])continue;
   const title=pick(req,JSON.parse(first.title)),follows=first.follows?L(req,`（按${weekdays[first.follows-1][0]}课表）`,` (${weekdays[first.follows-1][1]} timetable)`):'';
   items.push({uid:`day-${first.date}-${first.kind}@calendar`,when:allDay(first.date,last.date),summary:`${pick(req,kinds[first.kind])}${title?L(req,'：',': ')+title:''}${follows}`,transparent:true});
  }
  return items;
 }

 function examItems(req,{only,seats}={}){
  const items=[];
  for(const row of db.prepare('SELECT id,published FROM exam_batches WHERE published IS NOT NULL').all()){
   const batch=JSON.parse(row.published),chosen=only?.(batch.id),personal=seats?.(batch.id)||{};
   for(const s of batch.sessions){
    if(chosen&&!chosen.has(s.id))continue;
    const seat=personal[s.id],name=req.query.lang==='en'?(s.titleEn||s.title):s.title;
    const seatText=seat?L(req,`${seat.room} 第 ${seat.row} 排，第 ${seat.column} 列`,`${seat.room}, row ${seat.row}, column ${seat.column}`):'';
    const details=[pick(req,[batch.title,batch.titleEn]),s.grades.join(', '),[s.subject,s.level].filter(Boolean).join(' '),seat?L(req,`我的座位：${seatText}`,`My seat: ${seatText}`):'',s.note].filter(Boolean);
    items.push({uid:`exam-${batch.id}-${s.id}@calendar`,when:timed(s.date,s.start,s.end,timeZone),summary:`${s.cancelled?L(req,'[已取消] ','[Cancelled] '):''}${L(req,'考试：','Exam: ')}${name}${seat?` · ${seat.room}`:''}`,location:seatText||s.rooms.join(', '),description:details.join('\n'),url:`${origin}/exams.html?batch=${encodeURIComponent(batch.id)}`,cancelled:s.cancelled});
   }
  }
  return items;
 }

 const tokenFor=(u,fresh=false)=>{
  const existing=db.prepare('SELECT token FROM feed_tokens WHERE user_id=?').get(u.id)?.token;
  if(existing&&!fresh)return existing;
  const token=randomBytes(20).toString('hex');
  db.prepare('INSERT INTO feed_tokens VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET token=excluded.token,created=excluded.created').run(token,u.id,new Date().toISOString());
  return token;
 };
 const links=u=>({calendar:base+'calendar.ics',exams:base+'exams.ics',mine:u?`${base}mine/${tokenFor(u)}.ics`:null});
 app.get('/api/feeds',(req,res)=>res.json(links(user(req))));
 app.post('/api/feeds/mine/reset',(req,res)=>{const u=user(req);if(!u)return res.status(401).json({error:'请先登录。'});tokenFor(u,true);res.json(links(u));});

 app.get('/api/feeds/calendar.ics',(req,res)=>send(res,{name:L(req,'日历 · 校历','Calendar · School calendar'),description:L(req,'学校活动、比赛、截止日与放假调休安排','School events, deadlines, days off and make-up days'),items:calendarItems(req)}));
 app.get('/api/feeds/exams.ics',(req,res)=>send(res,{name:L(req,'日历 · 考试安排','Calendar · Exams'),description:L(req,'已发布的全部考试场次','Every published exam session'),items:examItems(req)}));
 app.get('/api/feeds/mine/:file',(req,res)=>{
  const token=req.params.file.replace(/\.ics$/,'');
  const row=tokenPattern.test(token)&&db.prepare('SELECT user_id FROM feed_tokens WHERE token=?').get(token),u=row&&account(row.user_id);
  if(!u)return res.status(404).type('text/plain').send('Subscription not found');
  // "My exams" is first filled from the student's matched seats, exactly as on the exams page.
  const only=bid=>{matching.prepare(u,bid);return new Set(db.prepare('SELECT exam_id FROM exam_choices WHERE user_id=? AND batch_id=?').all(u.id,bid).map(r=>r.exam_id));};
  send(res,{name:L(req,`日历 · 我的考试（${u.name}）`,`Calendar · My exams (${u.name})`),description:L(req,'我关注的考试，含本人考场与座位','The exams I follow, with my room and seat'),items:examItems(req,{only,seats:bid=>matching.personal(u,bid)})});
 });
}
