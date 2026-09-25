import {$,$$,esc,corners,icon,app,T,tx,TYPES,SCOPES,api,toast,modal,closeModal,busy,errorLine,go,refreshNav,md,mdw,dateRange,monthLabel,statusOf,statusTag,statusLabel,loadEvents} from './console-core.js';

const view={tab:'all',q:'',type:'all',div:'all',desc:false,menu:null};
const isMulti=e=>Boolean(e.end&&e.end!==e.start);
const dateLine=e=>isMulti(e)?dateRange(e.start,e.end):mdw(e.start);
const timeLine=e=>e.time?(e.type==='deadline'?T('截止 ','Due '):'')+e.time+(e.endTime?'–'+e.endTime:''):isMulti(e)?T('跨日 · 全天','Multiple days · all day'):T('全天','All day');
const scopeLine=e=>e.scope.map(s=>tx(SCOPES[s])).join(app.lang?' / ':'、');
const movedLine=e=>e.oldDate?T(`改期 · 原 ${md(e.oldDate)}`,`Moved from ${md(e.oldDate)}`):'';
const whenOf=e=>`${dateLine(e)} · ${timeLine(e)}`;

export async function showEvents(main){
 if(!app.data.events){main.innerHTML=`<p class="loading">${T('正在加载事件…','Loading events…')}</p>`;await loadEvents();}
 main.innerHTML=`<div class="page">
 <header class="page-head"><div><div class="kicker">${T('管理后台','Admin console')}</div><h1>${T('事件','Events')}</h1><p class="sub">${T('全部学部 · 无需审核，直接发布','All divisions · Publish without approval')}</p></div>
 <div class="page-actions"><button type="button" class="btn btn-secondary" data-act="refresh">${T('刷新','Refresh')}</button><a class="btn btn-primary blueprint" href="#events/new">${corners}${icon.plus}${T('新增事件','New event')}</a></div></header>
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
 return `<div class="grid-row">
 <div class="num"><div class="cell-main">${esc(dateLine(e))}</div><div class="cell-sub">${esc(timeLine(e))}</div></div>
 <div class="clip"><div style="display:flex;align-items:center;gap:8px;min-width:0"><span class="cell-main clip${status==='cancelled'?' struck':''}">${esc(tx(e.title))}</span>${moved?`<span class="tag tag-outline small">${esc(moved)}</span>`:''}</div><div class="cell-sub clip">${esc([e.title[1-app.lang],tx(e.location)].filter(Boolean).join(' · '))}</div></div>
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
 const body=modal(deleting?T('删除误录事件？','Delete this event?'):T('取消此事件？','Cancel this event?'),`<p class="dialog-text"><strong style="font-weight:500">${esc(tx(e.title))}</strong> — ${deleting?T('确认后会从管理列表和公共校历移除，无法撤销，请仅用于误录事件。','This removes the event from the admin list and public calendar. This cannot be undone; use it only for incorrect entries.'):T('事件将保留在公共校历，标记为已取消，并关闭报名入口。','The event stays public, marked cancelled, with registration disabled.')}</p>
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
let form=null,formKey='',formVisit=-1,saving=false;
function formFrom(e){
 const mode=e?(e.timeMode||(e.type==='deadline'?'deadline':isMulti(e)?'multi':e.time?'timed':'allDay')):'timed';
 const pair=(value,i)=>(value||['',''])[i]||'';
 return {titleZh:pair(e?.title,0),titleEn:pair(e?.title,1),locZh:pair(e?.location,0),locEn:pair(e?.location,1),hostZh:pair(e?.host,0),hostEn:pair(e?.host,1),descZh:pair(e?.description,0),descEn:pair(e?.description,1),
  type:e?.type||'activity',mode,start:e?.start||app.today,end:e?.end||e?.start||app.today,time:e?.time||'14:00',endTime:e?.endTime||'15:00',scope:[...(e?.scope||['schoolwide'])],url:e?.registrationUrl||'',poster:e?.poster||'',qr:e?.qr||'',tried:false};
}
function checks(){
 const f=form;let url=true;
 if(f.url.trim())try{url=['http:','https:'].includes(new URL(f.url.trim()).protocol);}catch{url=false;}
 return {title:Boolean(f.titleZh.trim()||f.titleEn.trim()),
  time:Boolean(f.start)&&(f.mode==='multi'?f.end>=f.start:f.mode==='timed'?Boolean(f.time&&f.endTime&&f.endTime>=f.time):f.mode==='deadline'?Boolean(f.time):true),
  scope:f.scope.length>0,url};
}

export async function showEditor(main,id){
 if(id!=='new'&&!app.data.events){main.innerHTML=`<p class="loading">${T('正在加载…','Loading…')}</p>`;await loadEvents();}
 const original=id==='new'?null:app.data.events.find(e=>e.id===id);
 if(id!=='new'&&!original){main.innerHTML=`<div class="page"><a class="btn btn-ghost back" href="#events">← ${T('事件','Events')}</a><p class="load-error" style="padding:0">${T('事件不存在或已被删除。','This event no longer exists.')}</p></div>`;return;}
 if(formKey!==id||formVisit!==app.visit||!form){form=formFrom(original);formKey=id;formVisit=app.visit;}
 const status=original?statusOf(original):'draft';
 const bi=(label,zh,en,area=false)=>`<span class="label${area?' top':''}">${label}</span>${[zh,en].map((k,i)=>area?`<textarea class="input" data-f="${k}" aria-label="${esc(label)} · ${i?'English':'中文'}">${esc(form[k])}</textarea>`:`<input class="input" data-f="${k}" value="${esc(form[k])}" aria-label="${esc(label)} · ${i?'English':'中文'}" maxlength="${k.startsWith('title')?250:300}">`).join('')}`;
 main.innerHTML=`<div class="page">
 <a class="btn btn-ghost back" href="#events">← ${T('事件','Events')}</a>
 <header class="editor-head"><h1>${original?T('编辑事件','Edit event'):T('新增事件','New event')}</h1><span class="${statusTag(status)}">${statusLabel(status)}</span><span class="hint">${T(`时间按学校当地时间（${app.config.timeZone}）填写`,`Times in school local time (${app.config.timeZone})`)}</span></header>
 <div class="editor-grid"><div class="editor-main">
  <section class="panel blueprint">${corners}<h4>${T('基本信息','Event information')}</h4><div class="bi-grid"><span class="spacer"></span><span class="col-head">中文</span><span class="col-head">English</span>
   ${bi(T('名称 *','Title *'),'titleZh','titleEn')}<p class="error" id="err-title"></p>${bi(T('地点','Location'),'locZh','locEn')}${bi(T('主办方','Organiser'),'hostZh','hostEn')}${bi(T('说明','Description'),'descZh','descEn',true)}</div></section>
  <section class="panel blueprint">${corners}<h4>${T('时间与适用范围','Time and audience')}</h4><div class="form-grid" id="ed-time"></div></section>
  <section class="panel blueprint">${corners}<h4>${T('海报与报名入口','Poster and registration')}</h4><div class="media-grid" id="ed-media"></div>
   <div class="form-grid" style="margin-top:14px"><label class="label" for="ed-url">${T('报名链接','Registration URL')}</label><input class="input" id="ed-url" type="url" data-f="url" value="${esc(form.url)}" placeholder="https://" maxlength="2048"><p class="error" id="err-url"></p></div>
   <p class="hint">${T('报名由外部渠道承办，本网站不保存报名信息。','Registration is handled externally; this site stores no sign-ups.')}</p></section>
 </div>
 <aside class="side-panel blueprint">${corners}<div class="kicker">${T('发布之前','Before publishing')}</div><div class="checks" id="ed-checks"></div><p class="alert bad" role="alert" id="ed-error" hidden></p>
  <div class="stack"><button type="button" class="btn btn-primary blueprint" data-save="published">${corners}${original&&status!=='draft'?T('保存更改','Save changes'):T('发布事件','Publish event')}</button>${!original||status==='draft'?`<button type="button" class="btn btn-secondary" data-save="draft">${T('保存草稿','Save draft')}</button>`:''}<button type="button" class="btn btn-secondary" data-ed-preview>${T('预览','Preview')}</button></div>
  <p class="note">${T('草稿仅管理员可见。发布后对所有访客可见，无需审核。','Drafts are admin-only. Published events are visible to everyone; no approval needed.')}</p></aside>
 </div></div>`;
 renderTime();renderMedia();updateChecks();
 const page=main.querySelector('.page');
 page.oninput=e=>{const key=e.target.dataset.f;if(!key)return;form[key]=e.target.value;app.dirty=true;updateChecks();};
 page.onclick=e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.type){form.type=b.dataset.type;form.mode=form.type==='deadline'?'deadline':form.mode==='deadline'?'timed':form.mode;}
  else if(b.dataset.mode){form.mode=b.dataset.mode;if(form.mode==='deadline')form.type='deadline';else if(form.type==='deadline')form.type='activity';}
  else if(b.dataset.scope){const k=b.dataset.scope,on=form.scope.includes(k);form.scope=on?form.scope.filter(x=>x!==k):k==='schoolwide'?['schoolwide']:[...form.scope.filter(x=>x!=='schoolwide'),k];}
  else if(b.dataset.remove){form[b.dataset.remove]='';app.dirty=true;renderMedia();return;}
  else if(b.dataset.save){save(b.dataset.save,original);return;}
  else if(b.hasAttribute('data-ed-preview')){previewEvent({...toEvent(),id:'',version:0});return;}
  else return;
  app.dirty=true;renderTime();updateChecks();
 };
}

function renderTime(){
 const f=form,seg=(attr,items,value)=>`<div class="seg">${items.map(([k,label])=>`<button type="button" data-${attr}="${k}" aria-pressed="${value===k}">${label}</button>`).join('')}</div>`;
 $('#ed-time').innerHTML=`<span class="label">${T('类型 *','Type *')}</span>${seg('type',Object.keys(TYPES).map(k=>[k,tx(TYPES[k])]),f.type)}
 <span class="label">${T('时间形式 *','Time format *')}</span>${seg('mode',[['timed',T('定时','Timed')],['allDay',T('全天','All day')],['multi',T('跨日（全天）','Multiple days')],['deadline',T('截止时间','Deadline')]],f.mode)}
 <span class="label">${T('日期与时间 *','Date & time *')}</span><div class="inline"><input class="input" type="date" data-f="start" value="${esc(f.start)}" aria-label="${f.mode==='multi'?T('开始日期','Start date'):T('日期','Date')}">
  ${f.mode==='multi'?`<span class="muted">–</span><input class="input" type="date" data-f="end" value="${esc(f.end)}" min="${esc(f.start)}" aria-label="${T('结束日期','End date')}">`:''}
  ${['timed','deadline'].includes(f.mode)?`<span style="width:10px"></span><input class="input" type="time" data-f="time" value="${esc(f.time)}" aria-label="${f.mode==='deadline'?T('截止时间','Due time'):T('开始时间','Start time')}">`:''}
  ${f.mode==='timed'?`<span class="muted">–</span><input class="input" type="time" data-f="endTime" value="${esc(f.endTime)}" aria-label="${T('结束时间','End time')}">`:''}</div><p class="error" id="err-time"></p>
 <span class="label">${T('适用范围 *','Audience *')}</span><div class="chips">${Object.keys(SCOPES).map(k=>`<button type="button" class="chip" data-scope="${k}" aria-pressed="${f.scope.includes(k)}">${tx(SCOPES[k])}</button>`).join('')}</div><p class="error" id="err-scope"></p>`;
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
 $('#ed-checks').innerHTML=[[ok.title,T('至少一种语言的名称','Title in at least one language')],[ok.time,T('时间有效','Valid date and time')],[ok.scope,T('已选择适用范围','Audience selected')],[ok.url,T('报名链接为 HTTP / HTTPS','Registration URL is HTTP/HTTPS')]].map(([pass,label])=>`<div class="${pass?'ok':'bad'}">${label}</div>`).join('');
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
 return {title:trim('titleZh','titleEn'),type:f.type,timeMode:f.mode,start:f.start,end:f.mode==='multi'?f.end:undefined,time:['timed','deadline'].includes(f.mode)?f.time:undefined,endTime:f.mode==='timed'?f.endTime:undefined,
  scope:f.scope,location:trim('locZh','locEn'),host:trim('hostZh','hostEn'),description:trim('descZh','descEn'),poster:f.poster,qr:f.qr,registrationUrl:f.url.trim()};
}
async function save(status,original){
 if(saving)return;
 form.tried=true;updateChecks();
 const error=$('#ed-error');error.hidden=true;
 if(!Object.values(checks()).every(Boolean)){error.textContent=T('请先完成检查项再保存。','Fix the highlighted items before saving.');error.hidden=false;$('[aria-invalid=true]')?.focus();return;}
 saving=true;const buttons=$$('.side-panel button');buttons.forEach(b=>b.disabled=true);
 try{
  const body={...toEvent(),status:original?.cancelled?'cancelled':status,version:original?.version};
  const saved=await api('/admin/events'+(original?'/'+encodeURIComponent(original.id):''),{method:original?'PUT':'POST',body:JSON.stringify(body)});
  const events=app.data.events||[],index=events.findIndex(e=>e.id===saved.id);
  if(index<0)events.push(saved);else events[index]=saved;
  app.data.events=events;form=null;formKey='';refreshNav();go('events');
  toast(saved.status==='draft'?T('草稿已保存，仅管理员可见。','Draft saved. Only visible to administrators.'):T('事件已保存，公共校历已更新。','Event saved. The public calendar is updated.'));
 }catch(e){
  error.textContent=e.message+(e.fields?.length?'\n'+e.fields.map(item=>`${item.field}: ${item.message}`).join('\n'):'');error.style.whiteSpace='pre-line';error.hidden=false;
 }finally{saving=false;buttons.forEach(b=>b.isConnected&&(b.disabled=false));}
}
