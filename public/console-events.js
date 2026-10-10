import {$,$$,esc,corners,icon,app,T,tx,TYPES,SCOPES,api,toast,modal,closeModal,busy,errorLine,go,refreshNav,md,mdw,dateRange,monthLabel,statusOf,statusTag,statusLabel,loadEvents,loadPlans} from './console-core.js';
import {describeRepeat,isLastOfMonth,lastDate,occurrence,ordinalOf,repeatProblem,schoolYearEnd,seriesDates,weekdayOf} from './recurrence.mjs';
import {noticeDialog} from './console-notice.js';
import {DIVISION_GRADES,audienceParts,gradeLabel,normalizeGrades} from './grades.mjs';

const view={tab:'all',q:'',type:'all',div:'all',desc:false,menu:null};
const isMulti=e=>Boolean(e.end&&e.end!==e.start);
const dateLine=e=>isMulti(e)?dateRange(e.start,e.end):e.repeat?T(`${mdw(e.start)} 起`,`From ${mdw(e.start)}`):mdw(e.start);
const repeatTag=e=>e.repeat?`<span class="tag tag-outline small" title="${esc(describeRepeat(e.repeat,app.lang))}">↻ ${esc(describeRepeat({...e.repeat,until:undefined,count:undefined},app.lang))}</span>`:'';
const timeLine=e=>e.time?(e.type==='deadline'?T('截止 ','Due '):'')+e.time+(e.endTime?'–'+e.endTime:''):isMulti(e)?T('跨日 · 全天','Multiple days · all day'):e.type==='deadline'?T('截止 · 全天','Due · all day'):T('全天','All day');
const scopeLine=e=>audienceParts(e.scope,e.grades,s=>tx(SCOPES[s]),app.lang).join(app.lang?' / ':'、');
const movedLine=e=>e.oldDate?T(`改期 · 原 ${md(e.oldDate)}`,`Moved from ${md(e.oldDate)}`):'';
const whenOf=e=>`${dateLine(e)} · ${timeLine(e)}`;

export async function showEvents(main){
 if(!app.data.events){main.innerHTML=`<p class="loading">${T('正在加载事件…','Loading events…')}</p>`;await loadEvents();}
 main.innerHTML=`<div class="page">
 <header class="page-head"><div><div class="kicker">${T('管理后台','Admin console')}</div><h1>${T('事件','Events')}</h1><p class="sub">${T('全部学部 · 无需审核，直接发布','All divisions · Publish without approval')}</p></div>
 <div class="page-actions"><button type="button" class="btn btn-secondary" data-act="refresh">${T('刷新','Refresh')}</button><button type="button" class="btn btn-secondary" data-act="notice">${T('✨ 从通知生成','✨ From a notice')}</button><a class="btn btn-primary blueprint" href="#events/new">${corners}${icon.plus}${T('新增事件','New event')}</a></div></header>
 <div class="tabs" role="tablist" id="ev-tabs"></div>
 <div class="toolbar">
  <label class="search">${icon.search}<input class="input" id="ev-q" type="search" value="${esc(view.q)}" placeholder="${T('搜索名称、地点或主办方','Search title, location or organiser')}" aria-label="${T('搜索事件','Search events')}"></label>
  <select class="input" id="ev-type" aria-label="${T('类型','Type')}"><option value="all">${T('全部类型','All types')}</option>${Object.keys(TYPES).map(k=>`<option value="${k}"${view.type===k?' selected':''}>${tx(TYPES[k])}</option>`).join('')}</select>
  <select class="input" id="ev-div" aria-label="${T('学部','Division')}"><option value="all">${T('全部学部','All divisions')}</option>${['primary','middle','high'].map(k=>`<option value="${k}"${view.div===k?' selected':''}>${tx(SCOPES[k])}</option>`).join('')}</select>
  <button type="button" class="btn btn-secondary" data-act="sort" id="ev-sort"></button>
  <button type="button" class="btn btn-ghost" data-act="reset" id="ev-reset">${T('重置筛选','Reset filters')}</button>
  <span class="result-text" id="ev-count" aria-live="polite"></span>
 </div>
 <div class="grid-scroll"><div class="events-grid"><div class="grid-head"><span>${T('日期','Date')}</span><span>${T('事件','Event')}</span><span>${T('类型','Type')}</span><span>${T('适用范围','Audience')}</span><span>${T('状态','Status')}</span><span></span></div><div id="ev-list"></div></div></div>
 </div>`;
 $('#ev-q').oninput=e=>{view.q=e.target.value;renderResults();};
 $('#ev-type').onchange=e=>{view.type=e.target.value;renderResults();};
 $('#ev-div').onchange=e=>{view.div=e.target.value;renderResults();};
 main.querySelector('.page').onclick=onListClick;
 renderResults();
}

