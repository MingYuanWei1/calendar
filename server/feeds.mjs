import {randomBytes} from 'node:crypto';
import {isSeriesDate,lastDate,matchesPattern,occurrence,weekdayOf} from '../public/recurrence.mjs';
import {gradeLabel} from '../public/grades.mjs';

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

/**
 * Repeating events use wall-clock times in the school's zone. A zone without daylight saving gets a
 * fixed-offset VTIMEZONE; calendar apps resolve other IANA zone names themselves.
 */
function timeZoneBlock(timeZone){
 const offset=ms=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(ms)).map(x=>[x.type,x.value]));return Math.round((Date.UTC(+p.year,p.month-1,+p.day,+p.hour,+p.minute)-ms)/60000);};
 const year=new Date().getUTCFullYear(),winter=offset(Date.UTC(year,0,1)),summer=offset(Date.UTC(year,6,1));
 if(winter!==summer)return [];
 const sign=winter<0?'-':'+',abs=Math.abs(winter),value=`${sign}${String(Math.floor(abs/60)).padStart(2,'0')}${String(abs%60).padStart(2,'0')}`;
 return ['BEGIN:VTIMEZONE',`TZID:${timeZone}`,'BEGIN:STANDARD','DTSTART:19700101T000000',`TZOFFSETFROM:${value}`,`TZOFFSETTO:${value}`,'END:STANDARD','END:VTIMEZONE'];
}

