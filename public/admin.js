'use strict';

const admin = {signedIn:false, open:false, editing:false, eventId:null, notice:'', returnFocus:null,busy:false,dirty:false};
const A = (zh, en) => state.lang ? en : zh;

async function openAdmin() {
  admin.open=true;
  document.body.classList.add('admin-mode');
  document.body.classList.remove('mobile-detail');
  syncDetailMode();
  $('#admin-app').hidden=false;
  renderAdmin();
  window.scrollTo(0,0);
  if(admin.signedIn){try{await loadEvents(true);admin.notice='';renderAdmin();}catch(error){if(error.status===401)admin.signedIn=false;admin.notice=error.message||A('加载失败，请重试。','Could not load events. Please retry.');renderAdmin();}}
}

async function showPublic() {
  if(!mayLeave())return;
  admin.editing=false;admin.dirty=false;
  admin.open=false;
  document.body.classList.remove('admin-mode');
  $('#admin-app').hidden=true;
  try{await loadEvents();setLoadMessage('');}catch(error){setLoadMessage(A('刷新失败，请重试。','Refresh failed. Please retry.'),true);$('#retry-load').hidden=false;}
  render();
}

function adminNavigation() {
  return `<nav class="admin-navigation"><button type="button" data-public>${A('← 返回公共校历','← Public calendar')}</button></nav>`;
}

function renderAdmin() {
  if(!admin.open)return;
  if(!admin.signedIn&&!admin.editing){
    $('#admin-app').innerHTML=`<div class="admin-shell">${adminNavigation()}<section class="admin-panel login-panel"><span class="overline">CAMPUS CALENDAR</span><h1>${A('需要管理权限','Management access required')}</h1><p>${A('统一维护校园里的每一项公共事件。','Manage public events across all school divisions.')}</p>${admin.notice?`<p class="request-error" role="alert">${esc(admin.notice)}</p>`:''}<button id="open-account-login" class="primary">${A('登录 / 切换账户','Sign in / Switch account')}</button></section></div>`;
    $('#open-account-login').onclick=openLoginDialog;
  }else if(admin.editing){renderEditor();}
  else{renderAdminList();}
  $$('[data-public]').forEach(b=>b.onclick=showPublic);
}

function eventStatus(event){return event.cancelled?'cancelled':event.status||'published';}
function statusLabel(status){return status==='draft'?A('草稿','Draft'):status==='cancelled'?t('cancelled'):A('已发布','Published');}

function renderAdminList(){
  $('#admin-app').innerHTML=`<div class="admin-shell">${adminNavigation()}<header class="admin-heading"><div><h1>${A('事件管理','Manage events')}</h1><p>${A('全部学部 · 无需审核，直接发布','All divisions · Publish without approval')}</p></div><div><a href="exams-admin.html" class="exam-entry">${A('考试管理','Manage exams')}</a> <button id="manage-days" type="button">${A('放假与调休','School days')}</button> <button id="refresh-admin" type="button">${A('刷新列表','Refresh list')}</button> <button id="new-event" class="primary">${A('新增事件','New event')}</button></div></header>${admin.notice?`<p class="admin-notice" role="status">${esc(admin.notice)}</p>`:''}<section class="admin-panel admin-list">${events.length?events.map(event=>`<article class="admin-row"><div><h2>${esc(text(event.title))}</h2><small>${esc(text(types[event.type].label))} · ${esc(scopeText(event))}</small></div><div class="row-date"><small>${esc(formatDate(event.start))}<br>${esc(timeText(event))}</small></div><span class="row-status status-badge ${eventStatus(event)}">${esc(statusLabel(eventStatus(event)))}</span><div class="row-actions"><button data-edit="${event.id}">${A('编辑','Edit')}</button>${eventStatus(event)==='published'?`<button data-cancel="${event.id}">${A('取消事件','Cancel event')}</button>`:''}<button data-delete="${event.id}">${A('删除','Delete')}</button><button data-admin-preview="${event.id}">${A('预览','Preview')}</button></div></article>`).join(''):`<p class="empty-admin">${A('还没有事件，先添加一项。','No events yet. Add your first event.')}</p>`}</section></div>`;
  $$('[data-cancel]').forEach(b=>b.onclick=()=>confirmChange(b.dataset.cancel,'cancel'));
  $$('[data-delete]').forEach(b=>b.onclick=()=>confirmChange(b.dataset.delete,'delete'));
  $('#manage-days').onclick=openDayPlanEditor;
  $('#refresh-admin').onclick=openAdmin;
  $('#new-event').onclick=()=>editEvent(null);
  $$('[data-edit]').forEach(b=>b.onclick=()=>editEvent(b.dataset.edit));
  $$('[data-admin-preview]').forEach(b=>b.onclick=()=>openPreview(events.find(e=>e.id===b.dataset.adminPreview)));
}