function renderResults(){
 if(!$('#ev-list'))return;
 const events=app.data.events,q=view.q.trim().toLowerCase();
 const baseMatch=e=>(!q||[...e.title,...(e.location||[]),...(e.host||[])].join(' ').toLowerCase().includes(q))&&(view.div==='all'||e.scope.includes(view.div)||e.scope.includes('schoolwide'));
 const typeMatch=e=>view.type==='all'||e.type===view.type;
 const list=events.filter(e=>baseMatch(e)&&typeMatch(e)&&(view.tab==='all'||statusOf(e)===view.tab))
  .sort((a,b)=>(view.desc?-1:1)*(a.start+(a.time||'')).localeCompare(b.start+(b.time||'')));
 $('#ev-tabs').innerHTML=['all','published','draft','cancelled'].map(k=>`<button type="button" role="tab" data-tab="${k}" aria-selected="${view.tab===k}">${k==='all'?T('全部','All'):statusLabel(k)}<span class="count">${events.filter(e=>baseMatch(e)&&typeMatch(e)&&(k==='all'||statusOf(e)===k)).length}</span></button>`).join('');
 $('#ev-sort').textContent=view.desc?T('日期 ↓ 最新','Newest first'):T('日期 ↑ 最早','Oldest first');
 $('#ev-reset').hidden=!(view.q||view.type!=='all'||view.div!=='all'||view.tab!=='all');
 $('#ev-count').textContent=T(`共 ${events.length} 项 · 显示 ${list.length} 项`,`${list.length} of ${events.length} events`);
 const groups=new Map();
 for(const e of list){const key=e.start.slice(0,7);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
 $('#ev-list').innerHTML=[...groups].map(([key,rows])=>{const [y,m]=key.split('-').map(Number);return `<div class="group-head"><strong>${monthLabel(y,m)}</strong><span>${T(`${rows.length} 项`,`${rows.length} events`)}</span></div>${rows.map(rowHtml).join('')}`;}).join('')
  ||`<div class="empty"><strong>${events.length?T('没有符合条件的事件','No matching events'):T('还没有事件','No events yet')}</strong><p>${events.length?T('调整筛选条件，或重置。','Adjust the filters, or reset them.'):T('先添加第一项事件。','Add your first event.')}</p>${events.length?`<button type="button" class="btn btn-secondary" data-act="reset">${T('重置筛选','Reset filters')}</button>`:''}</div>`;
 placeMenu();
}
/* The row menu is fixed-position so the table's horizontal scroll box never clips it. */
function placeMenu(){
 const menu=$('#ev-list .menu');if(!menu)return;
 const anchor=menu.previousElementSibling.getBoundingClientRect(),height=menu.offsetHeight;
 const below=anchor.bottom+4+height<=innerHeight;
 menu.style.left=Math.max(8,anchor.right-menu.offsetWidth)+'px';
 menu.style.top=(below?anchor.bottom+4:Math.max(8,anchor.top-4-height))+'px';
}
const closeMenu=()=>{if(view.menu){view.menu=null;renderResults();}};
addEventListener('resize',closeMenu);
document.addEventListener('scroll',closeMenu,true);
function rowHtml(e){
 const status=statusOf(e),moved=movedLine(e),open=view.menu===e.id;
 // 考试批次事件 mirror a published exam batch and are changed only on the exams page.
 if(e.examBatch)return `<div class="grid-row">
 <div class="num"><div class="cell-main">${esc(dateLine(e))}</div><div class="cell-sub">${esc(timeLine(e))}</div></div>
 <div class="clip"><div style="display:flex;align-items:center;gap:8px;min-width:0"><span class="cell-main clip">${esc(tx(e.title))}</span><span class="tag tag-outline small">${T('来自考试安排','From exams')}</span></div><div class="cell-sub clip">${T('随考试批次发布自动更新','Follows the published exam batch')}</div></div>
 <span style="font-size:13px">${esc(tx(TYPES[e.type]))}</span><span style="font-size:13px">${esc(scopeLine(e))}</span><span class="${statusTag(status)}">${statusLabel(status)}</span>
 <div class="row-actions"><a class="btn btn-ghost" href="#exams/${encodeURIComponent(e.examBatch)}">${T('在考试页管理','Manage in Exams')}</a></div></div>`;
 return `<div class="grid-row">
 <div class="num"><div class="cell-main">${esc(dateLine(e))}</div><div class="cell-sub">${esc(timeLine(e))}</div></div>
 <div class="clip"><div style="display:flex;align-items:center;gap:8px;min-width:0"><span class="cell-main clip${status==='cancelled'?' struck':''}">${esc(tx(e.title))}</span>${moved?`<span class="tag tag-outline small">${esc(moved)}</span>`:''}${repeatTag(e)}</div><div class="cell-sub clip">${esc([e.title[1-app.lang],tx(e.location)].filter(Boolean).join(' · '))}</div></div>
 <span style="font-size:13px">${esc(tx(TYPES[e.type]))}</span><span style="font-size:13px">${esc(scopeLine(e))}</span><span class="${statusTag(status)}">${statusLabel(status)}</span>
 <div class="row-actions"><a class="btn btn-ghost" href="#events/${encodeURIComponent(e.id)}">${T('编辑','Edit')}</a><button type="button" class="btn btn-ghost btn-icon" data-act="menu" data-id="${esc(e.id)}" aria-label="${T('更多','More')}" aria-expanded="${open}" style="color:var(--color-accent)">${icon.more}</button>
 ${open?`<div class="menu" role="menu"><button type="button" role="menuitem" data-act="preview" data-id="${esc(e.id)}">${T('预览','Preview')}</button>${status==='published'?`<button type="button" role="menuitem" data-act="cancel" data-id="${esc(e.id)}">${T('取消事件','Cancel event')}</button>`:''}<button type="button" role="menuitem" class="sep" data-act="delete" data-id="${esc(e.id)}">${T('删除','Delete')}</button></div>`:''}</div></div>`;
}

async function onListClick(event){
 const target=event.target.closest('[data-act],[data-tab]');
 if(target?.dataset.tab){view.tab=target.dataset.tab;renderResults();return;}
 const act=target?.dataset.act,e=target&&app.data.events.find(x=>x.id===target.dataset.id);
 if(act!=='menu'&&view.menu){view.menu=null;if(!act)renderResults();}
 if(act==='menu'){view.menu=view.menu===e.id?null:e.id;renderResults();$(`[data-act=menu][data-id="${CSS.escape(e.id)}"]`)?.focus();}
 else if(act==='refresh'){target.disabled=true;try{await loadEvents();refreshNav();renderResults();toast(T('列表已刷新。','List refreshed.'));}catch(error){toast(error.message,{bad:true});}finally{target.disabled=false;}}
 else if(act==='notice')noticeDialog();
 else if(act==='sort'){view.desc=!view.desc;renderResults();}
 else if(act==='reset'){Object.assign(view,{q:'',type:'all',div:'all',tab:'all'});$('#ev-q').value='';$('#ev-type').value='all';$('#ev-div').value='all';renderResults();}
 else if(act==='preview'){renderResults();previewEvent(e);}
 else if(act==='cancel'||act==='delete'){renderResults();confirmChange(e,act);}
}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&view.menu){view.menu=null;renderResults();}});
document.addEventListener('click',event=>{if(view.menu&&!/** @type {Element} */(event.target).closest('.row-actions'))(view.menu=null,renderResults());});

