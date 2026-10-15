'use strict';
// The details panel stays closed until an event is selected.
document.body.className='airy detail-closed';
/** @returns {any} */
const $ = selector => document.querySelector(selector);
/** @returns {any[]} */
const $$ = selector => [...document.querySelectorAll(selector)];
const copy = {
  brand:['日历','Calendar'], calendarNav:['校历','Calendar'], examsNav:['考试安排','Exams'],
  publicCalendar:['属于每一位同学的校园日程','A calendar for every student'], searchLabel:['搜索','Search'], september:['2026 年 9 月','September 2026'], autumn:['秋季学期','Autumn term'], scope:['适用学部','School division'], reset:['重置','Reset'], types:['事件类型','Event types'], scopeNote:['选择学部时，同时显示全校事件。','School-wide events are included in every division.'], publicNote:['公开校历 · 无需登录','Public calendar · No sign-in'], schoolLife:['校园生活 / SCHOOL LIFE','SCHOOL LIFE'], term:['2026—2027 学年 · 秋季学期','2026–2027 · Autumn term'], today:['今天','Today'], monthView:['月历','Month'], weekView:['周历','Week'], listView:['日程','Agenda'], emptyTitle:['没有符合条件的事件','No matching events'], emptyHelp:['试试其他关键词，或重置筛选。','Try another search or reset your filters.'], dayEvents:['当天事件','EVENTS ON THIS DAY'], registrationPreview:['报名入口示意','Registration preview'], registrationNotice:['正式发布时，此处打开管理员填写的外部报名表。当前设计稿未连接真实表单。','In the published calendar, this opens the external form provided by an administrator. This design is not connected to a real form.'], understood:['知道了','Got it'], detail:['事件详情','EVENT DETAILS'], close:['关闭详情','Close details'], when:['时间','When'], where:['地点','Where'], for:['适用','For'], host:['主办','Host'], about:['事件说明','About this event'], allDay:['全天','All day'], till:['截止','Due'], cancelled:['已取消','Cancelled'], cancelledOnce:['本次取消','Cancelled this time'], repeats:['重复','Repeats'], changed:['已改期','Rescheduled'], registration:['查看报名表','Open registration form'], external:['通过外部表单报名，本平台仅展示信息。','Registration is handled by an external form.'], updated:['更新于 9 月 18 日 16:30','Updated 18 Sep, 16:30'], chooseEvent:['选择一项事件查看详情','Select an event to see the details'], missingLocation:['未设置地点','No location specified'], allSchools:['全部学部','All divisions'], schoolwide:['全校','School-wide'], primary:['小学部','Primary'], middle:['初中部','Middle'], high:['高中部','High'], noDayEvents:['当天没有符合条件的事件','No matching events on this day'], searchPlaceholder:['搜索事件','Search events'], previous:['上个月','Previous month'], next:['下个月','Next month'], closeDay:['关闭当天事件','Close day events'], personal:['个人','Personal'], personalEvents:['个人事件','Personal events'], addPersonal:['添加个人事件','Add personal event'], grades:['年级','Grades']
};
const types = {
  exam:{label:['考试','Exams'],color:'var(--exam)'}, competition:{label:['比赛','Competitions'],color:'var(--competition)'}, activity:{label:['活动','Activities'],color:'var(--activity)'}, deadline:{label:['截止日','Deadlines'],color:'var(--deadline)'}
};
const divisions = ['primary','middle','high'];
const state = {lang:Number(localStorage.getItem('exam-language')||0),year:new Date().getFullYear(),month:new Date().getMonth(),divisions:new Set(),hiddenGrades:new Set(),personal:true,types:new Set(Object.keys(types)),query:'',view:'month',anchor:'',selected:null,day:'',sheet:null};
const mobileQuery = matchMedia('(max-width:760px)');
/** Events as published: a repeating event appears once, with its 重复规则. */
/** @type {SchoolEvent[]} */
const series = [];
/** What the calendar draws: plain events plus each repeating event's dates in the visible range. */
/** @type {SchoolEvent[]} */
const events = [];
/** Set once recurrence.mjs loads: expands series between two dates, and summarises a rule. */
let expandSeries=(list,from,to)=>list;
let repeatSummary=rule=>'';
let detailReturnDay=null;
let detailScrollY=0;
/** Event rows a month cell fits under its date line. */
let monthSlots=5;
/** Event rows in a week that also shows a borrowed-timetable band (按周五课表) under the dates. */
let bandSlots=4;
/** Set once grades.mjs loads: which grades a division covers and how an audience reads. */
let gradeTools=null;
/** Whether the visitor is signed in and so may keep 个人事件. */
let personalEnabled=false;
/** The signed-in visitor's own 个人事件 as stored, for editing. */
/** @type {any[]} */
let personalSeries=[];
let resolveDayPlan=iso=>null;
function dayPlan(iso){return resolveDayPlan(iso);}
function dayBadge(plan){return plan?`<span class="day-badge ${plan.kind}">${plan.kind==='off'?(state.lang?'Off':'休'):plan.kind==='half'?(state.lang?'Half day':'上半天'):(state.lang?'All day class':'上全天')}</span>`:'';}
function followsName(plan){const day=plan?.follows&&[['周一','Monday'],['周二','Tuesday'],['周三','Wednesday'],['周四','Thursday'],['周五','Friday']][plan.follows-1];return day?(state.lang?`${day[1]} schedule`:`按${day[0]}课表`):'';}
function dayPlanTitle(plan){
  const title=text(plan.title);
  if(title||plan.follows)return title;
  return plan.kind==='off'?(state.lang?'School holiday':'学校放假'):plan.kind==='half'?(state.lang?'Half day':'上半天'):(state.lang?'Full school day':'全天上课');
}
function dayPlanName(plan){return plan?[dayPlanTitle(plan),followsName(plan)].filter(Boolean).join(' · '):'';}
/** A borrowed timetable sets the whole name on a highlighted band so students notice it. */
function dayPlanMarkup(plan){return plan?.follows?`<span class="day-follows">${esc(dayPlanName(plan))}</span>`:esc(dayPlanName(plan));}