function editEvent(id){admin.dirty=false;admin.eventId=id;admin.editing=true;admin.notice='';renderAdmin();window.scrollTo(0,0);$('#title-zh')?.focus();}
function field(name,label,value='',kind='text'){
  return `<label class="field"><span>${label}</span>${kind==='textarea'?`<textarea id="${name}" name="${name}" aria-describedby="error-${name}">${esc(value)}</textarea>`:`<input id="${name}" name="${name}" aria-describedby="error-${name}" type="${kind}" value="${esc(value)}">`}<span class="field-error" id="error-${name}" aria-live="polite"></span></label>`;
}

function selectField(name, label, options, value){
  return `<label class="field"><span>${label}</span><select id="${name}" name="${name}">${Object.entries(options).map(([key,label])=>`<option value="${key}" ${key===value?'selected':''}>${esc(label)}</option>`).join('')}</select><span class="field-error" id="error-${name}"></span></label>`;
}
function bilingualFields(name,label,event,kind='text'){
  return `<div class="field-pair">${field(name+'-zh',label+' · 中文',event?.[name]?.[0],kind)}${field(name+'-en',label+' · English',event?.[name]?.[1],kind)}</div>`;
}
function updateTimeFields(){
  const mode=$('#timeMode').value;
  $('#end').closest('label').hidden=mode!=='multi';
  $('#time').closest('label').hidden=!['timed','deadline'].includes(mode);
  $('#endTime').closest('label').hidden=mode!=='timed';
  if(mode==='deadline')$('#type').value='deadline';
}
function renderEditor(){
  const event=events.find(e=>e.id===admin.eventId);
  $('#admin-app').innerHTML=`<div class="admin-shell">${adminNavigation()}<header class="admin-heading"><div><h1>${event?A('编辑事件','Edit event'):A('新增事件','New event')}</h1><p>${A('时间按学校当地时间填写','Enter times in the school’s local time')}</p></div><button id="back-list" type="button">${A('返回列表','Back to list')}</button></header><form id="event-form" novalidate><div class="editor-grid"><div class="admin-panel"><section class="editor-section"><h2>${A('基本信息','Event information')}</h2>${bilingualFields('title',A('事件名称（至少一种语言）*','Title (at least one language) *'),event)}${bilingualFields('location',A('地点','Location'),event)}${bilingualFields('host',A('主办方','Organiser'),event)}${bilingualFields('description',A('事件说明','Description'),event,'textarea')}</section><section class="editor-section"><h2>${A('时间与适用范围','Time and audience')}</h2>${selectField('type',A('事件类型 *','Event type *'),Object.fromEntries(Object.entries(types).map(([k,v])=>[k,text(v.label)])),event?.type||'activity')}${selectField('timeMode',A('时间形式 *','Time format *'),{timed:A('定时','Timed'),allDay:t('allDay'),multi:A('跨日（全天）','Multiple days (all day)'),deadline:A('截止时间','Deadline')},event?.timeMode||(isMulti(event||{})?'multi':event?.type==='deadline'?'deadline':event&&!event.time?'allDay':'timed'))}<div class="field-pair">${field('start',A('开始日期 *','Start date *'),event?.start||schoolToday(),'date')}${field('end',A('结束日期 *','End date *'),event?.end||event?.start||schoolToday(),'date')}</div><div class="field-pair">${field('time',A('开始／截止时间 *','Start / due time *'),event?.time||'14:00','time')}${field('endTime',A('结束时间 *','End time *'),event?.endTime||'15:00','time')}</div><fieldset id="scope"><legend>${A('适用范围 *','Audience *')}</legend><div class="scope-choices">${['schoolwide','primary','middle','high'].map(scope=>`<label><input type="checkbox" name="scope" value="${scope}" ${(event?.scope||['schoolwide']).includes(scope)?'checked':''}>${t(scope)}</label>`).join('')}</div><span class="field-error" id="error-scope"></span></fieldset></section><section class="editor-section"><h2>${A('海报与报名入口','Poster and registration')}</h2>${mediaField('poster',A('事件海报','Event poster'),event?.poster)}${field('registrationUrl',A('外部报名链接（HTTP / HTTPS）','External registration URL (HTTP / HTTPS)'),event?.registrationUrl||'','url')}${mediaField('qr',A('报名二维码','Registration QR code'),event?.qr)}<p class="media-caption">${A('可上传 PNG、JPEG 或 WebP 图片，每张不超过 5 MB。报名由外部渠道承办。','Upload PNG, JPEG or WebP images, up to 5 MB each. Registration is handled externally.')}</p></section></div><aside class="admin-panel editor-aside"><h2>${A('发布之前','Before publishing')}</h2><p>${A('先保存为草稿，再检查学生将看到的详情。草稿不会出现在公共校历。','Save a draft and preview the details students will see. Drafts are not visible on the public calendar.')}</p><p>${A('发布后对所有访客可见，无需审核。','Published events are visible to all visitors. No approval is required.')}</p></aside></div><p id="form-status" role="status" class="request-error"></p><footer class="form-actions"><button type="button" id="save-draft" ${event&&eventStatus(event)!=='draft'?'hidden':''}>${A('保存草稿','Save draft')}</button><button type="button" id="form-preview">${A('预览','Preview')}</button><button type="submit" class="primary">${event?.cancelled?A('保存更改','Save changes'):A('发布事件','Publish event')}</button></footer></form></div>`;
  updateTimeFields();
  bindMediaInputs();
  $('#event-form').oninput=()=>{admin.dirty=true;};
  $('#timeMode').onchange=updateTimeFields;
  $('#type').onchange=()=>{if($('#type').value==='deadline')$('#timeMode').value='deadline';else if($('#timeMode').value==='deadline')$('#timeMode').value='timed';updateTimeFields();};
  $$('[name=scope]').forEach(input=>input.onchange=()=>{if(input.checked)$$('[name=scope]').filter(other=>input.value==='schoolwide'?other!==input:other.value==='schoolwide').forEach(other=>other.checked=false);});
  $('#back-list').onclick=async()=>{if(!mayLeave())return;admin.editing=false;admin.dirty=false;try{await loadEvents(true);renderAdmin();}catch(error){showRequestError(error);}};
  $('#save-draft').onclick=()=>saveEvent('draft');
  $('#form-preview').onclick=()=>{const value=readEditor();if(value)openPreview(value);};
  $('#event-form').onsubmit=e=>{e.preventDefault();saveEvent('published');};
}