function previewEvent(e){
 modal(T('学生视图','Student view')+' · '+tx(TYPES[e.type]),`<h2 class="${statusOf(e)==='cancelled'?'struck':''}">${esc(tx(e.title)||'—')}</h2>
 ${e.poster?`<img src="${esc(e.poster)}" alt="${T('事件海报','Event poster')}" style="max-width:100%;max-height:260px;object-fit:contain;align-self:flex-start">`:''}
 <div class="preview-meta"><span>${T('时间','Time')}</span><span>${esc(whenOf(e))}</span><span>${T('地点','Location')}</span><span>${esc(tx(e.location)||'—')}</span><span>${T('适用范围','Audience')}</span><span>${esc(scopeLine(e)||'—')}</span><span>${T('主办方','Organiser')}</span><span>${esc(tx(e.host)||'—')}</span></div>
 ${movedLine(e)?`<p class="callout">${esc(movedLine(e))}</p>`:''}${e.cancelReason?`<p class="callout">${esc(T('取消原因：','Reason: ')+e.cancelReason)}</p>`:''}
 <p class="preview-desc">${esc(tx(e.description))}</p>${e.registrationUrl?`<a href="${esc(e.registrationUrl)}" target="_blank" rel="noopener">${T('报名入口','Registration')} ↗</a>`:''}`,{size:'medium'});
}

function confirmChange(e,action){
 const deleting=action==='delete';
 const body=modal(deleting?T('删除误录事件？','Delete this event?'):T('取消此事件？','Cancel this event?'),`<p class="dialog-text"><strong style="font-weight:500">${esc(tx(e.title))}</strong> — ${deleting?T('确认后会从管理列表和公共校历移除，无法撤销，请仅用于误录事件。','This removes the event from the admin list and public calendar. This cannot be undone; use it only for incorrect entries.'):T('事件将保留在公共校历，标记为已取消，并关闭报名入口。','The event stays public, marked cancelled, with registration disabled.')}${e.repeat?' '+(deleting?T('这会删除该重复事件的全部日期。','This removes every date of the repeating event.'):T('该重复事件的全部日期都会标记为已取消；只取消某一天请在编辑页的“重复日期”中操作。','Every date of the repeating event is marked cancelled. To cancel one date, use “Dates in this series” in the editor.')):''}</p>
 ${deleting?'':`<div class="field"><label for="cancel-reason">${T('取消原因（选填）','Cancellation reason (optional)')}</label><textarea class="input" id="cancel-reason" maxlength="2000" style="min-height:72px"></textarea></div>`}${errorLine}
 <div class="dialog-actions"><button type="button" class="btn btn-secondary" data-close>${T('返回','Go back')}</button><button type="button" class="btn btn-primary" data-go>${deleting?T('确认删除','Delete event'):T('确认取消','Cancel event')}</button></div>`);
 body.querySelector('[data-go]').onclick=()=>busy(body,async()=>{
  const result=await api('/admin/events/'+encodeURIComponent(e.id)+(deleting?'':'/cancel'),{method:deleting?'DELETE':'POST',body:JSON.stringify({version:e.version,reason:body.querySelector('#cancel-reason')?.value.trim()||''})});
  const events=app.data.events,index=events.findIndex(x=>x.id===e.id);
  if(deleting)events.splice(index,1);else events[index]=result;
  closeModal();renderResults();refreshNav();
  toast(deleting?T('事件已删除。','Event deleted.'):T('事件已取消，公共记录已保留。','Event cancelled; the public record is retained.'));
 });
}

/* — editor — */
// One editor serves a whole event (#events/<id>) and a single date of a repeating event (#events/<id>/<date>).
let form=null,formKey='',formVisit=-1,saving=false,datesShown=12,showPast=false;
const PRESETS=()=>[['never',T('不重复','Never')],['daily',T('每天','Every day')],['school',T('每个上学日','Every school day')],['weekly',T('每周','Every week')],['biweekly',T('每两周','Every 2 weeks')],['monthly',T('每月','Every month')],['custom',T('自定义…','Custom…')]];
const WEEKDAY_SHORT=()=>app.lang?['M','T','W','T','F','S','S']:['一','二','三','四','五','六','日'];
const WEEKDAY_NAMES=()=>app.lang?['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']:['周一','周二','周三','周四','周五','周六','周日'];
const sameList=(a,b)=>a.join()===b.join();
/** Which quick choice a stored rule corresponds to, given its start date. */
function presetOf(rule,start){
 if(!rule)return 'never';
 const wd=[weekdayOf(start)],day=[Number(start.slice(8))];
 if(rule.freq==='daily'&&rule.schoolDays)return 'school';
 if(rule.freq==='daily'&&rule.interval===1)return 'daily';
 if(rule.freq==='weekly'&&sameList(rule.weekdays,wd))return rule.interval===1?'weekly':rule.interval===2?'biweekly':'custom';
 if(rule.freq==='monthly'&&rule.interval===1&&rule.monthDays&&sameList(rule.monthDays,day))return 'monthly';
 return 'custom';
}
function formFrom(e){
 const mode=e?(e.timeMode||(e.type==='deadline'?'deadline':isMulti(e)?'multi':e.time?'timed':'allDay')):'timed';
 const pair=(value,i)=>(value||['',''])[i]||'';
 const start=e?.start||app.today,r=e?.repeat;
 return {titleZh:pair(e?.title,0),titleEn:pair(e?.title,1),locZh:pair(e?.location,0),locEn:pair(e?.location,1),hostZh:pair(e?.host,0),hostEn:pair(e?.host,1),descZh:pair(e?.description,0),descEn:pair(e?.description,1),
  type:e?.type||'activity',mode,start,end:e?.end||e?.start||app.today,time:e?.time||'14:00',endTime:e?.endTime||'15:00',scope:[...(e?.scope||['schoolwide'])],grades:[...(e?.grades||[])],dueAllDay:mode==='deadline'&&Boolean(e)&&!e.time,url:e?.registrationUrl||'',poster:e?.poster||'',qr:e?.qr||'',tried:false,
  rep:presetOf(r,start),freq:r?.freq||'weekly',interval:String(r?.interval||1),weekdays:r?.weekdays||[weekdayOf(start)],monthMode:r?.ordinal?'on':'each',monthDays:r?.monthDays||[Number(start.slice(8))],
  ordinal:String(r?.ordinal||(isLastOfMonth(start)?-1:Math.min(4,ordinalOf(start)))),weekday:String(r?.weekday||weekdayOf(start)),
  endMode:r?.until?'until':r?.count?'count':'never',until:r?.until||schoolYearEnd(start),count:String(r?.count||10)};
}
/** The 重复规则 the form describes, or null for a one-off (and always for multi-day events). */
function ruleOf(f=form){
 if(f.rep==='never'||f.mode==='multi')return null;
 const wd=weekdayOf(f.start),day=Number(f.start.slice(8));
 const rule=f.rep==='custom'?{freq:f.freq,interval:Number(f.interval),...(f.freq==='weekly'?{weekdays:[...f.weekdays].sort((a,b)=>a-b)}:{}),...(f.freq==='monthly'?f.monthMode==='each'?{monthDays:[...f.monthDays].sort((a,b)=>a-b)}:{ordinal:Number(f.ordinal),weekday:Number(f.weekday)}:{})}
  :{daily:{freq:'daily',interval:1},school:{freq:'daily',interval:1,schoolDays:true},weekly:{freq:'weekly',interval:1,weekdays:[wd]},biweekly:{freq:'weekly',interval:2,weekdays:[wd]},monthly:{freq:'monthly',interval:1,monthDays:[day]}}[f.rep];
 return {...rule,...(f.endMode==='until'?{until:f.until}:f.endMode==='count'?{count:Number(f.count)}:{})};
}
function repeatError(){
 const f=form,rule=ruleOf();
 if(!rule)return '';
 if(!(Number.isInteger(rule.interval)&&rule.interval>=1&&rule.interval<=99))return T('间隔须为 1–99 的整数。','The interval must be a whole number from 1 to 99.');
 if(f.endMode==='count'&&!(Number.isInteger(rule.count)&&rule.count>=1&&rule.count<=999))return T('次数须为 1–999 的整数。','The number of times must be a whole number from 1 to 999.');
 if(f.endMode==='until'&&!f.until)return T('请选择结束日期。','Choose an end date.');
 const problem=repeatProblem(rule,f.start);
 return problem?({
  'Choose at least one weekday':T('请至少选择一个星期几。','Choose at least one weekday.'),
  'Choose the days of the month':T('请选择每月的日期。','Choose the days of the month.'),
  'The repeat must not end before the start date':T('结束日期不能早于开始日期。','The repeat must not end before the start date.'),
  'The start date must be one of the repeat dates':T('开始日期须是重复日期之一，请调整日期或规则。','The start date must be one of the repeat dates; adjust the date or the rule.')
 }[problem]||problem):'';
}
function checks(){
 const f=form;let url=true;
 if(f.url.trim())try{url=['http:','https:'].includes(new URL(f.url.trim()).protocol);}catch{url=false;}
 return {title:Boolean(f.titleZh.trim()||f.titleEn.trim()),
  time:Boolean(f.start)&&(f.mode==='multi'?f.end>=f.start:f.mode==='timed'?Boolean(f.time&&f.endTime&&f.endTime>=f.time):f.mode==='deadline'?Boolean(f.dueAllDay||f.time):true),
  scope:f.scope.length>0,url,repeat:!$('#rep-summary')||!repeatError()};
}

