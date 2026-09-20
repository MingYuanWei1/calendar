export {};
/** @returns {any} */
const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const title=value=>value?.find(part=>part?.trim())||'';
const date=iso=>new Date(iso+'T12:00:00');
const iso=value=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
const addDays=(value,days)=>{const next=date(value);next.setDate(next.getDate()+days);return iso(next);};
const monday=value=>addDays(value,-((date(value).getDay()+6)%7));
const names={activity:'活动',competition:'比赛',exam:'考试',holiday:'假期',deadline:'截止日'};
const divisions={all:'全部学部',primary:'小学部',middle:'初中部',high:'高中部',schoolwide:'全校'};
const descriptions={timeline:'A · 时间轴：纵向位置对应开始时间，高度对应持续时长；重叠事件并排。全天与跨日事件单独置顶，截止时间用短条标记。',cards:'B · 七列卡片：全天与跨日事件置顶，其余按开始时间排列。卡片高度由信息量决定，适合快速浏览学校公共事项。',periods:'C · 时段分组：全天与跨日事件置顶，其余按开始时间归入上午、下午或晚间。跨时段事件只显示一次，完整时间保留在卡片中。'};
let events=[],plans={},today='',sampleWeek='',week='',variant='timeline',school='all',enabled=new Set(Object.keys(names));
function matches(event){return enabled.has(event.type)&&(school==='all'||event.scope.includes('schoolwide')||event.scope.includes(school));}
function occurs(event,day){return event.start<=day&&(event.end||event.start)>=day;}
function timed(event){return !!event.time&&(!event.end||event.end===event.start);}
function timeText(event){return event.time?(event.type==='deadline'?'截止 ':'')+event.time+(event.endTime?'–'+event.endTime:''):'全天';}
function minutes(value){const [hour,minute]=value.split(':').map(Number);return hour*60+minute;}
function dayClass(day){return plans[day]?.kind||(date(day).getDay()===0||date(day).getDay()===6?'weekend':'');}
function card(event,style=''){
  return `<button class="event-card ${event.type}${event.cancelled?' cancelled':''}" data-event="${escape(event.id)}" ${style?`style="${style}"`:''} title="${escape(title(event.title)+' · '+timeText(event))}"><time>${escape(timeText(event))}</time><strong>${event.cancelled?'已取消 · ':event.oldDate?'已改期 · ':''}${escape(title(event.title))}</strong>${title(event.location)?`<small>${escape(title(event.location))}</small>`:''}</button>`;
}
function allDayBars(list,days){
  const rows=[];
  const markup=list.filter(e=>!timed(e)).sort((a,b)=>a.start.localeCompare(b.start)).map(event=>{
    const from=Math.max(0,days.findIndex(day=>day>=event.start));
    let to=days.findIndex(day=>day>(event.end||event.start));if(to<0)to=7;
    let lane=rows.findIndex(end=>end<=from);if(lane<0)lane=rows.length;rows[lane]=to;
    return `<button class="bar ${event.type}${event.cancelled?' cancelled':''}" data-event="${escape(event.id)}" style="grid-column:${from+1}/${to+1};grid-row:${lane+1}">${event.start<days[0]?'‹ ':''}${escape(title(event.title))}${event.end>days[6]?' ›':''}</button>`;
  }).join('');
  return `<div class="all-day"><div class="section-label">全天 / 跨日${markup?'':' · 本周暂无'}</div><div class="all-day-bars">${markup}</div></div>`;
}
function timeline(list,days){
  const timedEvents=list.filter(timed);
  const beginning=Math.min(8,...timedEvents.map(e=>Math.floor(minutes(e.time)/60)));
  const ending=Math.max(20,...timedEvents.map(e=>Math.ceil((minutes(e.endTime||e.time)+30)/60)));
  const height=(ending-beginning)*54;
  const axis=Array.from({length:ending-beginning},(_,i)=>`<span style="top:${i*54}px">${String(beginning+i).padStart(2,'0')}:00</span>`).join('');
  const columns=days.map(day=>{
    const appointments=timedEvents.filter(e=>occurs(e,day)).map(event=>({event,start:minutes(event.time),end:Math.max(minutes(event.endTime||event.time),minutes(event.time)+25),lane:0})).sort((a,b)=>a.start-b.start||a.end-b.end);
    // Connected overlap groups share widths; independent appointments retain full width.
    const groups=[];let group=[],groupEnd=-1;
    for(const item of appointments){if(item.start>=groupEnd&&group.length){groups.push(group);group=[];groupEnd=-1;}group.push(item);groupEnd=Math.max(groupEnd,item.end);}if(group.length)groups.push(group);
    const cards=groups.map(items=>{
      const lanes=[];
      for(const item of items){let lane=lanes.findIndex(end=>end<=item.start);if(lane<0)lane=lanes.length;lanes[lane]=item.end;item.lane=lane;}
      return items.map(item=>card(item.event,`top:${(item.start-beginning*60)*.9}px;height:${Math.max(22,(item.end-item.start)*.9-2)}px;left:calc(${item.lane*100/lanes.length}% + 2px);width:calc(${100/lanes.length}% - 4px)`)).join('');
    }).join('');
    return `<div class="time-column ${dayClass(day)}">${cards}</div>`;
  }).join('');
  return `<div class="time-body" style="height:${height}px"><div class="time-axis">${axis}</div><div class="time-columns">${columns}</div></div>`;
}
function cardColumns(list,days){return `<div class="columns">${days.map(day=>{
  const items=list.filter(timed).filter(e=>occurs(e,day)).sort((a,b)=>a.time.localeCompare(b.time));
  return `<div class="day-column ${dayClass(day)}">${items.map(e=>card(e)).join('')||'<p class="no-events">暂无定时事件</p>'}</div>`;
}).join('')}</div>`;}
function periodRows(list,days){return [{name:'上午',range:'00:00–11:59',from:0,to:12},{name:'下午',range:'12:00–17:59',from:12,to:18},{name:'晚间',range:'18:00–23:59',from:18,to:24}].map(period=>`<div class="period-title">${period.name} <span> / ${period.range} · 按开始时间分组</span></div><div class="period-row">${days.map(day=>{
  const items=list.filter(timed).filter(e=>occurs(e,day)&&minutes(e.time)>=period.from*60&&minutes(e.time)<period.to*60).sort((a,b)=>a.time.localeCompare(b.time));
  return `<div class="period-cell ${dayClass(day)}">${items.map(e=>card(e)).join('')||'<p class="no-events">—</p>'}</div>`;
}).join('')}</div>`).join('');}
function render(){
  if(!week)return;
  const days=Array.from({length:7},(_,i)=>addDays(week,i));
  const list=events.filter(matches).filter(e=>e.start<=days[6]&&(e.end||e.start)>=days[0]);
  $('#week-title').textContent=`${date(week).getMonth()+1}月${date(week).getDate()}日 — ${date(days[6]).getMonth()+1}月${date(days[6]).getDate()}日`;
  $('#variant-description').textContent=descriptions[variant];
  document.querySelectorAll('[data-variant]').forEach(button=>button.setAttribute('aria-pressed',String(button.getAttribute('data-variant')===variant)));
  $('#schools').innerHTML=Object.entries(divisions).filter(([key])=>key!=='schoolwide').map(([key,label])=>`<button data-school="${key}" aria-pressed="${school===key}">${label}</button>`).join('');
  $('#types').innerHTML=Object.entries(names).map(([key,label])=>`<label class="${key}"><input type="checkbox" data-type="${key}" ${enabled.has(key)?'checked':''}>${label}</label>`).join('');
  const headings=`<div class="date-head">${days.map((day,i)=>`<div class="date-cell ${dayClass(day)}"><span class="dow">${['周一','周二','周三','周四','周五','周六','周日'][i]}</span><strong>${date(day).getDate()}</strong>${plans[day]?`<span class="badge ${plans[day].kind}">${plans[day].kind==='off'?'休':'上课'}</span>`:''}<span class="day-name">${escape(title(plans[day]?.title))}</span></div>`).join('')}</div>`;
  $('#board').innerHTML=`<div class="week-content ${variant}">${headings}${allDayBars(list,days)}${variant==='timeline'?timeline(list,days):variant==='cards'?cardColumns(list,days):periodRows(list,days)}</div>`;
  $('#board').scrollTop=0;
  $('#event-count').textContent=`本周 ${list.length} 项事件 · 同一组数据对比三种布局`;
  document.querySelectorAll('[data-school]').forEach(button=>button.addEventListener('click',()=>{school=button.getAttribute('data-school');render();}));
  document.querySelectorAll('[data-type]').forEach(input=>input.addEventListener('change',()=>{const key=input.getAttribute('data-type');enabled.has(key)?enabled.delete(key):enabled.add(key);render();}));
  document.querySelectorAll('[data-event]').forEach(button=>button.addEventListener('click',()=>openDetail(button.getAttribute('data-event'))));
}
function openDetail(id){
  const event=events.find(e=>e.id===id);if(!event)return;
  const row=(label,value)=>value?`<dt>${label}</dt><dd>${escape(value)}</dd>`:'';
  $('#detail-content').innerHTML=`<span class="detail-type ${event.type}">${names[event.type]}</span><h2 id="detail-title">${escape(title(event.title))}</h2>${event.cancelled?`<p class="notice">已取消 · ${escape(event.cancelReason||'此事件已取消')}</p>`:event.oldDate?`<p class="notice">已改期 · 原定 ${escape(event.oldDate)}</p>`:''}<dl>${row('日期',event.start+(event.end?' — '+event.end:''))}${row('时间',timeText(event))}${row('学部',event.scope.map(scope=>divisions[scope]).join('、'))}${row('地点',title(event.location))}${row('主办',title(event.host))}</dl><p class="detail-description">${escape(title(event.description))}</p>${event.registrationUrl&&!event.cancelled?`<a href="${escape(event.registrationUrl)}" target="_blank" rel="noopener noreferrer">查看外部报名入口 ↗</a>`:''}`;
  $('#details').showModal();
}
document.querySelectorAll('[data-variant]').forEach(button=>button.addEventListener('click',()=>{variant=button.getAttribute('data-variant');history.replaceState(null,'','#'+variant);render();}));
$('#previous').onclick=()=>{week=addDays(week,-7);render();};$('#next').onclick=()=>{week=addDays(week,7);render();};
$('#current').onclick=()=>{week=monday(today);render();};$('#sample').onclick=()=>{week=sampleWeek;render();};
$('#reset').onclick=()=>{school='all';enabled=new Set(Object.keys(names));render();};$('#close-detail').onclick=()=>$('#details').close();
async function start(){
  try{
    const responses=await Promise.all(['/api/events','/api/day-plans','/api/config'].map(path=>fetch(path)));
    if(responses.some(response=>!response.ok))throw new Error('加载失败');
    const [data,dayPlans,settings]=await Promise.all(responses.map(response=>response.json()));
    events=data;plans=Object.fromEntries(dayPlans.map(plan=>[plan.date,plan]));
    today=new Intl.DateTimeFormat('en-CA',{timeZone:settings.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const sample=events.find(event=>event.id.startsWith('sample-')&&event.id.endsWith('-arts'));
    sampleWeek=monday(sample?.start||today);week=sampleWeek;
    if(Object.hasOwn(descriptions,location.hash.slice(1)))variant=location.hash.slice(1);
    $('#timezone').textContent=settings.timeZone+' · 学校时间';$('#load-status').textContent='';render();
  }catch{$('#load-status').textContent='无法加载校历，请刷新重试。';}
}
start();