function t(key){return copy[key]?.[state.lang] ?? key;}
function text(pair){return pair?.[state.lang] || pair?.find(value=>value?.trim()) || '';}
function esc(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function dateValue(iso){return new Date(iso+'T12:00:00');}
function isoDate(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function formatDate(iso,weekday=false){return new Intl.DateTimeFormat(state.lang?'en-GB':'zh-CN',{month:state.lang?'short':'long',day:'numeric',year:'numeric',...(weekday?{weekday:'long'}:{})}).format(dateValue(iso));}
function isMulti(event){return event.end && event.end!==event.start;}
/** Grades the division filter shows: every grade of each ticked division that has not been unticked. */
function shownGrades(){return gradeTools?[...state.divisions].flatMap(d=>gradeTools.DIVISION_GRADES[d]).filter(g=>!state.hiddenGrades.has(g)):[];}
/** No ticked division shows everything; school-wide events and 个人事件 always pass. */
function audienceMatches(event){
  if(!state.divisions.size||event.personal||event.scope.includes('schoolwide'))return true;
  if(!gradeTools)return event.scope.some(s=>state.divisions.has(s));
  const shown=shownGrades();
  return gradeTools.audienceGrades(event.scope,event.grades).some(g=>shown.includes(g));
}
function matches(event){return event.status!=='draft' && state.types.has(event.type) && (!event.personal||state.personal) && audienceMatches(event) && (state.view!=='list'||!state.query||event.title.join(' ').toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));}
function onDate(event,iso){return event.start<=iso && (event.end||event.start)>=iso;}
function sortEvents(a,b){return (isMulti(a)?0:1)-(isMulti(b)?0:1) || (a.time||'00:00').localeCompare(b.time||'00:00') || a.id.localeCompare(b.id);}
function timeText(event){if(!event.time)return event.type==='deadline'?t('till')+' · '+t('allDay'):t('allDay');return (event.type==='deadline'?t('till')+' ':'')+event.time+(event.endTime?'–'+event.endTime:'');}
function scopeParts(event){return event.personal?[t('personal')]:gradeTools?gradeTools.audienceParts(event.scope,event.grades,t,state.lang):event.scope.map(t);}
function scopeText(event){return scopeParts(event).join(state.lang?' / ':'、');}
function cancelText(event){return t(event.cancelledOnce?'cancelledOnce':'cancelled');}
function label(event){return `${text(event.title)} · ${formatDate(event.start)} · ${timeText(event)}`;}
function eventLabelText(event){return `${event.cancelled?cancelText(event)+' · ':''}${event.oldDate?t('changed')+' · ':''}${event.type==='deadline'&&event.time?t('till')+' ':''}${event.time?event.time+' ':''}${text(event.title)}`;}
function eventButton(event){return `<button class="event ${event.type}${event.personal?' personal':''}${event.cancelled?' cancelled':''}${state.selected===event.id?' selected':''}" data-event="${event.id}" title="${esc(label(event))}" aria-label="${esc(label(event))}"><span class="dot"></span><span class="event-text">${event.cancelled?esc(cancelText(event))+' · ':''}${event.oldDate?esc(t('changed'))+' · ':''}${event.type==='deadline'&&event.time?esc(t('till'))+' ':''}${event.time?`<time>${event.time}</time> `:''}${esc(text(event.title))}</span></button>`;}
function agendaButton(event){return `<button class="agenda-event ${event.type}${event.personal?' personal':''}${event.cancelled?' cancelled':''}${state.selected===event.id?' selected':''}" data-event="${event.id}"><span class="dot"></span><span><strong>${event.cancelled?esc(cancelText(event))+' · ':''}${event.oldDate?esc(t('changed'))+' · ':''}${esc(text(event.title))}</strong><small>${esc(timeText(event))} · ${esc(scopeText(event))}${event.location?' · '+esc(text(event.location)):''}</small></span></button>`;}
function toggleDivision(division){
  if(state.divisions.has(division)){state.divisions.delete(division);gradeTools?.DIVISION_GRADES[division].forEach(g=>state.hiddenGrades.delete(g));}
  else state.divisions.add(division);
  state.selected=null;render();
}
function toggleGrade(grade){state.hiddenGrades.has(grade)?state.hiddenGrades.delete(grade):state.hiddenGrades.add(grade);state.selected=null;render();}
function togglePersonal(){state.personal=!state.personal;state.selected=null;render();}
function toggleType(type){state.types.has(type)?state.types.delete(type):state.types.add(type);state.selected=null;render();}
function resetFilters(){state.divisions=new Set();state.hiddenGrades=new Set();state.personal=true;state.types=new Set(Object.keys(types));state.query='';$('#search').value='';state.selected=null;render();}
function renderFilters(){
  // 适用学部: tick any divisions; each ticked division lists its grades, all ticked until a student unticks one.
  const gradesOf=d=>gradeTools?.DIVISION_GRADES[d]||[];
  const gradeName=g=>gradeTools?gradeTools.gradeLabel(g,state.lang):String(g);
  $('#school-filter').innerHTML=divisions.map(d=>`<label class="type-option division-option"><input type="checkbox" data-division="${d}" ${state.divisions.has(d)?'checked':''}>${esc(t(d))}</label>${state.divisions.has(d)?`<div class="grade-options" role="group" aria-label="${esc(t(d))} · ${esc(t('grades'))}">${gradesOf(d).map(g=>`<label class="type-option grade-option"><input type="checkbox" data-grade="${g}" ${state.hiddenGrades.has(g)?'':'checked'}>${esc(gradeName(g))}</label>`).join('')}</div>`:''}`).join('')+`<p class="filter-note">${esc(t('scopeNote'))}</p>`;
  $('#school-tabs').innerHTML='';
  $('#inline-divisions').innerHTML=divisions.map(d=>`<button class="division-chip" data-division="${d}" aria-pressed="${state.divisions.has(d)}">${esc(t(d))}</button>${state.divisions.has(d)?gradesOf(d).map(g=>`<button class="grade-chip" data-grade="${g}" aria-pressed="${!state.hiddenGrades.has(g)}">${esc(gradeName(g))}</button>`).join(''):''}`).join('');
  const personalOption=personalEnabled?`<label class="type-option personal-option"><input type="checkbox" data-personal-filter ${state.personal?'checked':''}>${esc(t('personalEvents'))}</label>`:'';
  $('#type-filter').innerHTML=Object.entries(types).map(([key,value])=>`<label class="type-option" style="--type-color:${value.color}"><input type="checkbox" data-type="${key}" ${state.types.has(key)?'checked':''}>${esc(text(value.label))}</label>`).join('')+personalOption;
  $('#inline-types').innerHTML=Object.entries(types).map(([key,value])=>`<button class="type-chip ${key}" data-type="${key}" aria-pressed="${state.types.has(key)}"><span class="dot"></span>${esc(text(value.label))}</button>`).join('')+(personalEnabled?`<button class="type-chip personal" data-personal-filter aria-pressed="${state.personal}"><span class="dot"></span>${esc(t('personalEvents'))}</button>`:'');
  $('#add-personal').hidden=!personalEnabled;$('#add-personal').title=t('addPersonal');$('#add-personal').setAttribute('aria-label',t('addPersonal'));$('#add-personal .add-personal-label').textContent=t('addPersonal');
  // Phones gather the filters into a sheet; its button counts the types turned off and the divisions chosen.
  const filtersOn=Object.keys(types).length-state.types.size+(personalEnabled&&!state.personal?1:0)+state.divisions.size;
  $('#mobile-filter').innerHTML=`${icons.filter}<span>${esc(state.lang?'Filter':'筛选')}${filtersOn?' · '+filtersOn:''}</span>`;
  $('#mobile-filter').dataset.active=String(filtersOn>0);
  const bind=(selector,action)=>$$(selector).forEach(b=>b.tagName==='INPUT'?b.onchange=()=>action(b):b.onclick=()=>action(b));
  bind('[data-division]',b=>toggleDivision(b.dataset.division));
  bind('[data-grade]',b=>toggleGrade(Number(b.dataset.grade)));
  bind("[data-personal-filter]",()=>togglePersonal());
  bind('[data-type]',b=>toggleType(b.dataset.type));
}
function bindEvents(root){root.querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>selectEvent(b.dataset.event));}
function syncDetailMode(){const modal=mobileQuery.matches&&document.body.classList.contains('mobile-detail');$$('.app-header,.school-tabs,.sidebar,.main-calendar').forEach(el=>el.inert=modal);if(modal){$('#details').setAttribute('role','dialog');$('#details').setAttribute('aria-modal','true');}else{$('#details').removeAttribute('role');$('#details').removeAttribute('aria-modal');}}
function selectEvent(id){detailReturnDay=$('#day-dialog').open?$('#day-dialog').dataset.date:null;detailScrollY=window.scrollY;state.selected=id;document.body.classList.remove('detail-closed');document.body.classList.add('mobile-detail');$('#day-dialog').close();renderCalendar();renderDetail();syncDetailMode();if(mobileQuery.matches)$('#close-detail')?.focus();}
function shiftDate(iso,days){const date=dateValue(iso);date.setDate(date.getDate()+days);return isoDate(date);}
/** The dates on screen: the whole month grid, or the week around the anchor. */
function visibleRange(){
  if(state.view==='week'){const monday=shiftDate(state.anchor||schoolToday(),-(dateValue(state.anchor||schoolToday()).getDay()+6)%7);return [monday,shiftDate(monday,6)];}
  const first=new Date(state.year,state.month,1,12);
  return [isoDate(new Date(state.year,state.month,1-(first.getDay()+6)%7,12)),isoDate(new Date(state.year,state.month+1,7,12))];
}
function refreshOccurrences(){const [from,to]=visibleRange();events.splice(0,events.length,...expandSeries(series,from,to));}
// Shows an event's month and opens its details; used by ?event=<id>[&date=<date>] links from subscriptions and the assistant.
// Without a date, a repeating event opens on its next date.
function calendarFocus(id,date){
  const item=series.find(e=>e.id===id);if(!item)return false;
  let target=item;
  if(item.repeat){
    const from=date?shiftDate(date,-366):schoolToday(),dates=expandSeries([item],from,shiftDate(date||from,366));
    target=date?dates.find(e=>e.occurrence===date):dates.find(e=>!e.cancelled)||dates[0];
    if(!target)return false;
  }
  resetFilters();const [year,month]=target.start.split('-').map(Number);state.year=year;state.month=month-1;state.day=target.start;
  render();selectEvent(target.id);return true;
}
window.calendarFocus=calendarFocus;
// Titles wrap onto up to three lines when the cell has free rows below them; every event keeps at least one row.
let measureContext=null;
function linesWanted(event,width){
  if(width<=0)return 1;
  measureContext??=document.createElement('canvas').getContext('2d');
  measureContext.font=`12px ${getComputedStyle(document.body).fontFamily}`;
  return Math.min(3,Math.max(1,Math.ceil(measureContext.measureText(eventLabelText(event)).width/width)));
}
/** Gives each event a starting row and how many consecutive free rows it may fill. */
function wrapRows(items,rows){
  const width=($('#month-grid').clientWidth/7)-24;
  const blocks=[];let next=0;
  items.forEach((event,index)=>{
    const want=linesWanted(event,width),row=rows[next++];let span=1;
    // Extend only into the next free row, and only while every later event still has a row of its own.
    while(span<want&&next<rows.length&&rows[next]===row+span&&rows.length-next>items.length-index-1){span++;next++;}
    blocks.push({row,span});
  });
  return blocks;
}
function renderCalendar(){
  $('#agenda-search').hidden=state.view!=='list';
  document.body.classList.toggle('week-mode',state.view==='week');document.body.dataset.view=state.view;
  $('#week-board').hidden=state.view!=='week';
  $('#month-title').removeAttribute('title');
  $('#week-view').setAttribute('aria-pressed',String(state.view==='week'));
  $('#previous').setAttribute('aria-label',state.view==='week'?(state.lang?'Previous week':'上一周'):t('previous'));
  $('#next').setAttribute('aria-label',state.view==='week'?(state.lang?'Next week':'下一周'):t('next'));
  refreshOccurrences();
  $('#mobile-month').hidden=$('#day-panel').hidden=state.view!=='month';
  if(state.view==='week'){renderWeek();return;}

  const first = new Date(state.year,state.month,1,12);const last = new Date(state.year,state.month+1,0,12);
  const offset=(first.getDay()+6)%7;const count=Math.ceil((offset+last.getDate())/7)*7;
  const start=new Date(state.year,state.month,1-offset,12);
  const monthStart=isoDate(first),monthEnd=isoDate(last);
  // Padding days from the neighbouring months stay empty: events show only in their own month.
  const shownOn=(e,iso)=>iso>=monthStart&&iso<=monthEnd&&onDate(e,iso);
  const monthEvents=events.filter(matches).filter(e=>e.start<=isoDate(last)&&(e.end||e.start)>=isoDate(first));
  $('#month-title').textContent=new Intl.DateTimeFormat(state.lang?'en-GB':'zh-CN',{year:'numeric',month:'long'}).format(first);
  $('#weekdays').innerHTML=(state.lang?['MON','TUE','WED','THU','FRI','SAT','SUN']:['周一','周二','周三','周四','周五','周六','周日']).map(d=>`<span>${d}</span>`).join('');
  $('#month-grid').style.setProperty('--week-count',String(count/7));
  let html='';
  for(let w=0;w<count/7;w++){
    const dates=Array.from({length:7},(_,i)=>new Date(state.year,state.month,1-offset+w*7+i,12));
    const weekStart=isoDate(dates[0]),weekEnd=isoDate(dates[6]);
    const shownStart=weekStart<monthStart?monthStart:weekStart,shownEnd=weekEnd>monthEnd?monthEnd:weekEnd;
    const multi=events.filter(matches).filter(isMulti).filter(e=>e.start<=shownEnd&&e.end>=shownStart).sort((a,b)=>a.start.localeCompare(b.start)||b.end.localeCompare(a.end));
    // A day's name (e.g. 国庆假期) sits on the date line. A borrowed timetable (按周五课表) takes a band under it;
    // with cross-day bars every date in that week keeps the band's line so the bars stay level.
    const plans=dates.map(date=>dayPlan(isoDate(date)));
    const weekHasBand=plans.some(plan=>plan?.follows),bandRow=i=>Boolean(plans[i]?.follows)||(weekHasBand&&multi.length>0);
    const weekSlots=weekHasBand?bandSlots:monthSlots;
    const lanes=[];const occupied=Array.from({length:7},()=>new Set());
    const placements=multi.map(e=>{
      const from=Math.max(0,dates.findIndex(d=>isoDate(d)>=(e.start>shownStart?e.start:shownStart)));
      let to=dates.findIndex(d=>isoDate(d)>(e.end<shownEnd?e.end:shownEnd));if(to<0)to=7;
      let lane=lanes.findIndex(end=>end<=from);if(lane<0)lane=lanes.length;lanes[lane]=to;
      return {event:e,from,to,lane};
    });
    const hiddenMulti=placements.filter(p=>p.lane>=weekSlots).map(p=>p.event);
    const dailyCounts=dates.map(date=>events.filter(matches).filter(e=>shownOn(e,isoDate(date))).length);
    // Reserve the final row for expansion only on dates that really have overflow.
    for(const p of placements){
      if(p.lane===weekSlots-1&&dates.slice(p.from,p.to).some((date,index)=>dailyCounts[p.from+index]>weekSlots||hiddenMulti.some(e=>shownOn(e,isoDate(date)))))hiddenMulti.push(p.event);
    }
    // An edge the event runs past, into the next row or the next month, stays square and open.
    const continuesLeft=e=>e.start<shownStart,continuesRight=e=>e.end>shownEnd;
    const spanButton=(e,from,to,row,left,right)=>`<button class="span-event ${e.type}${e.cancelled?' cancelled':''}${state.selected===e.id?' selected':''}${left?' continues-left':''}${right?' continues-right':''}" data-event="${e.id}" style="grid-column:${from+1}/${to+1};grid-row:${row+1}" aria-label="${esc(label(e))}" title="${esc(label(e))}">${e.cancelled?esc(cancelText(e))+' · ':''}${e.oldDate?esc(t('changed'))+' · ':''}${esc(text(e.title))} · ${esc(scopeText(e))}</button>`;
    let bars=placements.filter(p=>!hiddenMulti.includes(p.event)).map(({event:e,from,to,lane})=>{
      for(let column=from;column<to;column++)occupied[column].add(lane);
      return spanButton(e,from,to,lane,continuesLeft(e),continuesRight(e));
    }).join('');
    // A bar that cannot run the whole week still shows on the dates with a free row, as one piece per run of dates.
    const partial=placements.filter(p=>hiddenMulti.includes(p.event)).map(p=>({...p,rows:[]}));
    html+=`<div class="week${weekHasBand?' has-band':''}">`;
    for(let i=0;i<7;i++){
      const d=dates[i],iso=isoDate(d),plan=plans[i];const items=events.filter(matches).filter(e=>!isMulti(e)&&shownOn(e,iso)).sort(sortEvents);
      const daySlots=bandRow(i)?bandSlots:monthSlots;
      // A cross-day bar occupies only the dates it actually covers. Fill gaps on each date.
      const freeRows=Array.from({length:daySlots},(_,row)=>row).filter(row=>!occupied[i].has(row));
      const spans=partial.filter(p=>shownOn(p.event,iso));
      const needsMore=items.length+spans.length>freeRows.length;
      const eventRows=needsMore?freeRows.filter(row=>row<daySlots-1):freeRows;
      const shownSpans=spans.slice(0,eventRows.length);shownSpans.forEach((p,index)=>{p.rows[i]=eventRows[index];});
      const itemRows=eventRows.slice(shownSpans.length);
      const visibleItems=items.slice(0,itemRows.length);
      const hiddenCount=items.length-visibleItems.length+spans.length-shownSpans.length;
      const blocks=wrapRows(visibleItems,itemRows);
      const itemMarkup=visibleItems.map((event,index)=>`<div class="day-event-slot${blocks[index].span>1?' lines-'+blocks[index].span:''}" style="grid-row:${blocks[index].row+1}${blocks[index].span>1?' / span '+blocks[index].span:''}">${eventButton(event)}</div>`).join('');
      html+=`<div class="day${d.getMonth()!==state.month?' outside':''}${i>4?' weekend':''}${plan?' day-'+plan.kind:''}${iso===schoolToday()?' today':''}"><div class="day-date"><button class="day-number" data-day="${iso}" aria-label="${esc(formatDate(iso,true))}" ${iso===schoolToday()?'aria-current="date"':''}>${d.getDate()}</button><span class="day-plan-name" title="${plan?esc(dayPlanTitle(plan)):''}">${plan?esc(dayPlanTitle(plan)):''}</span>${dayBadge(plan)}</div>${bandRow(i)?`<div class="day-band">${plan?.follows?`<span class="day-follows">${esc(followsName(plan))}</span>`:''}</div>`:''}<div class="day-items">${itemMarkup}${hiddenCount>0?`<button class="more" data-day="${iso}" style="grid-row:${Math.max(1,daySlots)}">${state.lang?`+${hiddenCount} more`:`还有 ${hiddenCount} 项`}</button>`:''}</div></div>`;
    }
    for(const p of partial){
      for(let from=p.from;from<p.to;){
        const row=p.rows[from];let to=from+1;
        if(row===undefined){from++;continue;}
        while(to<p.to&&p.rows[to]===row)to++;
        bars+=spanButton(p.event,from,to,row,from>p.from||continuesLeft(p.event),to<p.to||continuesRight(p.event));
        from=to;
      }
    }
    html+=`<div class="spans">${bars}</div></div>`;
  }
  $('#month-grid').innerHTML=html;
  let agenda='';
  for(let day=1;day<=last.getDate();day++){
    const iso=isoDate(new Date(state.year,state.month,day,12));const items=monthEvents.filter(e=>onDate(e,iso)).sort(sortEvents);
    const plan=dayPlan(iso);
    if(!items.length&&!plan)continue;
    agenda+=`<section class="agenda-day${plan?' day-'+plan.kind:''}"><div class="agenda-date"><strong>${day}</strong><small>${new Intl.DateTimeFormat(state.lang?'en-GB':'zh-CN',{weekday:'short'}).format(dateValue(iso))}</small>${dayBadge(plan)}</div><div>${plan?`<p class="agenda-plan">${dayPlanMarkup(plan)}</p>`:''}${items.map(agendaButton).join('')}</div></section>`;
  }
  $('#agenda').innerHTML=agenda;
  $('#agenda').classList.toggle('is-empty',!agenda);
  $('#agenda').hidden=state.view==='month';$('#month-grid').hidden=state.view!=='month';$('#weekdays').hidden=state.view!=='month';
  // On phones the day panel says when a day is empty, so the month view needs no banner.
  $('#empty').hidden=!!agenda||(mobileQuery.matches&&state.view==='month');
  $('#result-count').textContent=state.lang?`${monthEvents.length} events this month`:`本月 ${monthEvents.length} 项事件`;
  $('#month-view').setAttribute('aria-pressed',String(state.view==='month'));$('#list-view').setAttribute('aria-pressed',String(state.view==='list'));
  bindEvents($('#main-calendar'));$$('[data-day]').forEach(b=>b.onclick=()=>openDay(b.dataset.day));
  if(mobileQuery.matches&&state.view==='month')renderMobileMonth();
  requestAnimationFrame(fitMonthDensity);
}
/** The day the phone's day panel lists: today when it falls in the shown month, otherwise the 1st. */
function defaultDay(){
  const today=schoolToday(),[year,month]=today.split('-').map(Number);
  return year===state.year&&month===state.month+1?today:isoDate(new Date(state.year,state.month,1,12));
}
// Phones: a borderless month grid — a date square, up to three dots per day and thin bars for multi-day
// events — above the selected day's events, which replace the day dialog.
function renderMobileMonth(){
  const first=new Date(state.year,state.month,1,12),last=new Date(state.year,state.month+1,0,12);
  const monthStart=isoDate(first),monthEnd=isoDate(last),today=schoolToday();
  if(!state.day||state.day<monthStart||state.day>monthEnd)state.day=defaultDay();
  const offset=(first.getDay()+6)%7,count=Math.ceil((offset+last.getDate())/7)*7;
  const shown=events.filter(matches);
  // A multi-day bar keeps one height across the month so it reads as one line from cell to cell.
  const lanes=[],laneOf=new Map();
  shown.filter(isMulti).filter(e=>e.start<=monthEnd&&e.end>=monthStart).sort((a,b)=>a.start.localeCompare(b.start)||b.end.localeCompare(a.end)||a.id.localeCompare(b.id)).forEach(e=>{
    let lane=lanes.findIndex(end=>end<e.start);if(lane<0)lane=lanes.length;lanes[lane]=e.end;laneOf.set(e,lane);
  });
  const weekdays=(state.lang?['M','T','W','T','F','S','S']:['一','二','三','四','五','六','日']).map((d,i)=>`<span${i>4?' class="weekend"':''}>${d}</span>`).join('');
  let cells='';
  for(let i=0;i<count;i++){
    const date=new Date(state.year,state.month,1-offset+i,12),iso=isoDate(date);
    if(iso<monthStart||iso>monthEnd){cells+=`<span class="mm-cell outside" aria-hidden="true"><span class="mm-date">${date.getDate()}</span></span>`;continue;}
    const plan=dayPlan(iso),singles=shown.filter(e=>!isMulti(e)&&onDate(e,iso)).sort(sortEvents),spans=shown.filter(e=>isMulti(e)&&onDate(e,iso));
    const bars=spans.filter(e=>laneOf.get(e)<2).map(e=>`<i class="mm-bar ${e.type}${e.cancelled?' cancelled':''}" style="bottom:${6+laneOf.get(e)*5}px;left:${iso===e.start?6:0}px;right:${iso===e.end?6:0}px"></i>`).join('');
    const more=singles.length>3||spans.some(e=>laneOf.get(e)>=2);
    const dots=singles.slice(0,3).map(e=>`<i class="dot ${e.type}${e.personal?' personal':''}${e.cancelled?' cancelled':''}"></i>`).join('')+(more?'<i class="mm-more">+</i>':'');
    const square=['mm-date',i%7>4?'weekend':'',plan&&plan.kind!=='school'?'plan-'+plan.kind:'',iso===today?'today':'',iso===state.day?'ticked':''].filter(Boolean).join(' ');
    const total=singles.length+spans.length;
    const name=formatDate(iso,true)+(plan?' · '+dayPlanName(plan):'')+(total?(state.lang?` · ${total} events`:` · ${total} 项事件`):'');
    cells+=`<button type="button" class="mm-cell" data-pick="${iso}" aria-pressed="${iso===state.day}" aria-label="${esc(name)}"${iso===today?' aria-current="date"':''}><span class="${square}">${date.getDate()}</span><span class="mm-dots">${dots}</span>${bars}</button>`;
  }
  $('#mobile-month').innerHTML=`<div class="mm-weekdays" aria-hidden="true">${weekdays}</div><div class="mm-grid">${cells}</div>`;
  $$('#mobile-month [data-pick]').forEach(b=>b.onclick=()=>selectDay(b.dataset.pick));
  renderDayPanel();
}
function selectDay(iso){
  state.day=iso;renderMobileMonth();
  $(`#mobile-month [data-pick="${iso}"]`)?.focus();$('#day-panel').scrollTop=0;
}
function renderDayPanel(){
  const iso=state.day,plan=dayPlan(iso),date=dateValue(iso);
  const items=events.filter(matches).filter(e=>onDate(e,iso)).sort(sortEvents);
  const heading=state.lang?new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short'}).format(date):`${date.getMonth()+1}月${date.getDate()}日 ${new Intl.DateTimeFormat('zh-CN',{weekday:'short'}).format(date)}`;
  // The left column: the start time, the span of a multi-day event, or 全天.
  const when=e=>{
    if(!isMulti(e))return e.time||t('allDay');
    const [,sm,sd]=e.start.split('-').map(Number),[,em,ed]=e.end.split('-').map(Number);
    return sm===em?(state.lang?`${sd}–${ed}`:`${sd}–${ed}日`):`${sm}/${sd}–${em}/${ed}`;
  };
  const rows=items.map(e=>`<button type="button" class="day-row ${e.type}${e.personal?' personal':''}${e.cancelled?' cancelled':''}" data-event="${esc(e.id)}"><span class="day-row-time num">${esc(when(e))}</span><span class="day-row-main"><span class="day-row-title"><span class="dot"></span><strong>${e.cancelled?esc(cancelText(e))+' · ':''}${e.oldDate?esc(t('changed'))+' · ':''}${esc(text(e.title))}</strong></span><small>${[timeText(e),scopeText(e),text(e.location)].filter(Boolean).map(esc).join(' · ')}</small></span></button>`).join('');
  $('#day-panel').innerHTML=`<div class="day-panel-head"><h3>${esc(heading)}</h3>${plan?`<span class="tag plan-${plan.kind}">${esc(dayPlanName(plan))}</span>`:''}</div>${rows||`<p class="day-panel-empty">${esc(t('noDayEvents'))}</p>`}${personalEnabled?`<button type="button" class="day-add-personal" data-add-on="${iso}">+ ${esc(state.lang?'Add a personal event on this day':'在这天添加个人事件')}</button>`:''}`;
  bindEvents($('#day-panel'));
  const add=$('#day-panel [data-add-on]');if(add)add.onclick=()=>openPersonalEditor({date:iso});
}
const corners='<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
const icons={
  filter:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/></svg>',
  subscribe:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4"/></svg>',
  close:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
};
/** Phone sheets: 'filter' (适用学部 and 事件类型) or 'menu' (subscribe and language). */
function openSheet(kind){state.sheet=kind;renderSheet();const sheet=$('#calendar-sheet');if(!sheet.open)sheet.showModal();}
function renderSheet(){
  const sheet=$('#calendar-sheet');if(!state.sheet)return;
  const focused=document.activeElement?.closest?.('#calendar-sheet [data-key]')?.getAttribute('data-key');
  sheet.className='sheet'+(state.sheet==='menu'?' menu':'');
  sheet.setAttribute('aria-label',state.sheet==='menu'?(state.lang?'More':'更多'):(state.lang?'Filter':'筛选'));
  if(state.sheet==='menu'){
    sheet.innerHTML=`<button type="button" class="menu-row" data-key="subscribe" data-menu="subscribe">${icons.subscribe}<span class="menu-text">${esc(state.lang?'Subscribe to the calendar':'订阅校历')}</span></button><button type="button" class="menu-row" data-key="language" data-menu="language"><span class="lang-mark">${state.lang?'中':'EN'}</span><span class="menu-text">${state.lang?'切换为中文':'Switch to English'}</span></button>`;
  }else{
    const first=isoDate(new Date(state.year,state.month,1,12)),last=isoDate(new Date(state.year,state.month+1,0,12));
    const count=events.filter(matches).filter(e=>e.start<=last&&(e.end||e.start)>=first).length;
    const gradeName=g=>gradeTools?gradeTools.gradeLabel(g,state.lang):String(g);
    const grades=[...state.divisions].map(d=>gradeTools?.DIVISION_GRADES[d]?.length?`<div class="sheet-chips" role="group" aria-label="${esc(t(d))} · ${esc(t('grades'))}">${gradeTools.DIVISION_GRADES[d].map(g=>`<button type="button" class="chip sub" data-key="grade-${g}" data-sheet-grade="${g}" aria-pressed="${!state.hiddenGrades.has(g)}">${esc(gradeName(g))}</button>`).join('')}</div>`:'').join('');
    sheet.innerHTML=`<div class="sheet-head"><h3>${esc(state.lang?'Filter':'筛选')}</h3><button type="button" class="btn btn-ghost" data-key="reset" data-sheet-reset>${esc(t('reset'))}</button></div>
      <div class="sheet-section"><h6 class="m-h6">${esc(t('scope'))}</h6><div class="sheet-chips">${divisions.map(d=>`<button type="button" class="chip" data-key="division-${d}" data-sheet-division="${d}" aria-pressed="${state.divisions.has(d)}">${esc(t(d))}</button>`).join('')}</div>${grades}<p class="sheet-note">${esc(t('scopeNote'))}</p></div>
      <div class="sheet-section"><h6 class="m-h6">${esc(t('types'))}</h6><div class="sheet-chips">${Object.entries(types).map(([key,value])=>`<button type="button" class="chip type-toggle ${key}" data-key="type-${key}" data-sheet-type="${key}" aria-pressed="${state.types.has(key)}"><span class="dot"></span>${esc(text(value.label))}</button>`).join('')}${personalEnabled?`<button type="button" class="chip type-toggle personal" data-key="personal" data-sheet-personal aria-pressed="${state.personal}"><span class="dot"></span>${esc(t('personalEvents'))}</button>`:''}</div></div>
      <button type="button" class="btn btn-primary blueprint" data-key="done" data-sheet-done>${corners}${esc(state.lang?`Show ${count} events`:`显示 ${count} 项事件`)}</button>`;
  }
  const on=(selector,action)=>sheet.querySelectorAll(selector).forEach(b=>b.onclick=()=>action(b));
  on('[data-sheet-division]',b=>toggleDivision(b.dataset.sheetDivision));
  on('[data-sheet-grade]',b=>toggleGrade(Number(b.dataset.sheetGrade)));
  on('[data-sheet-type]',b=>toggleType(b.dataset.sheetType));
  on('[data-sheet-personal]',()=>togglePersonal());
  on('[data-sheet-reset]',()=>resetFilters());
  on('[data-sheet-done]',()=>sheet.close());
  on('[data-menu=subscribe]',()=>{sheet.close();/** @type {any} */(window).siteHeader?.openFeed('calendar');});
  on('[data-menu=language]',()=>{sheet.close();$('#language').click();});
  if(focused)sheet.querySelector(`[data-key="${focused}"]`)?.focus();
}
function renderDetail(){
  const event=events.find(e=>e.id===state.selected);
  // Without a selected event the panel closes instead of showing an empty placeholder.
  if(!event&&!document.body.classList.contains('detail-closed')){document.body.classList.remove('mobile-detail');document.body.classList.add('detail-closed');syncDetailMode();}
  $('#details').innerHTML=`<div class="detail-top"><span class="overline">${esc(t('detail'))}</span><button id="close-detail" class="close-button" aria-label="${esc(t('close'))}"><span class="glyph" aria-hidden="true">×</span>${icons.close}</button></div>`+(event?eventDetails(event):`<p class="no-detail">${esc(t('chooseEvent'))}</p>`);
  bindClose();bindDetailActions($('#details'));
}