export async function showEditor(main,id,date){
 if(id!=='new'&&!app.data.events){main.innerHTML=`<p class="loading">${T('正在加载…','Loading…')}</p>`;await loadEvents();}
 if(!app.data.plans)await loadPlans();
 const original=id==='new'?null:app.data.events.find(e=>e.id===id);
 const missing=message=>{main.innerHTML=`<div class="page"><a class="btn btn-ghost back" href="#events">← ${T('事件','Events')}</a><p class="load-error" style="padding:0">${message}</p></div>`;};
 if(id!=='new'&&!original)return missing(T('事件不存在或已被删除。','This event no longer exists.'));
 if(original?.examBatch)return missing(T(`这是考试安排自动生成的事件，请<a href="#exams/${encodeURIComponent(original.examBatch)}">在考试页管理</a>。`,`This event comes from the exam schedule. <a href="#exams/${encodeURIComponent(original.examBatch)}">Manage it under Exams</a>.`));
 // A single date edits its own copy of the series fields; type, time format and audience stay with the series.
 const single=date&&original?.repeat&&seriesDates(original,app.data.plans,date).at(-1)===date?occurrence(original,date):null;
 if(date&&!single)return missing(T('这一天不在该重复事件的日期中。','This date is not part of the repeating event.'));
 const key=id+(date?'/'+date:'');
 if(formKey!==key||formVisit!==app.visit||!form){form=formFrom(single||original);formKey=key;formVisit=app.visit;datesShown=12;showPast=false;}
 const status=original?statusOf(original):'draft';
 const bi=(label,zh,en,area=false)=>`<span class="label${area?' top':''}">${label}</span>${[zh,en].map((k,i)=>area?`<textarea class="input" data-f="${k}" aria-label="${esc(label)} · ${i?'English':'中文'}">${esc(form[k])}</textarea>`:`<input class="input" data-f="${k}" value="${esc(form[k])}" aria-label="${esc(label)} · ${i?'English':'中文'}" maxlength="${k.startsWith('title')?250:300}">`).join('')}`;
 const actions=single?`<button type="button" class="btn btn-primary blueprint" data-save="one">${corners}${T('仅保存此次','Save this date only')}</button><button type="button" class="btn btn-secondary" data-save="future">${T('保存此次及以后','Save this and future dates')}</button>`
  :`<button type="button" class="btn btn-primary blueprint" data-save="published">${corners}${original&&status!=='draft'?T('保存更改','Save changes'):T('发布事件','Publish event')}</button>${!original||status==='draft'?`<button type="button" class="btn btn-secondary" data-save="draft">${T('保存草稿','Save draft')}</button>`:''}`;
 main.innerHTML=`<div class="page">
 <a class="btn btn-ghost back" href="#events${single?'/'+encodeURIComponent(id):''}">← ${single?T('整个重复事件','Whole series'):T('事件','Events')}</a>
 <header class="editor-head"><h1>${single?T('编辑单次日期','Edit one date'):original?T('编辑事件','Edit event'):T('新增事件','New event')}</h1><span class="${statusTag(status)}">${statusLabel(status)}</span><span class="hint">${T(`时间按学校当地时间（${app.config.timeZone}）填写`,`Times in school local time (${app.config.timeZone})`)}</span></header>
 ${single?`<p class="callout">${esc(T(`正在修改重复事件中的一次：${mdw(date)}（${describeRepeat(original.repeat,0)}）。仅保存此次时，其他日期不受影响。`,`Editing one date of a repeating event: ${mdw(date)} (${describeRepeat(original.repeat,1)}). Saving this date only leaves the other dates unchanged.`))}</p>`:''}
 <div class="editor-grid"><div class="editor-main">
  <section class="panel blueprint">${corners}<h4>${T('基本信息','Event information')}</h4><div class="bi-grid"><span class="spacer"></span><span class="col-head">中文</span><span class="col-head">English</span>
   ${bi(T('名称 *','Title *'),'titleZh','titleEn')}<p class="error" id="err-title"></p>${bi(T('地点','Location'),'locZh','locEn')}${bi(T('主办方','Organiser'),'hostZh','hostEn')}${bi(T('说明','Description'),'descZh','descEn',true)}</div></section>
  <section class="panel blueprint">${corners}<h4>${T('时间与适用范围','Time and audience')}</h4><div class="form-grid" id="ed-time"></div></section>
  ${original?.repeat&&!single?`<section class="panel blueprint">${corners}<h4>${T('重复日期','Dates in this series')}</h4><p class="hint" style="margin:0 0 10px">${T('单独修改、取消或删除某一天，不影响其他日期。“本次取消”的日期仍显示在校历上并注明取消。','Change, cancel or delete one date without touching the others. A date cancelled this time stays on the calendar, marked cancelled.')}</p><div id="ed-dates"></div></section>`:''}
  <section class="panel blueprint">${corners}<h4>${T('海报与报名入口','Poster and registration')}</h4><div class="media-grid" id="ed-media"></div>
   <div class="form-grid" style="margin-top:14px"><label class="label" for="ed-url">${T('报名链接','Registration URL')}</label><input class="input" id="ed-url" type="url" data-f="url" value="${esc(form.url)}" placeholder="https://" maxlength="2048"><p class="error" id="err-url"></p></div>
   <p class="hint">${T('报名由外部渠道承办，本网站不保存报名信息。','Registration is handled externally; this site stores no sign-ups.')}</p></section>
 </div>
 <aside class="side-panel blueprint">${corners}<div class="kicker">${T('发布之前','Before publishing')}</div><div class="checks" id="ed-checks"></div><p class="alert bad" role="alert" id="ed-error" hidden></p>
  <div class="stack">${actions}<button type="button" class="btn btn-secondary" data-ed-preview>${T('预览','Preview')}</button></div>
  <p class="note">${single?T('“此次及以后”会从这一天起拆分为新的重复事件，之前的日期保持不变。','“This and future” splits the series from this date; earlier dates stay as they are.'):T('草稿仅管理员可见。发布后对所有访客可见，无需审核。','Drafts are admin-only. Published events are visible to everyone; no approval needed.')}</p></aside>
 </div></div>`;
 const ctx={main,id,date,original,single};
 renderTime(ctx);renderMedia();renderDates(ctx);updateChecks();
 const page=main.querySelector('.page');
 page.oninput=e=>{const key=e.target.dataset.f;if(!key)return;form[key]=e.target.value;app.dirty=true;updateChecks();};
 page.onchange=e=>{if(['start','ordinal','weekday'].includes(e.target.dataset.f))renderTime(ctx),updateChecks();};
 page.onclick=e=>{
  const b=e.target.closest('button');if(!b)return;
  const toggle=(list,value)=>list.includes(value)?list.filter(x=>x!==value):[...list,value];
  if(b.dataset.type){form.type=b.dataset.type;form.mode=form.type==='deadline'?'deadline':form.mode==='deadline'?'timed':form.mode;}
  else if(b.dataset.mode){form.mode=b.dataset.mode;if(form.mode==='deadline')form.type='deadline';else if(form.type==='deadline')form.type='activity';}
  else if(b.dataset.scope){const k=b.dataset.scope,on=form.scope.includes(k);form.scope=on?form.scope.filter(x=>x!==k):k==='schoolwide'?['schoolwide']:[...form.scope.filter(x=>x!=='schoolwide'),k];form.grades=normalizeGrades(form.scope,form.grades);}
  else if(b.dataset.grade){
   // No grades listed means the whole division; at least one grade of a chosen division stays on.
   const g=Number(b.dataset.grade),all=DIVISION_GRADES[b.dataset.division],chosen=all.filter(x=>form.grades.includes(x)),on=chosen.length?chosen:all;
   const next=on.includes(g)?on.filter(x=>x!==g):[...on,g];
   if(!next.length)return;
   form.grades=normalizeGrades(form.scope,[...form.grades.filter(x=>!all.includes(x)),...next]);
  }
  else if(b.dataset.dueAllDay!==undefined)form.dueAllDay=!form.dueAllDay;
  else if(b.dataset.rep){
   // Custom starts from the quick choice it replaces, so switching never loses the current pattern.
   if(b.dataset.rep==='custom'&&form.rep!=='custom'){const rule=ruleOf();if(rule&&!rule.schoolDays)Object.assign(form,{freq:rule.freq,interval:String(rule.interval),weekdays:rule.weekdays||form.weekdays,monthDays:rule.monthDays||form.monthDays,monthMode:'each'});}
   form.rep=b.dataset.rep;
  }
  else if(b.dataset.freq)form.freq=b.dataset.freq;
  else if(b.dataset.wd)form.weekdays=toggle(form.weekdays,Number(b.dataset.wd));
  else if(b.dataset.monthMode)form.monthMode=b.dataset.monthMode;
  else if(b.dataset.md)form.monthDays=toggle(form.monthDays,Number(b.dataset.md));
  else if(b.dataset.endMode)form.endMode=b.dataset.endMode;
  else if(b.dataset.endQuick){form.endMode='until';form.until=b.dataset.endQuick==='school'?schoolYearEnd(form.start):`${Number(form.start.slice(0,4))+1}${form.start.slice(4)}`;}
  else if(b.dataset.remove){form[b.dataset.remove]='';app.dirty=true;renderMedia();return;}
  else if(b.dataset.save){save(b.dataset.save,ctx);return;}
  else if(b.hasAttribute('data-ed-preview')){previewEvent({...toEvent(),id:'',version:0});return;}
  else if(b.dataset.dateAct){dateAction(b.dataset.dateAct,b.dataset.date,ctx);return;}
  else if(b.dataset.more){if(b.dataset.more==='past')showPast=true;else datesShown+=24;renderDates(ctx);return;}
  else return;
  app.dirty=true;renderTime(ctx);updateChecks();
 };
}