function readEditor(){
  const form=$('#event-form');const values=new FormData(form);
  const get=name=>String(values.get(name)||'').trim();
  const errors={};
  const mode=get('timeMode');
  const scope=values.getAll('scope').map(String);
  if(get('title-zh').length>250||get('title-en').length>250)errors['title-zh']=A('名称不能超过 250 字。','Titles must be at most 250 characters.');
  if(!get('title-zh')&&!get('title-en'))errors['title-zh']=A('至少填写一种语言的事件名称。','Enter a title in at least one language.');
  if(get('type')==='deadline'&&mode!=='deadline')errors.timeMode=A('截止日必须选择“截止时间”并填写具体时刻。','Deadlines require the Deadline time format and a specific time.');
  if(!get('start'))errors.start=A('请选择日期。','Choose a date.');
  if(mode==='multi'&&(!get('end')||get('end')<get('start')))errors.end=A('结束日期不能早于开始日期。','End date must not precede start date.');
  if(['timed','deadline'].includes(mode)&&!get('time'))errors.time=A('请填写时间。','Enter a time.');
  if(mode==='timed'&&(!get('endTime')||get('endTime')<get('time')))errors.endTime=A('结束时间不能早于开始时间。','End time must not precede start time.');
  if(!scope.length)errors.scope=A('请选择至少一个适用范围。','Select at least one audience.');
  if(get('registrationUrl')){try{const url=new URL(get('registrationUrl'));if(!['http:','https:'].includes(url.protocol))throw new Error();}catch{errors.registrationUrl=A('请输入完整的 HTTP 或 HTTPS 链接。','Enter a complete HTTP or HTTPS URL.');}}
  $$('.field-error').forEach(el=>el.textContent='');
  form.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
  for(const [key,error] of Object.entries(errors)){$('#error-'+key).textContent=error;$('#'+key).setAttribute('aria-invalid','true');}
  if(Object.keys(errors).length){const invalid=$('#'+Object.keys(errors)[0]);(invalid.querySelector('input')||invalid).focus();return null;}
  const original=events.find(e=>e.id===admin.eventId);
  return {...original,id:admin.eventId||crypto.randomUUID(),title:[get('title-zh'),get('title-en')],type:get('type'),start:get('start'),end:mode==='multi'?get('end'):undefined,time:['timed','deadline'].includes(mode)?get('time'):undefined,endTime:mode==='timed'?get('endTime'):undefined,timeMode:mode,scope,location:[get('location-zh'),get('location-en')],host:[get('host-zh'),get('host-en')],description:[get('description-zh'),get('description-en')],poster:get('poster'),registrationUrl:get('registrationUrl'),qr:get('qr'),registration:false};
}

