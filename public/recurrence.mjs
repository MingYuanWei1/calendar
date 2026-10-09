// 重复事件: one event with a 重复规则 (repeat rule) happens on several dates. Dates are worked out on read and
// never stored. Repeats skip 放假 days; "every school day" also skips weekends but includes 调休 days.
// Single dates are changed through event.exceptions, keyed by the date the rule produced:
// {cancelled, cancelReason} (本次取消), {deleted} (removed silently), or field overrides such as a new start/time.
// Shared by the server (validation, feeds, assistant), the public calendar and the admin console.

/** Fields a single date may override; type, scope and time mode always follow the series. */
export const OVERRIDABLE=['title','location','host','description','start','time','endTime','poster','qr','registrationUrl'];

const parts=iso=>iso.split('-').map(Number);
const toIso=ms=>new Date(ms).toISOString().slice(0,10);
export const addDays=(iso,n)=>{const [y,m,d]=parts(iso);return toIso(Date.UTC(y,m-1,d+n));};
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const weekdayOf=iso=>{const [y,m,d]=parts(iso);return (new Date(Date.UTC(y,m-1,d)).getUTCDay()+6)%7+1;};
const daysIn=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
/** Which occurrence of its weekday in the month a date is: 1–4, or 5 for a fifth. */
export const ordinalOf=iso=>Math.ceil(parts(iso)[2]/7);
export const isLastOfMonth=iso=>{const [y,m,d]=parts(iso);return d+7>daysIn(y,m);};

/** The date of the nth (-1 = last) given weekday in a month, or null when it does not exist. */
function nthWeekday(y,m,ordinal,weekday){
 if(ordinal===-1){const last=`${y}-${String(m).padStart(2,'0')}-${String(daysIn(y,m)).padStart(2,'0')}`;return addDays(last,-((weekdayOf(last)-weekday+7)%7));}
 const first=`${y}-${String(m).padStart(2,'0')}-01`,date=addDays(first,(weekday-weekdayOf(first)+7)%7+(ordinal-1)*7);
 return parts(date)[1]===m?date:null;
}

/** Whether a date fits the rule's pattern from its start, ignoring holidays and the end condition. */
export function matchesPattern(rule,start,iso){
 if(iso<start)return false;
 const [sy,sm]=parts(start),[y,m,d]=parts(iso);
 if(rule.freq==='daily'){
  if(rule.schoolDays)return true;
  return Math.round((Date.parse(iso)-Date.parse(start))/864e5)%rule.interval===0;
 }
 if(rule.freq==='weekly'){
  const weeks=Math.round((Date.parse(addDays(iso,1-weekdayOf(iso)))-Date.parse(addDays(start,1-weekdayOf(start))))/(7*864e5));
  return weeks%rule.interval===0&&rule.weekdays.includes(weekdayOf(iso));
 }
 if(((y-sy)*12+m-sm)%rule.interval!==0)return false;
 return rule.monthDays?rule.monthDays.includes(d):nthWeekday(y,m,rule.ordinal,rule.weekday)===iso;
}