function bindClose(){$('#close-detail').onclick=()=>{document.body.classList.remove('mobile-detail');document.body.classList.add('detail-closed');syncDetailMode();const selectedId=state.selected;state.selected=null;renderCalendar();const target=$$(`[data-event="${selectedId}"]`).find(el=>el.getClientRects().length);const fallback=detailReturnDay?$$(`[data-day="${detailReturnDay}"]`).find(el=>el.getClientRects().length):null;(target||fallback)?.focus({preventScroll:true});window.scrollTo(0,detailScrollY);};}
function openDay(iso){
  // Phones list a day under the month grid instead of in a dialog.
  if(mobileQuery.matches){const [year,month]=iso.split('-').map(Number);state.year=year;state.month=month-1;state.day=iso;state.anchor=iso;state.view='month';renderCalendar();return;}
  $('#day-dialog').className=dayPlan(iso)?'day-'+dayPlan(iso).kind:'';$('#day-dialog').dataset.date=iso;$('#day-title').textContent=formatDate(iso,true)+(dayPlan(iso)?' · '+dayPlanName(dayPlan(iso)):'');const items=events.filter(matches).filter(e=>onDate(e,iso)).sort(sortEvents);$('#day-events').innerHTML=dayBadge(dayPlan(iso))+(items.length?items.map(agendaButton).join(''):`<p>${esc(t('noDayEvents'))}</p>`)+(personalEnabled?`<button class="day-add-personal" data-add-on="${iso}">+ ${esc(state.lang?'Add a personal event on this day':'在这天添加个人事件')}</button>`:'');bindEvents($('#day-events'));const add=$('#day-events [data-add-on]');if(add)add.onclick=()=>{$('#day-dialog').close();openPersonalEditor({date:iso});};$('#day-dialog').showModal();}