function renderTime({single}){
 const f=form,seg=(attr,items,value,locked=false)=>`<div class="seg">${items.map(([k,label])=>`<button type="button" data-${attr}="${k}" aria-pressed="${value===k}"${locked?' disabled':''}>${label}</button>`).join('')}</div>`;
 const unit={daily:T('天','day(s)'),weekly:T('周','week(s)'),monthly:T('个月','month(s)')}[f.freq];
 const custom=f.rep!=='custom'?'':`<span class="label">${T('自定义','Custom')}</span><div class="repeat-custom">
   <div class="inline">${seg('freq',[['daily',T('按天','Daily')],['weekly',T('按周','Weekly')],['monthly',T('按月','Monthly')]],f.freq)}<label class="inline">${T('每','Every')}<input class="input" type="number" min="1" max="99" data-f="interval" value="${esc(f.interval)}" style="width:72px" aria-label="${T('间隔','Interval')}">${unit}</label></div>
   ${f.freq==='weekly'?`<div class="chips" role="group" aria-label="${T('星期几','Weekdays')}">${WEEKDAY_SHORT().map((d,i)=>`<button type="button" class="chip plain day-toggle" data-wd="${i+1}" aria-pressed="${f.weekdays.includes(i+1)}" aria-label="${WEEKDAY_NAMES()[i]}">${d}</button>`).join('')}</div>`:''}
   ${f.freq==='monthly'?`${seg('month-mode',[['each',T('按日期','Each')],['on',T('按星期','On the')]],f.monthMode)}
    ${f.monthMode==='each'?`<div class="month-days" role="group" aria-label="${T('每月日期','Days of the month')}">${Array.from({length:31},(_,i)=>`<button type="button" data-md="${i+1}" aria-pressed="${f.monthDays.includes(i+1)}">${i+1}</button>`).join('')}</div>`
     :`<div class="inline"><select class="input" data-f="ordinal" aria-label="${T('第几个','Which')}">${[[1,T('第一个','First')],[2,T('第二个','Second')],[3,T('第三个','Third')],[4,T('第四个','Fourth')],[-1,T('最后一个','Last')]].map(([v,l])=>`<option value="${v}"${String(v)===f.ordinal?' selected':''}>${l}</option>`).join('')}</select><select class="input" data-f="weekday" aria-label="${T('星期几','Weekday')}">${WEEKDAY_NAMES().map((d,i)=>`<option value="${i+1}"${String(i+1)===f.weekday?' selected':''}>${d}</option>`).join('')}</select></div>`}`:''}
  </div>`;
 const ending=f.rep==='never'?'':`<span class="label">${T('结束重复','End repeat')}</span><div class="inline">${seg('end-mode',[['never',T('永不','Never')],['until',T('于日期','On date')],['count',T('重复次数','After')]],f.endMode)}
  ${f.endMode==='until'?`<input class="input" type="date" data-f="until" value="${esc(f.until)}" min="${esc(f.start)}" aria-label="${T('结束日期','End date')}">`:''}
  ${f.endMode==='count'?`<label class="inline"><input class="input" type="number" min="1" max="999" data-f="count" value="${esc(f.count)}" style="width:80px" aria-label="${T('次数','Times')}">${T('次','times')}</label>`:''}
  <button type="button" class="btn btn-ghost" data-end-quick="school">${T('至本学年结束','End of this school year')}</button><button type="button" class="btn btn-ghost" data-end-quick="year">${T('一年后','In 1 year')}</button></div>`;
 $('#ed-time').innerHTML=`<span class="label">${T('类型 *','Type *')}</span>${seg('type',Object.keys(TYPES).map(k=>[k,tx(TYPES[k])]),f.type,Boolean(single))}
 <span class="label">${T('时间形式 *','Time format *')}</span>${seg('mode',[['timed',T('定时','Timed')],['allDay',T('全天','All day')],...(single?[]:[['multi',T('跨日（全天）','Multiple days')]]),['deadline',T('截止时间','Deadline')]],f.mode,Boolean(single))}
 <span class="label">${T('日期与时间 *','Date & time *')}</span><div class="inline"><input class="input" type="date" data-f="start" value="${esc(f.start)}" aria-label="${f.mode==='multi'?T('开始日期','Start date'):T('日期','Date')}">
  ${f.mode==='multi'?`<span class="muted">–</span><input class="input" type="date" data-f="end" value="${esc(f.end)}" min="${esc(f.start)}" aria-label="${T('结束日期','End date')}">`:''}
  ${f.mode==='timed'||(f.mode==='deadline'&&!f.dueAllDay)?`<span style="width:10px"></span><input class="input" type="time" data-f="time" value="${esc(f.time)}" aria-label="${f.mode==='deadline'?T('截止时间','Due time'):T('开始时间','Start time')}">`:''}
  ${f.mode==='deadline'?`<button type="button" class="chip plain" data-due-all-day aria-pressed="${f.dueAllDay}">${T('全天（当天内截止）','All day (due by end of day)')}</button>`:''}
  ${f.mode==='timed'?`<span class="muted">–</span><input class="input" type="time" data-f="endTime" value="${esc(f.endTime)}" aria-label="${T('结束时间','End time')}">`:''}</div><p class="error" id="err-time"></p>
 ${single?'':f.mode==='multi'?`<span class="label">${T('重复','Repeat')}</span><p class="hint" style="margin:0">${T('跨日事件不能重复。','Multi-day events cannot repeat.')}</p>`:`<span class="label">${T('重复','Repeat')}</span><div class="chips" role="group" aria-label="${T('重复','Repeat')}">${PRESETS().map(([k,label])=>`<button type="button" class="chip plain" data-rep="${k}" aria-pressed="${f.rep===k}">${label}</button>`).join('')}</div>
 ${custom}${ending}<p class="hint repeat-summary" id="rep-summary"></p><p class="error" id="err-repeat"></p>`}
 <span class="label">${T('适用范围 *','Audience *')}</span><div class="audience-pick"><div class="chips">${Object.keys(SCOPES).map(k=>`<button type="button" class="chip" data-scope="${k}" aria-pressed="${f.scope.includes(k)}"${single?' disabled':''}>${tx(SCOPES[k])}</button>`).join('')}</div>
 ${f.scope.filter(k=>DIVISION_GRADES[k]).map(k=>{const all=DIVISION_GRADES[k],chosen=all.filter(g=>f.grades.includes(g));return `<div class="chips grade-chips" role="group" aria-label="${esc(tx(SCOPES[k]))} · ${T('年级','Grades')}"><span class="muted grade-chips-label">${esc(tx(SCOPES[k]))}</span>${all.map(g=>`<button type="button" class="chip plain" data-grade="${g}" data-division="${k}" aria-pressed="${!chosen.length||chosen.includes(g)}"${single?' disabled':''}>${gradeLabel(g,app.lang)}</button>`).join('')}</div>`;}).join('')}
 ${f.scope.some(k=>DIVISION_GRADES[k])?`<p class="hint" style="margin:0">${T('默认面向整个学部；取消勾选某年级即不面向该年级。','The whole division by default; untick a grade to leave it out.')}</p>`:''}</div><p class="error" id="err-scope"></p>`;
}