async function saveEvent(status){
  if(admin.busy)return;
  const event=readEditor();if(!event)return;
  event.status=event.cancelled?'cancelled':status;
  setBusy(true);$('#form-status').textContent=A('正在保存…','Saving…');
  try{
    const saved=await api('/admin/events'+(admin.eventId?'/'+admin.eventId:''),{method:admin.eventId?'PUT':'POST',body:JSON.stringify(event)});
    const index=events.findIndex(e=>e.id===saved.id);if(index<0)events.push(saved);else events[index]=saved;
    admin.editing=false;admin.dirty=false;
    admin.notice=saved.status==='draft'?A('草稿已保存，仅管理员可见。','Draft saved. Only visible to administrators.'):A('事件已保存，公共校历已更新。','Event saved. The public calendar is updated.');
    renderAdmin();renderCalendar();renderDetail();
  }catch(error){showRequestError(error);}
  finally{setBusy(false);}
}

function openPreview(event){
  previewEvent=event;
  $('#preview-heading').textContent=A('事件预览','Event preview');
  $('#close-preview').setAttribute('aria-label',A('关闭预览','Close preview'));
  $('#preview-detail').innerHTML=eventDetails(event);
  bindDetailActions($('#preview-detail'));
  $('#preview-dialog').showModal();
}

window.addEventListener('manage-events',async()=>{const session=await api('/session');admin.signedIn=session.user?.role>=2;await openAdmin();});
window.addEventListener('account-changed',async event=>{admin.signedIn=/** @type {CustomEvent} */(event).detail.user?.role>=2;if(!admin.signedIn){admin.editing=false;admin.dirty=false;await showPublic();}else if(admin.open&&!admin.editing){await loadEvents(true);renderAdmin();}});
window.addEventListener('account-before-logout',event=>{if(!mayLeave())event.preventDefault();});
$('#close-preview').onclick=()=>$('#preview-dialog').close();
document.addEventListener('calendar-language',()=>{
  const form=$('#event-form');
  const saved=admin.open&&admin.editing&&form?new FormData(form):null;
  renderAdmin();
  if(saved){
    for(const input of $('#event-form').elements){
      if(!input.name||input.type==='file')continue;
      if(input.type==='checkbox')input.checked=saved.getAll(input.name).includes(input.value);
      else input.value=saved.get(input.name)||'';
    }
    updateTimeFields();
    updateMediaPreviews();
  }
});
renderAdmin();

function confirmChange(id,action){
  const event=events.find(e=>e.id===id);
  const deleting=action==='delete';
  $('#confirm-heading').textContent=deleting?A('删除误录事件？','Delete this event?'):A('取消此事件？','Cancel this event?');
  $('#confirm-description').textContent=text(event.title)+' — '+(deleting?A('确认后会从管理列表和公共校历移除，无法撤销，请仅用于误录事件。','This removes the event from the management list and public calendar. This cannot be undone; use it only for incorrect entries.'):A('事件将保留在公共校历，标记为已取消，并关闭报名入口。','The event will remain public, marked cancelled, with registration disabled.'));
  $('#cancel-reason-label').hidden=deleting;
  $('#cancel-reason-text').textContent=A('取消原因（选填）','Cancellation reason (optional)');
  $('#cancel-reason').value='';
  $('#confirm-back').textContent=A('返回','Go back');
  $('#confirm-action').textContent=deleting?A('确认删除','Delete event'):A('确认取消','Cancel event');
  const dialog=$('#confirm-dialog');dialog.returnValue='';
  $('#confirm-error').textContent='';
  dialog.oncancel=e=>{if(admin.busy)e.preventDefault();};
  dialog.querySelector('form').onsubmit=async e=>{
    if(e.submitter?.value!=='confirm')return;
    e.preventDefault();if(admin.busy)return;
    setBusy(true);
    dialog.querySelectorAll('button,textarea').forEach(el=>el.disabled=true);
    $('#confirm-error').textContent=A('正在保存…','Saving…');
    try{
      const result=await api('/admin/events/'+id+(deleting?'':'/cancel'),{method:deleting?'DELETE':'POST',body:JSON.stringify({version:event.version,reason:$('#cancel-reason').value.trim()})});
      if(deleting)events.splice(events.indexOf(event),1);else events[events.indexOf(event)]=result;
      if(state.selected===id)state.selected=null;
      admin.notice=deleting?A('事件已删除。','Event deleted.'):A('事件已取消，公共记录已保留。','Event cancelled; the public record is retained.');
      dialog.close();renderAdmin();renderCalendar();renderDetail();$('#new-event').focus({preventScroll:true});
    }catch(error){$('#confirm-error').textContent=error.message||A('保存失败，内容已保留，请重试。','Could not save. Your inputs are preserved; please retry.');}
    finally{setBusy(false);dialog.querySelectorAll('button,textarea').forEach(el=>el.disabled=false);}
  };
  dialog.showModal();$('#confirm-back').focus();
}

