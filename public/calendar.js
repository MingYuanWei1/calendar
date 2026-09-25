'use strict';
document.body.className='airy';
/** @returns {any} */
const $ = selector => document.querySelector(selector);
/** @returns {any[]} */
const $$ = selector => [...document.querySelectorAll(selector)];
const copy = {
  brand:['日历','Calendar'], calendarNav:['校历','Calendar'], examsNav:['考试安排','Exams'],
  publicCalendar:['属于每一位同学的校园日程','A calendar for every student'], searchLabel:['搜索','Search'], september:['2026 年 9 月','September 2026'], autumn:['秋季学期','Autumn term'], scope:['适用学部','School division'], reset:['重置','Reset'], types:['事件类型','Event types'], scopeNote:['选择学部时，同时显示全校事件。','School-wide events are included in every division.'], publicNote:['公开校历 · 无需登录','Public calendar · No sign-in'], schoolLife:['校园生活 / SCHOOL LIFE','SCHOOL LIFE'], term:['2026—2027 学年 · 秋季学期','2026–2027 · Autumn term'], today:['今天','Today'], monthView:['月历','Month'], weekView:['周历','Week'], listView:['日程','Agenda'], emptyTitle:['没有符合条件的事件','No matching events'], emptyHelp:['试试其他关键词，或重置筛选。','Try another search or reset your filters.'], dayEvents:['当天事件','EVENTS ON THIS DAY'], registrationPreview:['报名入口示意','Registration preview'], registrationNotice:['正式发布时，此处打开管理员填写的外部报名表。当前设计稿未连接真实表单。','In the published calendar, this opens the external form provided by an administrator. This design is not connected to a real form.'], understood:['知道了','Got it'], detail:['事件详情','EVENT DETAILS'], close:['关闭详情','Close details'], when:['时间','When'], where:['地点','Where'], for:['适用','For'], host:['主办','Host'], about:['事件说明','About this event'], allDay:['全天','All day'], till:['截止','Due'], cancelled:['已取消','Cancelled'], changed:['已改期','Rescheduled'], registration:['查看报名表','Open registration form'], external:['通过外部表单报名，本平台仅展示信息。','Registration is handled by an external form.'], updated:['更新于 9 月 18 日 16:30','Updated 18 Sep, 16:30'], chooseEvent:['选择一项事件查看详情','Select an event to see the details'], missingLocation:['未设置地点','No location specified'], allSchools:['全部学部','All divisions'], schoolwide:['全校','School-wide'], primary:['小学部','Primary'], middle:['初中部','Middle'], high:['高中部','High'], noDayEvents:['当天没有符合条件的事件','No matching events on this day'], searchPlaceholder:['搜索事件','Search events'], previous:['上个月','Previous month'], next:['下个月','Next month'], closeDay:['关闭当天事件','Close day events']
};
const types = {
  exam:{label:['考试','Exams'],color:'var(--exam)'}, competition:{label:['比赛','Competitions'],color:'var(--competition)'}, activity:{label:['活动','Activities'],color:'var(--activity)'}, deadline:{label:['截止日','Deadlines'],color:'var(--deadline)'}
};
const schools = ['allSchools','primary','middle','high'];
const state = {lang:Number(localStorage.getItem('exam-language')||0),year:new Date().getFullYear(),month:new Date().getMonth(),school:'allSchools',types:new Set(Object.keys(types)),query:'',view:'month',anchor:'',selected:null};
const mobileQuery = matchMedia('(max-width:760px)');
/** @type {SchoolEvent[]} */
const events = [];
let detailReturnDay=null;
let detailScrollY=0;
let calendarSlots=4;
let resolveDayPlan=iso=>null;
function dayPlan(iso){return resolveDayPlan(iso);}
function dayBadge(plan){return plan?`<span class="day-badge ${plan.kind}">${plan.kind==='off'?(state.lang?'Off':'休'):plan.kind==='half'?(state.lang?'Half day':'上半天'):(state.lang?'Full day':'全天')}</span>`:'';}
function dayPlanName(plan){return plan?(text(plan.title)||(plan.kind==='off'?(state.lang?'School holiday':'学校放假'):plan.kind==='half'?(state.lang?'Half day':'上半天'):(state.lang?'Full school day':'全天上课'))):'';}