/** The series' dates with their own state; past dates stay folded away until asked for. */
function renderDates({id,original}){
 const box=$('#ed-dates');if(!box)return;
 const plans=app.data.plans,horizon=lastDate(original,plans)||schoolYearEnd(app.today,1);
 const all=seriesDates(original,plans,horizon),past=all.filter(d=>d<app.today),upcoming=all.filter(d=>d>=app.today);
 const list=[...(showPast?past:[]),...upcoming.slice(0,datesShown)];
 const published=original.status==='published'&&!original.cancelled;
 const row=date=>{
  const own=original.exceptions?.[date],item=occurrence(original,date),changed=own&&Object.keys(own).some(k=>!['cancelled','cancelReason','deleted'].includes(k));
  const tags=[own?.deleted?`<span class="tag tag-neutral small">${T('已删除','Deleted')}</span>`:'',item.cancelledOnce?`<span class="tag tag-neutral small">${T('本次取消','Cancelled this time')}</span>`:'',
   !own?.deleted&&item.oldDate?`<span class="tag tag-outline small">${esc(T(`改至 ${mdw(item.start)}`,`Moved to ${mdw(item.start)}`))}</span>`:!own?.deleted&&changed?`<span class="tag tag-outline small">${T('已单独修改','Changed')}</span>`:''].join('');
  const act=(name,label)=>`<button type="button" class="btn btn-ghost" data-date-act="${name}" data-date="${date}">${label}</button>`;
  return `<div class="date-row${own?.deleted||item.cancelled?' struck-row':''}"><div><span class="cell-main">${esc(mdw(date))}</span><span class="cell-sub"> · ${esc(timeLine(item))}</span></div><div class="date-tags">${tags}</div>
   <div class="row-actions">${own?.deleted?'':`<a class="btn btn-ghost" href="#events/${encodeURIComponent(id)}/${date}">${T('编辑此次','Edit')}</a>${published&&!item.cancelledOnce?act('cancel',T('取消…','Cancel…')):''}${act('delete',T('删除此次','Delete'))}`}${own?act('restore',T('恢复','Restore')):''}</div></div>`;
 };
 box.innerHTML=(past.length&&!showPast?`<button type="button" class="btn btn-ghost" data-more="past">${T(`显示过去的 ${past.length} 个日期`,`Show ${past.length} past dates`)}</button>`:'')
  +(list.map(row).join('')||`<p class="hint">${T('没有即将到来的日期。','No upcoming dates.')}</p>`)
  +(upcoming.length>datesShown?`<button type="button" class="btn btn-ghost" data-more="later">${T('显示更多日期','Show more dates')}</button>`:'')
  +(lastDate(original,plans)?'':`<p class="hint">${T('永不结束，此处列至下一学年结束。','Never ends; dates are listed to the end of next school year.')}</p>`);
}

