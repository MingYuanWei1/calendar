'use strict';
// The anchor is a civil date in the school timezone; weeks always start on Monday.
function renderWeek(){
  const first=dateValue(state.anchor||schoolToday());first.setDate(first.getDate()-(first.getDay()+6)%7);
  const days=Array.from({length:7},(_,i)=>{const day=new Date(first);day.setDate(day.getDate()+i);return isoDate(day);});
  const list=events.filter(matches).filter(e=>e.start<=days[6]&&(e.end||e.start)>=days[0]);
  const dateFormat=new Intl.DateTimeFormat(state.lang?'en-GB':'zh-CN',{year:'numeric',month:'short',day:'numeric'});
  $('#month-title').textContent=dateFormat.formatRange(first,dateValue(days[6]));
  $('#month-title').title=$('#month-title').textContent;
  $('#month-view').setAttribute('aria-pressed','false');$('#list-view').setAttribute('aria-pressed','false');
  $('#month-grid').hidden=true;$('#weekdays').hidden=true;$('#agenda').hidden=true;
  const dayClass=(day,i)=>`${i>4?' weekend':''}${dayPlan(day)?' day-'+dayPlan(day).kind:''}${day===schoolToday()?' today':''}`;
  const headings=days.map((day,i)=>`<div class="week-date${dayClass(day,i)}"><span>${new Intl.DateTimeFormat(state.lang?'en-GB':'zh-CN',{weekday:'short'}).format(dateValue(day))}</span><div class="day-date"><button class="day-number" data-day="${day}" aria-label="${esc(formatDate(day,true))}" ${day===schoolToday()?'aria-current="date"':''}>${dateValue(day).getDate()}</button>${dayBadge(dayPlan(day))}</div><div class="day-plan-name" title="${esc(dayPlanName(dayPlan(day)))}">${esc(dayPlanName(dayPlan(day)))}</div></div>`).join('');
  const lanes=[];
  const bars=list.filter(e=>!e.time||isMulti(e)).sort((a,b)=>a.start.localeCompare(b.start)||(b.end||b.start).localeCompare(a.end||a.start)||a.id.localeCompare(b.id)).map(e=>{
    const from=Math.max(0,days.findIndex(day=>day>=e.start));
    let to=days.findIndex(day=>day>(e.end||e.start));if(to<0)to=7;
    let lane=lanes.findIndex(end=>end<=from);if(lane<0)lane=lanes.length;lanes[lane]=to;
    return `<button class="week-bar ${e.type}${e.cancelled?' cancelled':''}${state.selected===e.id?' selected':''}" data-event="${esc(e.id)}" style="grid-column:${from+1}/${to+1};grid-row:${lane+1}" title="${esc(label(e))}" aria-label="${esc(label(e))}">${e.start<days[0]?'‹ ':''}${e.cancelled?esc(t('cancelled'))+' · ':''}${e.oldDate?esc(t('changed'))+' · ':''}${esc(text(e.title))}${(e.end||e.start)>days[6]?' ›':''}</button>`;
  }).join('');
  const columns=days.map((day,i)=>{
    const items=list.filter(e=>e.time&&!isMulti(e)&&onDate(e,day)).sort(sortEvents);
    return `<section class="week-card-column${dayClass(day,i)}" aria-label="${esc(formatDate(day,true))}">${items.map(e=>`<button class="week-card ${e.type}${e.cancelled?' cancelled':''}${state.selected===e.id?' selected':''}" data-event="${esc(e.id)}" title="${esc(label(e))}"><time>${esc(timeText(e))}</time><strong>${e.cancelled?esc(t('cancelled'))+' · ':''}${e.oldDate?esc(t('changed'))+' · ':''}${esc(text(e.title))}</strong>${text(e.location)?`<small>${esc(text(e.location))}</small>`:''}<small>${esc(scopeText(e))}</small></button>`).join('')||`<p class="week-no-events">${state.lang?'No timed events':'暂无定时事件'}</p>`}</section>`;
  }).join('');
  const board=$('#week-board'),scrollTop=board.scrollTop,scrollLeft=board.scrollLeft;
  board.innerHTML=`<div class="week-cards-content"><div class="week-date-head">${headings}</div><div class="week-all-day"><p>${state.lang?'All day / Multi-day':'全天 / 跨日'}</p><div class="week-bars">${bars||`<span class="week-no-events">${state.lang?'None this week':'本周暂无'}</span>`}</div></div><div class="week-card-columns">${columns}</div></div>`;
  board.scrollTop=scrollTop;board.scrollLeft=scrollLeft;
  $('#empty').hidden=!!list.length||days.some(day=>dayPlan(day));
  $('#result-count').textContent=state.lang?`${list.length} events this week`:`本周 ${list.length} 项事件`;
  bindEvents(board);board.querySelectorAll('[data-day]').forEach(button=>button.onclick=()=>openDay(button.dataset.day));
}