function render(){
  document.documentElement.lang=state.lang?'en':'zh-CN';document.title=state.lang?'Keydion Calendar - School calendar':'Keydion日历 - 校历';$$('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));
  $('#language').textContent=state.lang?'中文':'EN';$('#language').setAttribute('aria-label',state.lang?'切换为中文':'Switch to English');
  $('#search').placeholder=t('searchPlaceholder');$('#search').setAttribute('aria-label',t('searchPlaceholder'));
  $('#previous').setAttribute('aria-label',t('previous'));$('#next').setAttribute('aria-label',t('next'));$('#details').setAttribute('aria-label',t('detail'));$('#close-day').setAttribute('aria-label',t('closeDay'));$('#close-registration').setAttribute('aria-label',state.lang?'Close':'关闭');
  $('#day-legend').innerHTML=`<span class="legend-weekday">${state.lang?'Weekday':'工作日'}</span><span class="legend-weekend">${state.lang?'Weekend':'周末'}</span><span class="legend-half">${state.lang?'Half day':'上半天'}</span><span class="legend-off">${state.lang?'Holiday':'放假'}</span><span>${dayBadge({kind:'school'})} ${state.lang?'Full school day':'全天上课'}</span>`;
  renderFilters();renderCalendar();renderDetail();renderSheet();
  document.dispatchEvent(new CustomEvent('calendar-language'));
}
$('#search').oninput=e=>{state.query=e.target.value;state.selected=null;renderCalendar();renderDetail();};
$('#language').onclick=()=>{state.lang=1-state.lang;localStorage.setItem('exam-language',String(state.lang));render();};
$$('.reset').forEach(b=>b.onclick=resetFilters);
function changeView(view){state.view=view;renderCalendar();}
$('#month-view').onclick=()=>changeView('month');$('#list-view').onclick=()=>changeView('list');$('#week-view').onclick=()=>{
  if(!state.anchor){const today=dateValue(schoolToday());state.anchor=isoDate(new Date(state.year,state.month,today.getFullYear()===state.year&&today.getMonth()===state.month?today.getDate():1,12));}
  changeView('week');
};
function moveMonth(delta){const date=state.view==='week'?dateValue(state.anchor):new Date(state.year,state.month+delta,1,12);if(state.view==='week')date.setDate(date.getDate()+delta*7);state.anchor=state.view==='week'?isoDate(date):'';state.year=date.getFullYear();state.month=date.getMonth();state.day='';state.selected=null;renderCalendar();renderDetail();}
$('#previous').onclick=()=>moveMonth(-1);$('#next').onclick=()=>moveMonth(1);$('#today').onclick=()=>{state.anchor=schoolToday();const current=state.anchor.split('-').map(Number);state.year=current[0];state.month=current[1]-1;state.day=state.anchor;state.selected=null;render();};
$('#close-day').onclick=()=>$('#day-dialog').close();$('#close-registration').onclick=()=>$('#registration-dialog').close();$('#registration-ok').onclick=()=>$('#registration-dialog').close();
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('dialog[open]')&&document.body.classList.contains('mobile-detail'))$('#close-detail')?.click();});
document.addEventListener('keydown',e=>{if(e.key!=='Tab'||!mobileQuery.matches||!document.body.classList.contains('mobile-detail')||$('dialog[open]'))return;const buttons=[...$('#details').querySelectorAll('button,a[href]')].filter(el=>el.getClientRects().length);const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}});
mobileQuery.addEventListener('change',()=>{syncDetailMode();renderCalendar();});
$('#mobile-filter').onclick=()=>openSheet('filter');
window.addEventListener('site-menu',()=>openSheet('menu'));
$('#calendar-sheet').addEventListener('close',()=>{state.sheet=null;});
// Tapping the backdrop (outside the sheet's box) closes it.
$('#calendar-sheet').addEventListener('click',e=>{const box=e.currentTarget.getBoundingClientRect();if(e.clientY<box.top||e.clientY>box.bottom||e.clientX<box.left||e.clientX>box.right)e.currentTarget.close();});
render();

$('#close-media').onclick=()=>$('#media-dialog').close();
$('#retry-load').onclick=()=>{$('#retry-load').hidden=true;startCalendar();};

// Fit visible event rows to the available week height; overflow remains in the day dialog.
function fitMonthDensity(){
  const grid=$('#month-grid');
  if(mobileQuery.matches||!grid.getClientRects().length)return;
  const weeks=grid.querySelectorAll('.week').length;
  if(!weeks)return;
  // A row is 20px plus a 3px gap, and the last row needs no gap. Above the rows sit the cell's 4px top padding,
  // the 25px date line, the 19px timetable band (band weeks only) and 2px padding; below them the 1px border.
  const height=grid.clientHeight/weeks,slots=Math.max(0,Math.floor((height-29)/23)),band=Math.max(0,Math.floor((height-48)/23));
  if(slots!==monthSlots||band!==bandSlots){monthSlots=slots;bandSlots=band;renderCalendar();}
}
const monthSizeObserver=new ResizeObserver(fitMonthDensity);
monthSizeObserver.observe($('#month-grid'));
startCalendar();