/** Pattern dates in ascending order from the start, before holidays and the end condition apply. */
function* patternDates(rule,start){
 if(rule.freq==='daily'){for(let d=start;;d=addDays(d,rule.schoolDays?1:rule.interval))yield d;}
 if(rule.freq==='weekly'){
  const monday=addDays(start,1-weekdayOf(start)),days=[...rule.weekdays].sort((a,b)=>a-b);
  for(let week=0;;week+=rule.interval)for(const wd of days){const d=addDays(monday,week*7+wd-1);if(d>=start)yield d;}
 }
 const [sy,sm]=parts(start);
 for(let n=0;;n+=rule.interval){
  const y=sy+Math.floor((sm-1+n)/12),m=(sm-1+n)%12+1;
  const dates=rule.monthDays?[...rule.monthDays].sort((a,b)=>a-b).filter(d=>d<=daysIn(y,m)).map(d=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`):[nthWeekday(y,m,rule.ordinal,rule.weekday)].filter(Boolean);
  for(const d of dates)if(d>=start)yield d;
 }
}

/** plans maps ISO dates to {kind}; dates without a plan follow the normal Monday–Friday week. */
export const isOff=(plans,iso)=>plans?.[iso]?.kind==='off';
export const isSchoolDay=(plans,iso)=>plans?.[iso]?plans[iso].kind!=='off':weekdayOf(iso)<=5;
/** Whether the rule holds the event on a pattern date, i.e. it is not skipped for a day off. */
const held=(rule,plans,iso)=>!isOff(plans,iso)&&(!rule.schoolDays||isSchoolDay(plans,iso));

/**
 * The dates the series is held on (the exception keys), up to and including `to`.
 * A count counts held dates only, so days off never use one up.
 */
export function seriesDates(event,plans,to){
 const rule=event.repeat;
 if(!rule)return event.start<=to?[event.start]:[];
 const dates=[];
 for(const d of patternDates(rule,event.start)){
  if(d>to||(rule.until&&d>rule.until))break;
  if(!held(rule,plans,d))continue;
  dates.push(d);
  if(rule.count&&dates.length>=rule.count)break;
 }
 return dates;
}

/** The final date of a series that ends, or null when it repeats forever. */
export function lastDate(event,plans){
 const rule=event.repeat;
 if(!rule)return event.start;
 if(rule.count)return seriesDates(event,plans,'9999-12-31').at(-1)||event.start;
 return rule.until||null;
}

/** Whether a date is one the series is held on (including dates since cancelled or edited). */
export function isSeriesDate(event,plans,iso){
 return Boolean(event.repeat)&&matchesPattern(event.repeat,event.start,iso)&&held(event.repeat,plans,iso)&&seriesDates(event,plans,iso).at(-1)===iso;
}
/** Whether a date could carry an exception after a rule change: on the pattern and within the end condition. */
export function fitsSeries(event,plans,iso){
 const rule=event.repeat;
 if(!rule||!matchesPattern(rule,event.start,iso))return false;
 const last=lastDate(event,plans);
 return !last||iso<=last;
}

/** One dated instance of a series, shaped like a plain event so calendars can render it directly. */
export function occurrence(event,date){
 const ex=event.exceptions?.[date]||{},override=Object.fromEntries(OVERRIDABLE.filter(k=>ex[k]!==undefined).map(k=>[k,ex[k]]));
 const start=override.start||date,moved=event.status!=='draft'&&(start!==date||(override.time??event.time)!==event.time||(override.endTime??event.endTime)!==event.endTime);
 const once=!event.cancelled&&Boolean(ex.cancelled);
 return {...event,...override,id:`${event.id}@${date}`,seriesId:event.id,occurrence:date,start,end:undefined,exceptions:undefined,
  cancelled:Boolean(event.cancelled||ex.cancelled),cancelReason:once?ex.cancelReason||'':event.cancelReason,cancelledOnce:once,
  oldDate:moved?date:undefined,previousSchedule:moved?{start:date,time:event.time,endTime:event.endTime,type:event.type}:undefined};
}

/**
 * Plain events plus the dated instances of every series that fall within [from, to].
 * A date moved by an exception is shown on its new date.
 */
export function expandEvents(events,plans,from,to){
 const out=[];
 for(const event of events){
  if(!event.repeat){out.push(event);continue;}
  // A date moved into the window may come from a later date, so search up to the latest such one.
  const horizon=[to,...Object.entries(event.exceptions||{}).filter(([,ex])=>ex.start>=from&&ex.start<=to).map(([date])=>date)].sort().at(-1);
  for(const date of seriesDates(event,plans,horizon)){
   if(event.exceptions?.[date]?.deleted)continue;
   const item=occurrence(event,date);
   if(item.start>=from&&item.start<=to)out.push(item);
  }
 }
 return out;
}

const WEEKDAY_NAMES=[['周一','Monday'],['周二','Tuesday'],['周三','Wednesday'],['周四','Thursday'],['周五','Friday'],['周六','Saturday'],['周日','Sunday']];
const ORDINALS={1:['第一个','first'],2:['第二个','second'],3:['第三个','third'],4:['第四个','fourth'],[-1]:['最后一个','last']};
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dayText=(iso,lang)=>{const [y,m,d]=parts(iso);return lang?`${d} ${MONTHS[m-1]} ${y}`:`${y}年${m}月${d}日`;};
const list=(items,lang)=>lang?items.length>1?items.slice(0,-1).join(', ')+' and '+items.at(-1):items[0]:items.join('、');

/** A plain-language summary such as "每 2 周的周一、周三，至 2027年7月31日" (lang 0) or "Every 2 weeks on Monday and Wednesday" (lang 1). */
export function describeRepeat(rule,lang=0){
 if(!rule)return lang?'Does not repeat':'不重复';
 const n=rule.interval||1,L=(zh,en)=>lang?en:zh;
 let text;
 if(rule.freq==='daily')text=rule.schoolDays?L('每个上学日','Every school day'):n===1?L('每天','Every day'):L(`每 ${n} 天`,`Every ${n} days`);
 else if(rule.freq==='weekly'){
  const days=list([...rule.weekdays].sort((a,b)=>a-b).map(d=>WEEKDAY_NAMES[d-1][lang]),lang);
  text=n===1?L(`每${days}`,`Every week on ${days}`):L(`每 ${n} 周的${days}`,`Every ${n} weeks on ${days}`);
 }else{
  const on=rule.monthDays?(lang?'day '+list([...rule.monthDays].sort((a,b)=>a-b).map(String),1):' '+[...rule.monthDays].sort((a,b)=>a-b).join('、')+' 日'):lang?`the ${ORDINALS[rule.ordinal][1]} ${WEEKDAY_NAMES[rule.weekday-1][1]}`:`${ORDINALS[rule.ordinal][0]}${WEEKDAY_NAMES[rule.weekday-1][0]}`;
  text=n===1?L(`每月${on}`,`Every month on ${on}`):L(`每 ${n} 个月的${on}`,`Every ${n} months on ${on}`);
 }
 const end=rule.until?L(`，至 ${dayText(rule.until,0)}`,`, until ${dayText(rule.until,1)}`):rule.count?L(`，共 ${rule.count} 次`,`, ${rule.count} times`):'';
 return text+end;
}

/** The rule's problem with this start date, or '' when it is consistent. */
export function repeatProblem(rule,start){
 if(rule.schoolDays&&(rule.freq!=='daily'||rule.interval!==1))return 'Every school day repeats daily with an interval of 1';
 if(rule.freq==='weekly'&&!rule.weekdays?.length)return 'Choose at least one weekday';
 if(rule.freq==='monthly'&&!rule.monthDays?.length&&!(rule.ordinal&&rule.weekday))return 'Choose the days of the month';
 if(rule.until&&rule.count)return 'Choose either an end date or a number of times';
 if(rule.until&&rule.until<start)return 'The repeat must not end before the start date';
 if(!matchesPattern(rule,start,start))return 'The start date must be one of the repeat dates';
 return '';
}

/** The last day (31 July) of the school year a date belongs to; August counts towards the coming year. */
export function schoolYearEnd(iso,yearsAhead=0){
 const [y,m]=parts(iso);
 return `${(m>=8?y+1:y)+yearsAhead}-07-31`;
}