function mayLeave(){return !admin.dirty||window.confirm(A('尚有未保存的内容，确定离开？','You have unsaved changes. Leave this page?'));}
function setBusy(value){
  admin.busy=value;
  $$('#admin-app button,#admin-app input,#admin-app select,#admin-app textarea,#language').forEach(el=>el.disabled=value);
}
function showRequestError(error){
  const target=$('#form-status')||$('.admin-notice');
  if(!target){admin.notice=error.message;renderAdmin();return;}
  target.textContent=error.message||A('网络连接失败，内容已保留，请重试。','Connection failed. Your inputs are preserved; please retry.');
  if(error.fields)for(const item of error.fields){
    const key=['title','location','host','description'].includes(item.field)?item.field+'-zh':item.field;
    const el=$('#error-'+key);if(el)el.textContent=item.message;
  }
  if(error.status===401){
    admin.signedIn=false;
    const button=document.createElement('button');button.type='button';button.textContent=A('重新登录','Sign in again');button.onclick=openLoginDialog;target.append(button);
  }
}
function openLoginDialog(){window.dispatchEvent(new Event('account-login'));}
function mediaField(name,label,value=''){
  return `<div class="field"><label for="upload-${name}">${label}</label><input id="${name}" name="${name}" type="hidden" value="${esc(value)}"><input id="upload-${name}" type="file" accept="image/png,image/jpeg,image/webp"><div id="preview-${name}"></div><button type="button" data-remove-media="${name}" ${value?'':'hidden'}>${A('移除图片','Remove image')}</button><span id="error-${name}" class="field-error" aria-live="polite"></span></div>`;
}
function updateMediaPreviews(){
  for(const name of ['poster','qr']){
    const url=$('#'+name).value;
    $('#preview-'+name).innerHTML=url?`<img class="upload-preview" src="${esc(url)}" alt="${name==='poster'?A('海报预览','Poster preview'):A('二维码预览','QR preview')}">`:'';
    $('[data-remove-media="'+name+'"]').hidden=!url;
  }
}
function bindMediaInputs(){
  updateMediaPreviews();
  for(const name of ['poster','qr']){
    $('#upload-'+name).onchange=async e=>{
      const file=e.target.files[0];if(!file)return;
      if(file.size>5*1024*1024){$('#error-'+name).textContent=A('图片不能超过 5 MB。','Image must not exceed 5 MB.');return;}
      setBusy(true);$('#error-'+name).textContent=A('正在上传…','Uploading…');
      try{const result=await api('/admin/media',{method:'POST',body:file,headers:{'Content-Type':file.type}});$('#'+name).value=result.url;admin.dirty=true;updateMediaPreviews();$('#error-'+name).textContent='';}
      catch(error){$('#error-'+name).textContent=error.message;showRequestError(error);}
      finally{setBusy(false);e.target.value='';}
    };
    $('[data-remove-media="'+name+'"]').onclick=()=>{$('#'+name).value='';admin.dirty=true;updateMediaPreviews();};
  }
}
window.addEventListener('beforeunload',e=>{if(admin.dirty){e.preventDefault();e.returnValue='';}});
startCalendar();

window.addEventListener('account-before-change',event=>{if(!mayLeave())event.preventDefault();});