/** Cancels, deletes or restores one date, then reloads the editor with the series' new version. */
function dateAction(action,date,{main,id,original}){
 const path='/admin/events/'+encodeURIComponent(id);
 const done=async(result,message)=>{
  if(result?.id===id){const events=app.data.events;events[events.findIndex(e=>e.id===id)]=result;}else await loadEvents();
  closeModal();refreshNav();toast(message);
  if(app.data.events.some(e=>e.id===id))showEditor(main,id);else go('events');
 };
 if(action==='restore'){
  api(path+'/restore',{method:'POST',body:JSON.stringify({version:original.version,occurrence:{date}})}).then(result=>done(result,T('这一天已恢复为系列设置。','This date follows the series again.')),error=>toast(error.message,{bad:true}));
  return;
 }
 const deleting=action==='delete';
 const body=modal(deleting?T('删除这一天？','Delete this date?'):T('取消这一天？','Cancel this date?'),`<p class="dialog-text"><strong style="font-weight:500">${esc(tx(original.title))}</strong> · ${esc(mdw(date))} — ${deleting?T('这一天将从校历和日历订阅中移除，学生不会看到取消提示。请仅用于误录的日期；之后可在“重复日期”中恢复。','This date is removed from the calendar and subscriptions without a cancellation notice. Use it for dates added by mistake; you can restore it later under “Dates in this series”.'):T('“仅此次”会在校历上保留这一天并标注“本次取消”；其他日期照常。','“This date only” keeps the date on the calendar marked “Cancelled this time”; the other dates go ahead.')}</p>
 ${deleting?'':`<div class="field"><span class="label">${T('取消范围','Which dates')}</span><div class="seg" role="radiogroup"><button type="button" data-span="one" aria-pressed="true">${T('仅此次','This date only')}</button><button type="button" data-span="future" aria-pressed="false">${T('此次及以后','This and future dates')}</button></div></div>
 <div class="field"><label for="cancel-reason">${T('取消原因（选填）','Cancellation reason (optional)')}</label><textarea class="input" id="cancel-reason" maxlength="2000" style="min-height:72px"></textarea></div>`}${errorLine}
 <div class="dialog-actions"><button type="button" class="btn btn-secondary" data-close>${T('返回','Go back')}</button><button type="button" class="btn btn-primary" data-go>${deleting?T('删除这一天','Delete date'):T('确认取消','Cancel date')}</button></div>`);
 let span='one';
 body.querySelectorAll('[data-span]').forEach(b=>b.onclick=()=>{span=b.dataset.span;body.querySelectorAll('[data-span]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));});
 body.querySelector('[data-go]').onclick=()=>busy(body,async()=>{
  const result=await api(path+(deleting?'':'/cancel'),{method:deleting?'DELETE':'POST',body:JSON.stringify({version:original.version,reason:body.querySelector('#cancel-reason')?.value.trim()||'',occurrence:{date,span}})});
  await done(result,deleting?T('这一天已删除。','The date was deleted.'):span==='one'?T('这一天已标记为本次取消。','The date is marked cancelled this time.'):T('这一天及以后的日期已取消。','This and the following dates are cancelled.'));
 });
}

function renderMedia(){
 $('#ed-media').innerHTML=[['poster',T('事件海报','Event poster'),T('拖入海报 · PNG / JPEG / WebP ≤ 5 MB','Drop poster · PNG / JPEG / WebP ≤ 5 MB')],['qr',T('报名二维码','Registration QR'),T('拖入二维码图片','Drop QR image')]].map(([key,label,hint])=>`<div class="field"><span class="label" style="font-size:13px;margin-bottom:6px">${label}</span>
 <label class="dropzone" data-drop="${key}">${form[key]?`<img src="${esc(form[key])}" alt="${esc(label)}">`:`<span>${hint}<br>${T('或点击选择文件','or click to choose a file')}</span>`}<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="${key}" aria-label="${esc(label)}"></label>
 <div class="media-foot"><span class="error" id="err-${key}"></span>${form[key]?`<button type="button" class="btn btn-ghost" data-remove="${key}">${T('移除图片','Remove image')}</button>`:''}</div></div>`).join('');
 $$('[data-upload]').forEach(input=>input.onchange=()=>{upload(input.dataset.upload,input.files[0]);input.value='';});
 $$('[data-drop]').forEach(zone=>{
  zone.ondragover=e=>{e.preventDefault();zone.classList.add('over');};
  zone.ondragleave=()=>zone.classList.remove('over');
  zone.ondrop=e=>{e.preventDefault();zone.classList.remove('over');upload(zone.dataset.drop,e.dataTransfer.files[0]);};
 });
}
async function upload(key,file){
 if(!file)return;
 const error=$('#err-'+key),zone=$(`[data-drop=${key}]`);
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)){error.textContent=T('请上传 PNG、JPEG 或 WebP 图片。','Please upload a PNG, JPEG or WebP image.');return;}
 if(file.size>5*1024*1024){error.textContent=T('图片不能超过 5 MB。','Image must not exceed 5 MB.');return;}
 error.textContent='';zone.querySelector('span,img')?.replaceWith(Object.assign(document.createElement('span'),{textContent:T('正在上传…','Uploading…')}));
 try{const result=await api('/admin/media',{method:'POST',body:file,headers:{'Content-Type':file.type}});form[key]=result.url;app.dirty=true;renderMedia();}
 catch(e){renderMedia();$('#err-'+key).textContent=e.message;}
}

function updateChecks(){
 const ok=checks();
 $('#ed-checks').innerHTML=[[ok.title,T('至少一种语言的名称','Title in at least one language')],[ok.time,T('时间有效','Valid date and time')],[ok.scope,T('已选择适用范围','Audience selected')],[ok.url,T('报名链接为 HTTP / HTTPS','Registration URL is HTTP/HTTPS')],...($('#rep-summary')?[[ok.repeat,T('重复规则有效','Valid repeat rule')]]:[])].map(([pass,label])=>`<div class="${pass?'ok':'bad'}">${label}</div>`).join('');
 if($('#rep-summary')){const rule=ruleOf();$('#rep-summary').textContent=rule&&ok.repeat?describeRepeat(rule,app.lang):'';$('#err-repeat').textContent=rule?repeatError():'';}
 if(!form.tried)return;
 $('#err-title').textContent=ok.title?'':T('至少填写一种语言的事件名称。','Enter a title in at least one language.');
 $('#err-time').textContent=ok.time?'':T('请填写完整时间，结束不能早于开始。','Complete the time; end must not precede start.');
 $('#err-scope').textContent=ok.scope?'':T('请选择至少一个适用范围。','Select at least one audience.');
 $('#err-url').textContent=ok.url?'':T('请输入完整的 HTTP 或 HTTPS 链接。','Enter a complete HTTP or HTTPS URL.');
 $$('[data-f=titleZh],[data-f=titleEn]').forEach(el=>el.setAttribute('aria-invalid',String(!ok.title)));
 $('#ed-url').setAttribute('aria-invalid',String(!ok.url));
}

function toEvent(){
 const f=form,trim=(a,b)=>[f[a].trim(),f[b].trim()];
 return {title:trim('titleZh','titleEn'),type:f.type,timeMode:f.mode,start:f.start,end:f.mode==='multi'?f.end:undefined,time:f.mode==='timed'||(f.mode==='deadline'&&!f.dueAllDay)?f.time:undefined,endTime:f.mode==='timed'?f.endTime:undefined,
  scope:f.scope,grades:normalizeGrades(f.scope,f.grades),location:trim('locZh','locEn'),host:trim('hostZh','hostEn'),description:trim('descZh','descEn'),poster:f.poster,qr:f.qr,registrationUrl:f.url.trim(),repeat:ruleOf()};
}
async function save(action,{id,date,original,single}){
 if(saving)return;
 form.tried=true;updateChecks();
 const error=$('#ed-error');error.hidden=true;
 if(!Object.values(checks()).every(Boolean)){error.textContent=T('请先完成检查项再保存。','Fix the highlighted items before saving.');error.hidden=false;$('[aria-invalid=true]')?.focus();return;}
 saving=true;const buttons=$$('.side-panel button');buttons.forEach(b=>b.disabled=true);
 try{
  // A single date keeps the series' rule and status; "future" starts a new series from this date.
  const body=single?{...toEvent(),repeat:original.repeat,status:original.status,version:original.version,occurrence:{date,span:action}}
   :{...toEvent(),status:original?.cancelled?'cancelled':action,version:original?.version};
  const saved=await api('/admin/events'+(original?'/'+encodeURIComponent(original.id):''),{method:original?'PUT':'POST',body:JSON.stringify(body)});
  if(single&&action==='future')await loadEvents();
  else{const events=app.data.events||[],index=events.findIndex(e=>e.id===saved.id);if(index<0)events.push(saved);else events[index]=saved;app.data.events=events;}
  form=null;formKey='';refreshNav();go(single&&action==='one'?'events/'+encodeURIComponent(id):'events');
  toast(single?action==='one'?T('这一天已单独保存，其他日期不变。','Saved for this date; the other dates are unchanged.'):T('已从这一天起保存为新的重复事件。','Saved from this date on as a new repeating event.')
   :saved.status==='draft'?T('草稿已保存，仅管理员可见。','Draft saved. Only visible to administrators.'):T('事件已保存，公共校历已更新。','Event saved. The public calendar is updated.'));
 }catch(e){
  error.textContent=e.message+(e.fields?.length?'\n'+e.fields.map(item=>`${item.field}: ${item.message}`).join('\n'):'');error.style.whiteSpace='pre-line';error.hidden=false;
 }finally{saving=false;buttons.forEach(b=>b.isConnected&&(b.disabled=false));}
}
