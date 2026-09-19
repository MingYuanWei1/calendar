'use strict';
const theme = new URLSearchParams(location.search).get('theme');
document.body.className = ['classic','editorial','airy'].includes(theme) ? theme : 'classic';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const copy = {
  school:['学校校历','School calendar'], publicCalendar:['属于每一位同学的校园日程','A calendar for every student'], searchLabel:['搜索','Search'], september:['2026 年 9 月','September 2026'], autumn:['秋季学期','Autumn term'], scope:['适用学部','School division'], reset:['重置','Reset'], types:['事件类型','Event types'], scopeNote:['选择学部时，同时显示全校事件。','School-wide events are included in every division.'], publicNote:['公开校历 · 无需登录','Public calendar · No sign-in'], schoolLife:['校园生活 / SCHOOL LIFE','SCHOOL LIFE'], term:['2026—2027 学年 · 秋季学期','2026–2027 · Autumn term'], today:['今天','Today'], monthView:['月历','Month'], listView:['日程','Agenda'], emptyTitle:['没有符合条件的事件','No matching events'], emptyHelp:['试试其他关键词，或重置筛选。','Try another search or reset your filters.'], timezone:['学校当地时间 · 示例事件','School local time · Sample events'], dayEvents:['当天事件','EVENTS ON THIS DAY'], registrationPreview:['报名入口示意','Registration preview'], registrationNotice:['正式发布时，此处打开管理员填写的外部报名表。当前设计稿未连接真实表单。','In the published calendar, this opens the external form provided by an administrator. This design is not connected to a real form.'], understood:['知道了','Got it'], detail:['事件详情','EVENT DETAILS'], close:['关闭详情','Close details'], when:['时间','When'], where:['地点','Where'], for:['适用','For'], host:['主办','Host'], about:['事件说明','About this event'], allDay:['全天','All day'], till:['截止','Due'], cancelled:['已取消','Cancelled'], changed:['已改期','Rescheduled'], registration:['查看报名表','Open registration form'], external:['通过外部表单报名，本平台仅展示信息。','Registration is handled by an external form.'], updated:['更新于 9 月 18 日 16:30','Updated 18 Sep, 16:30'], chooseEvent:['选择一项事件查看详情','Select an event to see the details'], missingLocation:['未设置地点','No location specified'], allSchools:['全部学部','All divisions'], schoolwide:['全校','School-wide'], primary:['小学部','Primary'], middle:['初中部','Middle'], high:['高中部','High'], noDayEvents:['当天没有符合条件的事件','No matching events on this day'], searchPlaceholder:['搜索事件','Search events'], previous:['上个月','Previous month'], next:['下个月','Next month'], closeDay:['关闭当天事件','Close day events']
};
const types = {
  exam:{label:['考试','Exams'],color:'var(--exam)'}, holiday:{label:['假期','Holidays'],color:'var(--holiday)'}, competition:{label:['比赛','Competitions'],color:'var(--competition)'}, activity:{label:['活动','Activities'],color:'var(--activity)'}, deadline:{label:['截止日','Deadlines'],color:'var(--deadline)'}
};
const schools = ['allSchools','primary','middle','high'];
const state = {lang:0,year:2026,month:8,school:'allSchools',types:new Set(Object.keys(types)),query:'',view:'month',selected:'arts'};
const mobileQuery = matchMedia('(max-width:760px)');
const events = [
  {id:'opening',title:['新学期开学典礼','Autumn opening assembly'],type:'activity',start:'2026-09-01',time:'08:30',endTime:'09:30',scope:['schoolwide'],location:['学校礼堂','School auditorium'],host:['学生发展中心','Student development office'],description:['新学期开学典礼，请各学部同学按学校安排入场。','Welcome assembly for the new term. Please follow your division’s arrival arrangements.']},
  {id:'reading',title:['图书馆阅读分享会','Library reading circle'],type:'activity',start:'2026-09-04',time:'15:30',endTime:'16:30',scope:['primary'],location:['图书馆一楼','Library, ground floor'],host:['图书馆','School library']},
  {id:'science',title:['科学探索开放日','Science discovery day'],type:'activity',start:'2026-09-08',time:'14:00',endTime:'16:00',scope:['primary','middle'],location:['科学实验中心','Science lab centre'],host:['科学教研组','Science department']},
  {id:'debate',title:['英语辩论赛初赛','English debate heats'],type:'competition',start:'2026-09-10',time:'15:00',endTime:'17:00',scope:['middle','high'],location:['报告厅','Lecture hall'],host:['英语教研组','English department']},
  {id:'midterm',title:['高中部阶段考试','High school assessment'],type:'exam',start:'2026-09-14',end:'2026-09-16',scope:['high'],location:['高中部教学楼','High school building'],host:['高中部教务处','High school academic office'],description:['考试期间请按照各学科公布的安排参加考试。具体考场与场次以教务处通知为准。','Follow the timetable issued by each subject team. Refer to the academic office notice for individual sessions and rooms.']},
  {id:'clubdue',title:['社团选报截止','Club selection closes'],type:'deadline',start:'2026-09-18',time:'17:00',scope:['middle','high'],host:['学生发展中心','Student development office'],description:['请在截止时间前通过学校选报表完成社团选择。','Submit your club choices through the school form before the deadline.'],registration:true},
  {id:'garden',title:['校园自然观察','Campus nature walk'],type:'activity',start:'2026-09-19',time:'09:00',endTime:'10:30',scope:['primary'],location:['校园植物园','School garden'],host:['小学部科学组','Primary science team']},
  {id:'readingweek',title:['校园阅读周','Campus reading week'],type:'activity',start:'2026-09-21',end:'2026-09-24',scope:['schoolwide'],location:['图书馆','School library'],host:['图书馆','School library'],description:['在阅读周里交换一本好书，分享一段喜欢的文字。各学部活动安排请关注图书馆公告。','Exchange a favourite book and share a passage during reading week. See the library notice for division activities.']},
  {id:'sports',title:['秋季运动会','Autumn sports day'],type:'competition',start:'2026-09-22',time:'08:30',endTime:'16:00',scope:['schoolwide'],location:['学校田径场','School athletics field'],host:['体育组','Physical education department'],oldDate:'2026-09-20',description:['田径项目与团队趣味赛。请穿着运动服，携带饮用水，按学部安排参加。','Track events and team games. Wear sports clothing, bring drinking water and follow your division’s arrangements.']},
  {id:'arts',title:['校园艺术节','Campus arts festival'],type:'activity',start:'2026-09-23',time:'14:00',endTime:'17:00',scope:['schoolwide'],location:['学校礼堂 · 一楼','School auditorium · Ground floor'],host:['艺术教研组 · 学生发展中心','Arts department · Student development office'],description:['用音乐、戏剧与创作，记录校园里的每一种热爱。欢迎三个学部的同学一起观看演出、参观学生作品展。','Celebrate school life through music, theatre and creative work. Students from all three divisions are welcome to enjoy the performances and student exhibition.'],extra:['演出 14:00 开始，建议提前 15 分钟入场。参与工作坊的同学请通过下方表单登记。','Performances begin at 14:00. Please arrive 15 minutes early. Use the form below to register for a workshop.'],registration:true},
  {id:'math',title:['数学思维挑战赛','Mathematical thinking challenge'],type:'competition',start:'2026-09-23',time:'10:00',endTime:'11:30',scope:['middle'],location:['初中部多功能室','Middle school activity room'],host:['数学教研组','Mathematics department']},
  {id:'makers',title:['创客工作坊','Maker workshop'],type:'activity',start:'2026-09-23',time:'13:00',endTime:'14:00',scope:['primary','middle'],location:['创客空间','Maker space'],host:['科学教研组','Science department'],registration:true},
  {id:'lecture',title:['生涯探索讲座','Pathways exploration talk'],type:'activity',start:'2026-09-23',time:'15:30',endTime:'16:30',scope:['high'],location:['报告厅','Lecture hall'],host:['学生发展中心','Student development office']},
  {id:'teamdue',title:['校队报名截止','School team registration closes'],type:'deadline',start:'2026-09-23',time:'17:00',scope:['middle','high'],host:['体育组','Physical education department'],registration:true},
  {id:'choir',title:['校园合唱音乐会','School choir concert'],type:'activity',start:'2026-09-24',time:'16:00',endTime:'17:00',scope:['schoolwide'],location:['学校礼堂','School auditorium'],host:['艺术教研组','Arts department'],cancelled:true,description:['本场音乐会因场地维护取消。后续安排将另行发布。','This concert has been cancelled due to venue maintenance. Any new arrangements will be announced separately.']},
  {id:'break',title:['秋季校假（示例）','Autumn school break (sample)'],type:'holiday',start:'2026-09-25',end:'2026-09-27',scope:['schoolwide'],host:['学校办公室','School office'],description:['用于展示跨日假期的虚构示例，不代表任何地区的法定节假日或真实学校放假安排。','Fictional data demonstrating a multi-day school break. These are not verified public holidays or an actual school schedule.']},
  {id:'primaryexam',title:['小学部学习回顾','Primary learning review'],type:'exam',start:'2026-09-28',scope:['primary'],location:['小学部各班教室','Primary classrooms'],host:['小学部教务处','Primary academic office']},
  {id:'middleexam',title:['初中部阶段考试','Middle school assessment'],type:'exam',start:'2026-09-29',end:'2026-09-30',scope:['middle'],location:['初中部教学楼','Middle school building'],host:['初中部教务处','Middle school academic office']},
  {id:'electives',title:['选课调整截止','Elective changes close'],type:'deadline',start:'2026-09-30',time:'17:00',scope:['high'],host:['高中部教务处','High school academic office'],description:['请在截止时间前确认本学期选修课调整结果。','Confirm your elective changes for the term before the deadline.'],registration:true}
];
function t(key){return copy[key]?.[state.lang] ?? key;}
function text(pair){return pair?.[state.lang] || pair?.[0] || '';}
function esc(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function dateValue(iso){return new Date(iso+'T12:00:00');}
function isoDate(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function formatDate(iso,weekday=false){return new Intl.DateTimeFormat(state.lang?'en-GB':'zh-CN',{month:state.lang?'short':'long',day:'numeric',...(weekday?{weekday:'long'}:{})}).format(dateValue(iso));}
function isMulti(event){return event.end && event.end!==event.start;}
function matches(event){return state.types.has(event.type) && (state.school==='allSchools'||event.scope.includes('schoolwide')||event.scope.includes(state.school)) && (!state.query||event.title.join(' ').toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));}
function onDate(event,iso){return event.start<=iso && (event.end||event.start)>=iso;}
function sortEvents(a,b){return (isMulti(a)?0:1)-(isMulti(b)?0:1) || (a.time||'00:00').localeCompare(b.time||'00:00') || a.id.localeCompare(b.id);}
function timeText(event){if(!event.time)return t('allDay');return (event.type==='deadline'?t('till')+' ':'')+event.time+(event.endTime?'–'+event.endTime:'');}
function scopeText(event){return event.scope.map(t).join(state.lang?' / ':'、');}
function label(event){return `${text(event.title)} · ${formatDate(event.start)} · ${timeText(event)}`;}
function eventButton(event){return `<button class="event ${event.type}${event.cancelled?' cancelled':''}${state.selected===event.id?' selected':''}" data-event="${event.id}" title="${esc(label(event))}" aria-label="${esc(label(event))}"><span class="dot"></span><span class="event-text">${event.cancelled?esc(t('cancelled'))+' · ':''}${event.oldDate?esc(t('changed'))+' · ':''}${event.type==='deadline'?esc(t('till'))+' ':''}${event.time?`<time>${event.time}</time> `:''}${esc(text(event.title))}</span></button>`;}
function agendaButton(event){return `<button class="agenda-event ${event.type}${event.cancelled?' cancelled':''}${state.selected===event.id?' selected':''}" data-event="${event.id}"><span class="dot"></span><span><strong>${event.cancelled?esc(t('cancelled'))+' · ':''}${event.oldDate?esc(t('changed'))+' · ':''}${esc(text(event.title))}</strong><small>${esc(timeText(event))} · ${esc(scopeText(event))}${event.location?' · '+esc(text(event.location)):''}</small></span></button>`;}
function setSchool(school){state.school=school;state.selected=null;render();}
function toggleType(type){state.types.has(type)?state.types.delete(type):state.types.add(type);state.selected=null;render();}
function resetFilters(){state.school='allSchools';state.types=new Set(Object.keys(types));state.query='';$('#search').value='';state.selected='arts';render();}
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
function selectEvent(id){state.selected=id;document.body.classList.remove('detail-closed');document.body.classList.add('mobile-detail');$('#day-dialog').close();renderCalendar();renderDetail();syncDetailMode();if(mobileQuery.matches)$('#close-detail')?.focus();}
function renderCalendar(){
  const first = new Date(state.year,state.month,1,12);const last = new Date(state.year,state.month+1,0,12);
  const offset=(first.getDay()+6)%7;const count=Math.ceil((offset+last.getDate())/7)*7;
  const start=new Date(state.year,state.month,1-offset,12);
  const monthEvents=events.filter(matches).filter(e=>e.start<=isoDate(last)&&(e.end||e.start)>=isoDate(first));
  $('#month-title').textContent=new Intl.DateTimeFormat(state.lang?'en-GB':'zh-CN',{year:'numeric',month:'long'}).format(first);
  $('#weekdays').innerHTML=(state.lang?['MON','TUE','WED','THU','FRI','SAT','SUN']:['周一','周二','周三','周四','周五','周六','周日']).map(d=>`<span>${d}</span>`).join('');
  let html='';
  for(let w=0;w<count/7;w++){
    const dates=Array.from({length:7},(_,i)=>new Date(state.year,state.month,1-offset+w*7+i,12));
    const weekStart=isoDate(dates[0]),weekEnd=isoDate(dates[6]);
    const multi=events.filter(matches).filter(isMulti).filter(e=>e.start<=weekEnd&&e.end>=weekStart).sort((a,b)=>a.start.localeCompare(b.start)||b.end.localeCompare(a.end));
    const lanes=[];const bars=multi.map(e=>{
      const from=Math.max(0,dates.findIndex(d=>isoDate(d)>=e.start));
      let to=dates.findIndex(d=>isoDate(d)>e.end);if(to<0)to=7;
      let lane=lanes.findIndex(end=>end<=from);if(lane<0)lane=lanes.length;lanes[lane]=to;
      return `<button class="span-event ${e.type}${state.selected===e.id?' selected':''}${e.start<weekStart?' continues-left':''}${e.end>weekEnd?' continues-right':''}" data-event="${e.id}" style="grid-column:${from+1}/${to+1};grid-row:${lane+1}" aria-label="${esc(label(e))}" title="${esc(label(e))}">${esc(text(e.title))} · ${esc(scopeText(e))}</button>`;
    }).join('');
    html+=`<div class="week" style="min-height:${128+Math.max(0,lanes.length-1)*26}px">`;
    for(let i=0;i<7;i++){
      const d=dates[i],iso=isoDate(d);const items=events.filter(matches).filter(e=>!isMulti(e)&&onDate(e,iso)).sort(sortEvents);
      const cap=3;
      html+=`<div class="day${d.getMonth()!==state.month?' outside':''}${i>4?' weekend':''}${iso==='2026-09-19'?' today':''}"><button class="day-number" data-day="${iso}" aria-label="${esc(formatDate(iso,true))}" ${iso==='2026-09-19'?'aria-current="date"':''}>${d.getDate()}</button><div class="day-items" style="padding-top:${lanes.length*26}px">${items.slice(0,cap).map(eventButton).join('')}${items.length>cap?`<button class="more" data-day="${iso}">${state.lang?`+${items.length-cap} more`:`还有 ${items.length-cap} 项`}</button>`:''}</div></div>`;
    }
    html+=`<div class="spans">${bars}</div></div>`;
  }
  $('#month-grid').innerHTML=html;
  let agenda='';
  for(let day=1;day<=last.getDate();day++){
    const iso=isoDate(new Date(state.year,state.month,day,12));const items=monthEvents.filter(e=>onDate(e,iso)).sort(sortEvents);
    if(!items.length)continue;
    agenda+=`<section class="agenda-day"><div class="agenda-date"><strong>${day}</strong><small>${new Intl.DateTimeFormat(state.lang?'en-GB':'zh-CN',{weekday:'short'}).format(dateValue(iso))}</small></div><div>${items.map(agendaButton).join('')}</div></section>`;
  }
  $('#agenda').innerHTML=agenda;
  $('#agenda').classList.toggle('is-empty',!monthEvents.length);
  $('#agenda').hidden=state.view==='month';$('#month-grid').hidden=state.view!=='month';$('#weekdays').hidden=state.view!=='month';
  $('#empty').hidden=!!monthEvents.length;
  $('#result-count').textContent=state.lang?`${monthEvents.length} events this month`:`本月 ${monthEvents.length} 项事件`;
  $('#month-view').setAttribute('aria-pressed',String(state.view==='month'));$('#list-view').setAttribute('aria-pressed',String(state.view==='list'));
  bindEvents($('#main-calendar'));$$('[data-day]').forEach(b=>b.onclick=()=>openDay(b.dataset.day));
}
function renderDetail(){
  const event=events.find(e=>e.id===state.selected);
  $('#details').innerHTML=`<div class="detail-top"><span class="overline">${esc(t('detail'))}</span><button id="close-detail" class="close-button" aria-label="${esc(t('close'))}">×</button></div>`;
  if(!event){$('#details').innerHTML+=`<p class="no-detail">${esc(t('chooseEvent'))}</p>`;bindClose();return;}
  const dateText=formatDate(event.start,true)+(isMulti(event)?' — '+formatDate(event.end,true):'');
  const description=event.description?text(event.description):(state.lang?'Please follow the organiser’s arrangements. See this calendar for any updates to the time or location.':'请按照主办方安排参加，时间或地点如有调整，将在本校历更新。');
  const status=event.cancelled?`<div class="change-notice cancel-notice"><strong>${esc(t('cancelled'))}</strong><br>${state.lang?'This event will not take place. The record is retained for reference.':'此事件不再举行，保留记录供同学查阅。'}</div>`:event.oldDate?`<div class="change-notice"><strong>${esc(t('changed'))}</strong><br>${state.lang?'Previously: ':'原定：'}${esc(formatDate(event.oldDate))}<br>${state.lang?'Now: ':'现定：'}${esc(formatDate(event.start))}</div>`:'';
  $('#details').innerHTML+=`<span class="detail-type ${event.type}"><span class="dot"></span>${esc(text(types[event.type].label))}</span><h2>${esc(text(event.title))}</h2><p class="detail-subtitle">${esc(scopeText(event))} · ${state.lang?'School event':'校园公共事件'}</p>${status}<div class="detail-meta"><div class="meta-row"><span class="meta-label">${esc(t('when'))}</span><div class="meta-value">${esc(dateText)}<small>${esc(timeText(event))} · ${state.lang?'School local time':'学校当地时间'}</small></div></div>${event.location?`<div class="meta-row"><span class="meta-label">${esc(t('where'))}</span><div class="meta-value">${esc(text(event.location))}</div></div>`:''}<div class="meta-row"><span class="meta-label">${esc(t('for'))}</span><div class="meta-value">${event.scope.map(s=>`<span class="scope-badge">${esc(t(s))}</span>`).join('')}</div></div><div class="meta-row"><span class="meta-label">${esc(t('host'))}</span><div class="meta-value">${esc(text(event.host))}</div></div></div><div class="detail-section"><h3>${esc(t('about'))}</h3><p>${esc(description)}</p>${event.extra?`<p style="margin-top:12px">${esc(text(event.extra))}</p>`:''}${event.registration&&!event.cancelled?`<button id="registration" class="primary registration-button"><span>${esc(t('registration'))}</span><span aria-hidden="true">↗</span></button><p class="external-note">${esc(t('external'))}</p>`:''}</div><p class="detail-updated">${esc(t('updated'))}</p>`;
  bindClose();$('#registration')?.addEventListener('click',()=>$('#registration-dialog').showModal());
}
function bindClose(){$('#close-detail').onclick=()=>{document.body.classList.remove('mobile-detail');document.body.classList.add('detail-closed');syncDetailMode();const selectedId=state.selected;state.selected=null;renderCalendar();const target=$$(`[data-event="${selectedId}"]`).find(el=>el.getClientRects().length);target?.focus();};}
function openDay(iso){$('#day-title').textContent=formatDate(iso,true);const items=events.filter(matches).filter(e=>onDate(e,iso)).sort(sortEvents);$('#day-events').innerHTML=items.length?items.map(agendaButton).join(''):`<p>${esc(t('noDayEvents'))}</p>`;bindEvents($('#day-events'));$('#day-dialog').showModal();}
function renderMini(){const names=state.lang?['M','T','W','T','F','S','S']:['一','二','三','四','五','六','日'];const first=new Date(state.year,state.month,1,12);const count=new Date(state.year,state.month+1,0,12).getDate();$('.mini-title strong').textContent=new Intl.DateTimeFormat(state.lang?'en-GB':'zh-CN',{year:'numeric',month:'long'}).format(first);$('#mini-calendar').innerHTML=names.map(n=>`<span class="mini-day">${n}</span>`).join('')+'<span></span>'.repeat((first.getDay()+6)%7)+Array.from({length:count},(_,i)=>`<span class="${state.year===2026&&state.month===8&&i===18?'marked':''}">${i+1}</span>`).join('');}
function render(){
  document.documentElement.lang=state.lang?'en':'zh-CN';$$('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));
  $('#language').textContent=state.lang?'中文':'EN';$('#language').setAttribute('aria-label',state.lang?'切换为中文':'Switch to English');
  $('#search').placeholder=t('searchPlaceholder');$('#search').setAttribute('aria-label',t('searchPlaceholder'));
  $('#previous').setAttribute('aria-label',t('previous'));$('#next').setAttribute('aria-label',t('next'));$('#school-select').setAttribute('aria-label',t('scope'));$('#details').setAttribute('aria-label',t('detail'));$('#close-day').setAttribute('aria-label',t('closeDay'));$('#close-registration').setAttribute('aria-label',state.lang?'Close':'关闭');
  renderFilters();renderMini();renderCalendar();renderDetail();
}
$('#search').oninput=e=>{state.query=e.target.value;state.selected=null;renderCalendar();renderDetail();};
$('#language').onclick=()=>{state.lang=1-state.lang;render();};
$('#school-select').onchange=e=>setSchool(e.target.value);
$$('.reset').forEach(b=>b.onclick=resetFilters);
$('#month-view').onclick=()=>{state.view='month';renderCalendar();};$('#list-view').onclick=()=>{state.view='list';renderCalendar();};
function moveMonth(delta){const date=new Date(state.year,state.month+delta,1,12);state.year=date.getFullYear();state.month=date.getMonth();state.selected=null;renderMini();renderCalendar();renderDetail();}
$('#previous').onclick=()=>moveMonth(-1);$('#next').onclick=()=>moveMonth(1);$('#today').onclick=()=>{state.year=2026;state.month=8;state.selected='arts';document.body.classList.remove('detail-closed');render();};
$('#close-day').onclick=()=>$('#day-dialog').close();$('#close-registration').onclick=()=>$('#registration-dialog').close();$('#registration-ok').onclick=()=>$('#registration-dialog').close();
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('dialog[open]')&&document.body.classList.contains('mobile-detail'))$('#close-detail')?.click();});
document.addEventListener('keydown',e=>{if(e.key!=='Tab'||!mobileQuery.matches||!document.body.classList.contains('mobile-detail')||$('dialog[open]'))return;const buttons=[...$('#details').querySelectorAll('button,a[href]')].filter(el=>el.getClientRects().length);const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}});
mobileQuery.addEventListener('change',syncDetailMode);
render();