function t(key){return copy[key]?.[state.lang] ?? key;}
function text(pair){return pair?.[state.lang] || pair?.find(value=>value?.trim()) || '';}
function esc(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function dateValue(iso){return new Date(iso+'T12:00:00');}
function isoDate(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function formatDate(iso,weekday=false){return new Intl.DateTimeFormat(state.lang?'en-GB':'zh-CN',{month:state.lang?'short':'long',day:'numeric',year:'numeric',...(weekday?{weekday:'long'}:{})}).format(dateValue(iso));}
function isMulti(event){return event.end && event.end!==event.start;}
function matches(event){return event.status!=='draft' && state.types.has(event.type) && (state.school==='allSchools'||event.scope.includes('schoolwide')||event.scope.includes(state.school)) && (state.view!=='list'||!state.query||event.title.join(' ').toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));}
function onDate(event,iso){return event.start<=iso && (event.end||event.start)>=iso;}
function sortEvents(a,b){return (isMulti(a)?0:1)-(isMulti(b)?0:1) || (a.time||'00:00').localeCompare(b.time||'00:00') || a.id.localeCompare(b.id);}
function timeText(event){if(!event.time)return t('allDay');return (event.type==='deadline'?t('till')+' ':'')+event.time+(event.endTime?'–'+event.endTime:'');}
function scopeText(event){return event.scope.map(t).join(state.lang?' / ':'、');}
function label(event){return `${text(event.title)} · ${formatDate(event.start)} · ${timeText(event)}`;}
function eventButton(event){return `<button class="event ${event.type}${event.cancelled?' cancelled':''}${state.selected===event.id?' selected':''}" data-event="${event.id}" title="${esc(label(event))}" aria-label="${esc(label(event))}"><span class="dot"></span><span class="event-text">${event.cancelled?esc(t('cancelled'))+' · ':''}${event.oldDate?esc(t('changed'))+' · ':''}${event.type==='deadline'?esc(t('till'))+' ':''}${event.time?`<time>${event.time}</time> `:''}${esc(text(event.title))}</span></button>`;}
function agendaButton(event){return `<button class="agenda-event ${event.type}${event.cancelled?' cancelled':''}${state.selected===event.id?' selected':''}" data-event="${event.id}"><span class="dot"></span><span><strong>${event.cancelled?esc(t('cancelled'))+' · ':''}${event.oldDate?esc(t('changed'))+' · ':''}${esc(text(event.title))}</strong><small>${esc(timeText(event))} · ${esc(scopeText(event))}${event.location?' · '+esc(text(event.location)):''}</small></span></button>`;}
function setSchool(school){state.school=school;state.selected=null;render();}
function toggleType(type){state.types.has(type)?state.types.delete(type):state.types.add(type);state.selected=null;render();}
function resetFilters(){state.school='allSchools';state.types=new Set(Object.keys(types));state.query='';$('#search').value='';state.selected=null;render();}
function renderFilters(){
  $('#school-filter').innerHTML=schools.map(s=>`<button class="school-option" data-school="${s}" aria-pressed="${s===state.school}">${esc(t(s))}</button>`).join('');
  $('#school-tabs').innerHTML=schools.map(s=>`<button class="school-tab" data-school="${s}" aria-pressed="${s===state.school}">${esc(t(s))}</button>`).join('')+`<span class="tab-note">${esc(t('scopeNote'))}</span>`;
  $('#school-select').innerHTML=schools.map(s=>`<option value="${s}" ${s===state.school?'selected':''}>${esc(t(s))}</option>`).join('');
  $('#type-filter').innerHTML=Object.entries(types).map(([key,value])=>`<label class="type-option" style="--type-color:${value.color}"><input type="checkbox" data-type="${key}" ${state.types.has(key)?'checked':''}>${esc(text(value.label))}</label>`).join('');
  $('#inline-types').innerHTML=Object.entries(types).map(([key,value])=>`<button class="type-chip ${key}" data-type="${key}" aria-pressed="${state.types.has(key)}"><span class="dot"></span>${esc(text(value.label))}</button>`).join('');
  $$('[data-school]').forEach(b=>b.onclick=()=>setSchool(b.dataset.school));
  $$('[data-type]').forEach(b=>b.tagName==='INPUT'?b.onchange=()=>toggleType(b.dataset.type):b.onclick=()=>toggleType(b.dataset.type));
}
function bindEvents(root){root.querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>selectEvent(b.dataset.event));}
function syncDetailMode(){const modal=mobileQuery.matches&&document.body.classList.contains('mobile-detail');$$('.app-header,.school-tabs,.sidebar,.main-calendar').forEach(el=>el.inert=modal);if(modal){$('#details').setAttribute('role','dialog');$('#details').setAttribute('aria-modal','true');}else{$('#details').removeAttribute('role');$('#details').removeAttribute('aria-modal');}}
function selectEvent(id){detailReturnDay=$('#day-dialog').open?$('#day-dialog').dataset.date:null;detailScrollY=window.scrollY;state.selected=id;document.body.classList.remove('detail-closed');document.body.classList.add('mobile-detail');$('#day-dialog').close();renderCalendar();renderDetail();syncDetailMode();if(mobileQuery.matches)$('#close-detail')?.focus();}
function renderCalendar(){
  $('#agenda-search').hidden=state.view!=='list';
  document.body.classList.toggle('week-mode',state.view==='week');
  $('#week-board').hidden=state.view!=='week';
  $('#month-title').removeAttribute('title');
  $('#week-view').setAttribute('aria-pressed',String(state.view==='week'));
  $('#previous').setAttribute('aria-label',state.view==='week'?(state.lang?'Previous week':'上一周'):t('previous'));
  $('#next').setAttribute('aria-label',state.view==='week'?(state.lang?'Next week':'下一周'):t('next'));
  if(state.view==='week'){renderWeek();return;}

  const first = new Date(state.year,state.month,1,12);const last = new Date(state.year,state.month+1,0,12);
  const offset=(first.getDay()+6)%7;const count=Math.ceil((offset+last.getDate())/7)*7;
  const start=new Date(state.year,state.month,1-offset,12);
  const monthEvents=events.filter(matches).filter(e=>e.start<=isoDate(last)&&(e.end||e.start)>=isoDate(first));
  $('#month-title').textContent=new Intl.DateTimeFormat(state.lang?'en-GB':'zh-CN',{year:'numeric',month:'long'}).format(first);
  $('#weekdays').innerHTML=(state.lang?['MON','TUE','WED','THU','FRI','SAT','SUN']:['周一','周二','周三','周四','周五','周六','周日']).map(d=>`<span>${d}</span>`).join('');
  $('#month-grid').style.setProperty('--week-count',String(count/7));
  let html='';
  for(let w=0;w<count/7;w++){
    const dates=Array.from({length:7},(_,i)=>new Date(state.year,state.month,1-offset+w*7+i,12));
    const weekStart=isoDate(dates[0]),weekEnd=isoDate(dates[6]);
    const multi=events.filter(matches).filter(isMulti).filter(e=>e.start<=weekEnd&&e.end>=weekStart).sort((a,b)=>a.start.localeCompare(b.start)||b.end.localeCompare(a.end));
    const lanes=[];const occupied=Array.from({length:7},()=>new Set());
    const placements=multi.map(e=>{
      const from=Math.max(0,dates.findIndex(d=>isoDate(d)>=e.start));
      let to=dates.findIndex(d=>isoDate(d)>e.end);if(to<0)to=7;
      let lane=lanes.findIndex(end=>end<=from);if(lane<0)lane=lanes.length;lanes[lane]=to;
      return {event:e,from,to,lane};
    });
    const hiddenMulti=placements.filter(p=>p.lane>=calendarSlots).map(p=>p.event);
    const dailyCounts=dates.map(date=>events.filter(matches).filter(e=>onDate(e,isoDate(date))).length);
    // Reserve the final row for expansion only on dates that really have overflow.
    for(const p of placements){
      if(p.lane===calendarSlots-1&&dates.slice(p.from,p.to).some((date,index)=>dailyCounts[p.from+index]>calendarSlots||hiddenMulti.some(e=>onDate(e,isoDate(date)))))hiddenMulti.push(p.event);
    }
    const bars=placements.filter(p=>!hiddenMulti.includes(p.event)).map(({event:e,from,to,lane})=>{
      for(let column=from;column<to;column++)occupied[column].add(lane);
      return `<button class="span-event ${e.type}${e.cancelled?' cancelled':''}${state.selected===e.id?' selected':''}${e.start<weekStart?' continues-left':''}${e.end>weekEnd?' continues-right':''}" data-event="${e.id}" style="grid-column:${from+1}/${to+1};grid-row:${lane+1}" aria-label="${esc(label(e))}" title="${esc(label(e))}">${e.cancelled?esc(t('cancelled'))+' · ':''}${e.oldDate?esc(t('changed'))+' · ':''}${esc(text(e.title))} · ${esc(scopeText(e))}</button>`;
    }).join('');
    html+=`<div class="week">`;
    for(let i=0;i<7;i++){
      const d=dates[i],iso=isoDate(d),plan=dayPlan(iso);const items=events.filter(matches).filter(e=>!isMulti(e)&&onDate(e,iso)).sort(sortEvents);
      // A cross-day bar occupies only the dates it actually covers. Fill gaps on each date.
      const freeRows=Array.from({length:calendarSlots},(_,row)=>row).filter(row=>!occupied[i].has(row));
      const hiddenSpans=hiddenMulti.filter(e=>onDate(e,iso)).length;
      const needsMore=items.length>freeRows.length||hiddenSpans>0;
      const eventRows=needsMore?freeRows.filter(row=>row<calendarSlots-1):freeRows;
      const visibleItems=items.slice(0,eventRows.length);
      const hiddenCount=items.length-visibleItems.length+hiddenSpans;
      const itemMarkup=visibleItems.map((event,index)=>`<div class="day-event-slot" style="grid-row:${eventRows[index]+1}">${eventButton(event)}</div>`).join('');
      html+=`<div class="day${d.getMonth()!==state.month?' outside':''}${i>4?' weekend':''}${plan?' day-'+plan.kind:''}${iso===schoolToday()?' today':''}"><div class="day-date"><button class="day-number" data-day="${iso}" aria-label="${esc(formatDate(iso,true))}" ${iso===schoolToday()?'aria-current="date"':''}>${d.getDate()}</button>${dayBadge(plan)}</div><div class="day-plan-name" title="${esc(dayPlanName(plan))}">${esc(dayPlanName(plan))}</div><div class="day-items">${itemMarkup}${hiddenCount>0?`<button class="more" data-day="${iso}" style="grid-row:${Math.max(1,calendarSlots)}">${state.lang?`+${hiddenCount} more`:`还有 ${hiddenCount} 项`}</button>`:''}</div></div>`;
    }
    html+=`<div class="spans">${bars}</div></div>`;
  }
  $('#month-grid').innerHTML=html;
  let agenda='';
  for(let day=1;day<=last.getDate();day++){
    const iso=isoDate(new Date(state.year,state.month,day,12));const items=monthEvents.filter(e=>onDate(e,iso)).sort(sortEvents);
    const plan=dayPlan(iso);
    if(!items.length&&!plan)continue;
    agenda+=`<section class="agenda-day${plan?' day-'+plan.kind:''}"><div class="agenda-date"><strong>${day}</strong><small>${new Intl.DateTimeFormat(state.lang?'en-GB':'zh-CN',{weekday:'short'}).format(dateValue(iso))}</small>${dayBadge(plan)}</div><div>${plan?`<p class="agenda-plan">${esc(dayPlanName(plan))}</p>`:''}${items.map(agendaButton).join('')}</div></section>`;
  }
  $('#agenda').innerHTML=agenda;
  $('#agenda').classList.toggle('is-empty',!agenda);
  $('#agenda').hidden=state.view==='month';$('#month-grid').hidden=state.view!=='month';$('#weekdays').hidden=state.view!=='month';
  $('#empty').hidden=!!agenda;
  $('#result-count').textContent=state.lang?`${monthEvents.length} events this month`:`本月 ${monthEvents.length} 项事件`;
  $('#month-view').setAttribute('aria-pressed',String(state.view==='month'));$('#list-view').setAttribute('aria-pressed',String(state.view==='list'));
  bindEvents($('#main-calendar'));$$('[data-day]').forEach(b=>b.onclick=()=>openDay(b.dataset.day));
  requestAnimationFrame(fitMonthDensity);
}
function renderDetail(){
  const event=events.find(e=>e.id===state.selected);
  $('#details').innerHTML=`<div class="detail-top"><span class="overline">${esc(t('detail'))}</span><button id="close-detail" class="close-button" aria-label="${esc(t('close'))}">×</button></div>`+(event?eventDetails(event):`<p class="no-detail">${esc(t('chooseEvent'))}</p>`);
  bindClose();bindDetailActions($('#details'));
}