export function calendarFile({name,description,items,timeZone}){
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//School Calendar//Calendar//ZH','CALSCALE:GREGORIAN','METHOD:PUBLISH',
  `X-WR-CALNAME:${text(name)}`,`X-WR-CALDESC:${text(description)}`,'REFRESH-INTERVAL;VALUE=DURATION:PT1H','X-PUBLISHED-TTL:PT1H'];
 if(timeZone&&items.some(item=>item.when.some(line=>line.includes(';TZID='))))lines.push(...timeZoneBlock(timeZone));
 const now=stamp(Date.now());
 for(const item of items){
  lines.push('BEGIN:VEVENT',`UID:${item.uid}`,`DTSTAMP:${now}`,...item.when,...(item.recurrence||[]),`SUMMARY:${text(item.summary)}`);
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
const BYDAY=['MO','TU','WE','TH','FR','SA','SU'];

/**
 * The lines that make a series repeat. Days off and deleted dates become EXDATEs and make-up school days
 * become RDATEs, so phones show exactly the dates the website does. A count ends on its last held date,
 * because days off never use one up here while COUNT in iCalendar would count them.
 */
function recurrenceLines(e,plans,timeZone){
 const rule=e.repeat,local=e.timeMode!=='allDay',last=lastDate(e,plans);
 const value=date=>local?`;TZID=${timeZone}:${compact(date)}T${e.time.replace(':','')}00`:`;VALUE=DATE:${compact(date)}`;
 const parts=rule.schoolDays?['FREQ=WEEKLY','BYDAY=MO,TU,WE,TH,FR']:[`FREQ=${rule.freq.toUpperCase()}`,...(rule.interval>1?[`INTERVAL=${rule.interval}`]:[]),
  ...(rule.freq==='weekly'?[`BYDAY=${rule.weekdays.map(d=>BYDAY[d-1]).join(',')}`]:[]),
  ...(rule.freq==='monthly'?[rule.monthDays?`BYMONTHDAY=${rule.monthDays.join(',')}`:`BYDAY=${rule.ordinal}${BYDAY[rule.weekday-1]}`]:[])];
 if(last)parts.push(`UNTIL=${local?instant(last,e.time,timeZone):compact(last)}`);
 const within=date=>date>=e.start&&(!last||date<=last);
 const excluded=Object.keys(plans).filter(date=>plans[date].kind==='off'&&within(date)&&(rule.schoolDays?weekdayOf(date)<=5:matchesPattern(rule,e.start,date)));
 const deleted=Object.keys(e.exceptions||{}).filter(date=>e.exceptions[date].deleted);
 const added=rule.schoolDays?Object.keys(plans).filter(date=>plans[date].kind!=='off'&&weekdayOf(date)>5&&within(date)):[];
 return [`RRULE:${parts.join(';')}`,...[...new Set([...excluded,...deleted])].sort().map(date=>'EXDATE'+value(date)),...added.sort().map(date=>'RDATE'+value(date))];
}

export function installFeeds(app,db,{user,account,origin,timeZone,matching,examEvents=()=>[]}){
 db.exec('CREATE TABLE IF NOT EXISTS feed_tokens(token TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE,created TEXT NOT NULL)');
 const L=(req,zh,en)=>req.query.lang==='en'?en:zh;
 const pick=(req,pair)=>(req.query.lang==='en'?(pair?.[1]||pair?.[0]):(pair?.[0]||pair?.[1]))||'';
 const base=`${origin}/api/feeds/`;
 const send=(res,file)=>res.set({'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'no-cache'}).send(calendarFile(file));
 const weekdays=[['周一','Monday'],['周二','Tuesday'],['周三','Wednesday'],['周四','Thursday'],['周五','Friday']];
 const kinds={off:['放假','No school'],school:['调休上课','Make-up school day'],half:['半天','Half day']};

 function calendarItems(req){
  const items=[];
  const dayKinds=Object.fromEntries(db.prepare('SELECT date,kind FROM day_plans').all().map(plan=>[plan.date,plan]));
  const entry=e=>{
   const cancelled=e.cancelled||e.status==='cancelled';
   const when=e.timeMode==='timed'||(e.timeMode==='deadline'&&e.time)?timed(e.start,e.time,e.endTime||e.time,timeZone):allDay(e.start,e.timeMode==='multi'?e.end:e.start);
   const moved=e.previousSchedule?L(req,`已改期，原定 ${e.previousSchedule.start}${e.previousSchedule.time?' '+e.previousSchedule.time:''}`,`Rescheduled from ${e.previousSchedule.start}${e.previousSchedule.time?' '+e.previousSchedule.time:''}`):'';
   const notes=[cancelled?L(req,`${e.cancelledOnce?'本次取消':'已取消'}：${e.cancelReason||''}`,`${e.cancelledOnce?'Cancelled this time':'Cancelled'}: ${e.cancelReason||''}`):'',moved,pick(req,e.description),e.registrationUrl?L(req,`报名：${e.registrationUrl}`,`Registration: ${e.registrationUrl}`):''].filter(Boolean);
   const tag=e.cancelledOnce?L(req,'[本次取消] ','[Cancelled this time] '):cancelled?L(req,'[已取消] ','[Cancelled] '):'';
   const url=e.examBatch?`${origin}/exams.html?batch=${encodeURIComponent(e.examBatch)}`:`${origin}/?event=${encodeURIComponent(e.seriesId||e.id)}${e.occurrence?'&date='+e.occurrence:''}`;
   return {uid:`event-${e.seriesId||e.id}@calendar`,when,summary:`${tag}${e.type==='deadline'?L(req,'截止：','Due: '):''}${pick(req,e.title)}`,location:pick(req,e.location),description:notes.join('\n\n'),url,sequence:e.version,cancelled,transparent:e.type==='deadline'};
  };
  const school=db.prepare("SELECT body FROM events WHERE status IN ('published','cancelled')").all().map(row=>JSON.parse(row.body));
  for(const e of [...school,...examEvents()]){
   if(!e.repeat){items.push(entry(e));continue;}
   // A repeating event wears wall-clock times so its dates follow the school's clock.
   const local=(date,time)=>`;TZID=${timeZone}:${compact(date)}T${time.replace(':','')}00`;
   const placed=item=>{const base=entry(item);return e.timeMode==='allDay'||!e.time?base:{...base,when:[`DTSTART${local(item.start,item.time)}`,`DTEND${local(item.start,item.endTime||item.time)}`]};};
   items.push({...placed(e),recurrence:recurrenceLines(e,dayKinds,timeZone)});
   // Dates with their own changes override the series by RECURRENCE-ID; deleted ones are EXDATEs above.
   for(const date of Object.keys(e.exceptions||{}).sort()){
    if(e.exceptions[date].deleted||!isSeriesDate(e,dayKinds,date))continue;
    items.push({...placed(occurrence(e,date)),recurrence:[`RECURRENCE-ID${e.timeMode==='allDay'||!e.time?`;VALUE=DATE:${compact(date)}`:local(date,e.time)}`]});
   }
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
    const details=[pick(req,[batch.title,batch.titleEn]),s.grades.map(g=>gradeLabel(g,req.query.lang==='en'?1:0)).join(', '),[s.subject,s.level].filter(Boolean).join(' '),seat?L(req,`我的座位：${seatText}`,`My seat: ${seatText}`):'',s.note].filter(Boolean);
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

 app.get('/api/feeds/calendar.ics',(req,res)=>send(res,{name:L(req,'日历 · 校历','Calendar · School calendar'),description:L(req,'学校活动、比赛、截止日与放假调休安排','School events, deadlines, days off and make-up days'),items:calendarItems(req),timeZone}));
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