function bindClose(){$('#close-detail').onclick=()=>{document.body.classList.remove('mobile-detail');document.body.classList.add('detail-closed');syncDetailMode();const selectedId=state.selected;state.selected=null;renderCalendar();const target=$$(`[data-event="${selectedId}"]`).find(el=>el.getClientRects().length);const fallback=detailReturnDay?$$(`[data-day="${detailReturnDay}"]`).find(el=>el.getClientRects().length):null;(target||fallback)?.focus({preventScroll:true});window.scrollTo(0,detailScrollY);};}
function openDay(iso){$('#day-dialog').className=dayPlan(iso)?'day-'+dayPlan(iso).kind:'';$('#day-dialog').dataset.date=iso;$('#day-title').textContent=formatDate(iso,true)+(dayPlan(iso)?' · '+dayPlanName(dayPlan(iso)):'');const items=events.filter(matches).filter(e=>onDate(e,iso)).sort(sortEvents);$('#day-events').innerHTML=dayBadge(dayPlan(iso))+(items.length?items.map(agendaButton).join(''):`<p>${esc(t('noDayEvents'))}</p>`);bindEvents($('#day-events'));$('#day-dialog').showModal();}
function render(){
  document.documentElement.lang=state.lang?'en':'zh-CN';document.title=state.lang?'Keydion Calendar - School calendar':'Keydion日历 - 校历';$$('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));
  $('#language').textContent=state.lang?'中文':'EN';$('#language').setAttribute('aria-label',state.lang?'切换为中文':'Switch to English');
  $('#search').placeholder=t('searchPlaceholder');$('#search').setAttribute('aria-label',t('searchPlaceholder'));
  $('#previous').setAttribute('aria-label',t('previous'));$('#next').setAttribute('aria-label',t('next'));$('#school-select').setAttribute('aria-label',t('scope'));$('#details').setAttribute('aria-label',t('detail'));$('#close-day').setAttribute('aria-label',t('closeDay'));$('#close-registration').setAttribute('aria-label',state.lang?'Close':'关闭');
  $('#day-legend').innerHTML=`<span class="legend-weekday">${state.lang?'Weekday':'工作日'}</span><span class="legend-weekend">${state.lang?'Weekend':'周末'}</span><span class="legend-half">${state.lang?'Half day':'上半天'}</span><span class="legend-off">${state.lang?'Holiday':'放假'}</span><span>${dayBadge({kind:'school'})} ${state.lang?'Full school day':'全天上课'}</span>`;
  renderFilters();renderCalendar();renderDetail();
  document.dispatchEvent(new CustomEvent('calendar-language'));
}
$('#search').oninput=e=>{state.query=e.target.value;state.selected=null;renderCalendar();renderDetail();};
$('#language').onclick=()=>{state.lang=1-state.lang;localStorage.setItem('exam-language',String(state.lang));render();};
$('#school-select').onchange=e=>setSchool(e.target.value);
$$('.reset').forEach(b=>b.onclick=resetFilters);
function changeView(view){state.view=view;renderCalendar();}
$('#month-view').onclick=()=>changeView('month');$('#list-view').onclick=()=>changeView('list');$('#week-view').onclick=()=>{
  if(!state.anchor){const today=dateValue(schoolToday());state.anchor=isoDate(new Date(state.year,state.month,today.getFullYear()===state.year&&today.getMonth()===state.month?today.getDate():1,12));}
  changeView('week');
};
function moveMonth(delta){const date=state.view==='week'?dateValue(state.anchor):new Date(state.year,state.month+delta,1,12);if(state.view==='week')date.setDate(date.getDate()+delta*7);state.anchor=state.view==='week'?isoDate(date):'';state.year=date.getFullYear();state.month=date.getMonth();state.selected=null;renderCalendar();renderDetail();}
$('#previous').onclick=()=>moveMonth(-1);$('#next').onclick=()=>moveMonth(1);$('#today').onclick=()=>{state.anchor=schoolToday();const current=state.anchor.split('-').map(Number);state.year=current[0];state.month=current[1]-1;state.selected=null;document.body.classList.remove('detail-closed');render();};
$('#close-day').onclick=()=>$('#day-dialog').close();$('#close-registration').onclick=()=>$('#registration-dialog').close();$('#registration-ok').onclick=()=>$('#registration-dialog').close();
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('dialog[open]')&&document.body.classList.contains('mobile-detail'))$('#close-detail')?.click();});
document.addEventListener('keydown',e=>{if(e.key!=='Tab'||!mobileQuery.matches||!document.body.classList.contains('mobile-detail')||$('dialog[open]'))return;const buttons=[...$('#details').querySelectorAll('button,a[href]')].filter(el=>el.getClientRects().length);const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}});
mobileQuery.addEventListener('change',syncDetailMode);
render();

$('#close-media').onclick=()=>$('#media-dialog').close();
$('#retry-load').onclick=()=>{$('#retry-load').hidden=true;startCalendar();};

// Fit visible event rows to the available week height; overflow remains in the day dialog.
function fitMonthDensity(){
  const grid=$('#month-grid');
  if(mobileQuery.matches||!grid.getClientRects().length)return;
  const weeks=grid.querySelectorAll('.week').length;
  if(!weeks)return;
  const slots=Math.max(0,Math.floor((grid.clientHeight/weeks-52)/23));
  if(slots!==calendarSlots){calendarSlots=slots;renderCalendar();}
}
const monthSizeObserver=new ResizeObserver(fitMonthDensity);
monthSizeObserver.observe($('#month-grid'));
startCalendar();
