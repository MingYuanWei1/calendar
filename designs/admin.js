'use strict';

const admin = {signedIn:false, open:false, editing:false, eventId:null, notice:'', returnFocus:null};
const A = (zh, en) => state.lang ? en : zh;

function openAdmin() {
  admin.open=true;
  document.body.classList.add('admin-mode');
  document.body.classList.remove('mobile-detail');
  syncDetailMode();
  $('#admin-app').hidden=false;
  renderAdmin();
  window.scrollTo(0,0);
}

function showPublic() {
  admin.open=false;
  document.body.classList.remove('admin-mode');
  $('#admin-app').hidden=true;
  render();
}

function adminNavigation() {
  return `<nav class="admin-navigation"><button type="button" data-public>${A('← 返回公共校历','← Public calendar')}</button>${admin.signedIn?`<button type="button" class="logout" data-logout>${A('退出演示账号','Sign out of demo')}</button>`:''}</nav>`;
}

function renderAdmin() {
  $('#admin-entry').textContent=A('管理事件','Manage events');
  if(!admin.open)return;
  if(!admin.signedIn){
    $('#admin-app').innerHTML=`<div class="admin-shell">${adminNavigation()}<section class="admin-panel login-panel"><span class="overline">CAMPUS CALENDAR</span><h1>${A('管理员登录','Administrator sign-in')}</h1><p>${A('统一维护校园里的每一项公共事件。','Manage public events across all school divisions.')}</p><button id="demo-login" class="primary">${A('使用演示账号进入','Enter with demo account')}</button><p class="login-caption">${A('静态设计演示，不需要真实账号或密码。刷新页面会重置演示数据。','Static design demo. No real credentials are required. Reloading resets the sample data.')}</p></section></div>`;
    $('#demo-login').onclick=()=>{admin.signedIn=true;renderAdmin();};
  }else if(admin.editing){renderEditor();}
  else{renderAdminList();}
  $$('[data-public]').forEach(b=>b.onclick=showPublic);
  $$('[data-logout]').forEach(b=>b.onclick=()=>{admin.signedIn=false;admin.editing=false;renderAdmin();});
}

function eventStatus(event){return event.cancelled?'cancelled':event.status||'published';}
function statusLabel(status){return status==='draft'?A('草稿','Draft'):status==='cancelled'?t('cancelled'):A('已发布','Published');}

function renderAdminList(){
  $('#admin-app').innerHTML=`<div class="admin-shell">${adminNavigation()}<header class="admin-heading"><div><h1>${A('事件管理','Manage events')}</h1><p>${A('全部学部 · 无需审核，直接发布','All divisions · Publish without approval')}</p></div><button id="new-event" class="primary">${A('新增事件','New event')}</button></header>${admin.notice?`<p class="admin-notice" role="status">${esc(admin.notice)}</p>`:''}<section class="admin-panel admin-list">${events.length?events.map(event=>`<article class="admin-row"><div><h2>${esc(text(event.title))}</h2><small>${esc(text(types[event.type].label))} · ${esc(scopeText(event))}</small></div><div class="row-date"><small>${esc(formatDate(event.start))}<br>${esc(timeText(event))}</small></div><span class="row-status status-badge ${eventStatus(event)}">${esc(statusLabel(eventStatus(event)))}</span><div class="row-actions"><button data-edit="${event.id}">${A('编辑','Edit')}</button>${eventStatus(event)==='published'?`<button data-cancel="${event.id}">${A('取消事件','Cancel event')}</button>`:''}<button data-delete="${event.id}">${A('删除','Delete')}</button><button data-admin-preview="${event.id}">${A('预览','Preview')}</button></div></article>`).join(''):`<p class="empty-admin">${A('还没有事件，先添加一项。','No events yet. Add your first event.')}</p>`}</section></div>`;
  $$('[data-cancel]').forEach(b=>b.onclick=()=>confirmChange(b.dataset.cancel,'cancel'));
  $$('[data-delete]').forEach(b=>b.onclick=()=>confirmChange(b.dataset.delete,'delete'));
  $('#new-event').onclick=()=>editEvent(null);
  $$('[data-edit]').forEach(b=>b.onclick=()=>editEvent(b.dataset.edit));
  $$('[data-admin-preview]').forEach(b=>b.onclick=()=>openPreview(events.find(e=>e.id===b.dataset.adminPreview)));
}

function editEvent(id){admin.eventId=id;admin.editing=true;admin.notice='';renderAdmin();window.scrollTo(0,0);$('#title-zh')?.focus();}
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
  $('#admin-app').innerHTML=`<div class="admin-shell">${adminNavigation()}<header class="admin-heading"><div><h1>${event?A('编辑事件','Edit event'):A('新增事件','New event')}</h1><p>${A('时间按学校当地时间填写','Enter times in the school’s local time')}</p></div><button id="back-list" type="button">${A('返回列表','Back to list')}</button></header><form id="event-form" novalidate><div class="editor-grid"><div class="admin-panel"><section class="editor-section"><h2>${A('基本信息','Event information')}</h2>${bilingualFields('title',A('事件名称（至少一种语言）*','Title (at least one language) *'),event)}${bilingualFields('location',A('地点','Location'),event)}${bilingualFields('host',A('主办方','Organiser'),event)}${bilingualFields('description',A('事件说明','Description'),event,'textarea')}</section><section class="editor-section"><h2>${A('时间与适用范围','Time and audience')}</h2>${selectField('type',A('事件类型 *','Event type *'),Object.fromEntries(Object.entries(types).map(([k,v])=>[k,text(v.label)])),event?.type||'activity')}${selectField('timeMode',A('时间形式 *','Time format *'),{timed:A('定时','Timed'),allDay:t('allDay'),multi:A('跨日（全天）','Multiple days (all day)'),deadline:A('截止时间','Deadline')},event?.timeMode||(isMulti(event||{})?'multi':event?.type==='deadline'?'deadline':event&&!event.time?'allDay':'timed'))}<div class="field-pair">${field('start',A('开始日期 *','Start date *'),event?.start||'2026-09-23','date')}${field('end',A('结束日期 *','End date *'),event?.end||event?.start||'2026-09-23','date')}</div><div class="field-pair">${field('time',A('开始／截止时间 *','Start / due time *'),event?.time||'14:00','time')}${field('endTime',A('结束时间 *','End time *'),event?.endTime||'15:00','time')}</div><fieldset id="scope"><legend>${A('适用范围 *','Audience *')}</legend><div class="scope-choices">${['schoolwide','primary','middle','high'].map(scope=>`<label><input type="checkbox" name="scope" value="${scope}" ${(event?.scope||['schoolwide']).includes(scope)?'checked':''}>${t(scope)}</label>`).join('')}</div><span class="field-error" id="error-scope"></span></fieldset></section><section class="editor-section"><h2>${A('海报与报名入口','Poster and registration')}</h2>${selectField('poster',A('海报','Poster'),{'':A('无海报','No poster'),'assets/event-poster.svg':A('艺术节示例海报','Sample arts festival poster'),'assets/missing-poster.png':A('图片加载失败示例','Unavailable image example')},event?.poster||'')}${field('registrationUrl',A('外部报名链接（HTTP / HTTPS）','External registration URL (HTTP / HTTPS)'),event?.registrationUrl||(event?.registration?'https://example.org/?demo=school-calendar':''),'url')}${selectField('qr',A('报名二维码','Registration QR code'),{'':A('无二维码','No QR code'),sample:A('示例二维码 → example.org','Sample QR → example.org'),broken:A('二维码加载失败示例','Unavailable QR example')},event?.qr||'')}<p class="media-caption">${A('示例二维码指向 https://example.org/?demo=school-calendar，不提交任何报名信息。海报使用虚构内容。','Sample QR points to https://example.org/?demo=school-calendar. It submits no registration data. The poster is fictional.')}</p></section></div><aside class="admin-panel editor-aside"><h2>${A('发布之前','Before publishing')}</h2><p>${A('先保存为草稿，再检查学生将看到的详情。草稿不会出现在公共校历。','Save a draft and preview the details students will see. Drafts are not visible on the public calendar.')}</p><p>${A('本次使用模拟数据，不需要审批。','This demo uses sample data. No approval is needed.')}</p></aside></div><footer class="form-actions"><button type="button" id="save-draft" ${event&&eventStatus(event)!=='draft'?'hidden':''}>${A('保存草稿','Save draft')}</button><button type="button" id="form-preview">${A('预览','Preview')}</button><button type="submit" class="primary">${event?.cancelled?A('保存更改','Save changes'):A('发布事件','Publish event')}</button></footer></form></div>`;
  updateTimeFields();
  $('#timeMode').onchange=updateTimeFields;
  $('#type').onchange=()=>{if($('#type').value==='deadline')$('#timeMode').value='deadline';else if($('#timeMode').value==='deadline')$('#timeMode').value='timed';updateTimeFields();};
  $$('[name=scope]').forEach(input=>input.onchange=()=>{if(input.checked)$$('[name=scope]').filter(other=>input.value==='schoolwide'?other!==input:other.value==='schoolwide').forEach(other=>other.checked=false);});
  $('#back-list').onclick=()=>{admin.editing=false;renderAdmin();};
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

function saveEvent(status){
  const event=readEditor();if(!event)return;
  const original=events.find(e=>e.id===event.id);
  if(original&&eventStatus(original)!=='draft'&&['start','end','time','endTime'].some(key=>original[key]!==event[key])){
    event.previousSchedule={start:original.start,end:original.end,time:original.time,endTime:original.endTime,type:original.type};
    event.oldDate=original.start;
  }
  event.status=event.cancelled?'cancelled':status;event.updatedAt=new Date().toLocaleString(state.lang?'en-GB':'zh-CN');
  const index=events.findIndex(e=>e.id===event.id);if(index<0)events.push(event);else events[index]=event;
  admin.editing=false;admin.notice=event.cancelled?A('更改已保存，事件保持取消状态。','Changes saved; the event remains cancelled.'):status==='draft'?A('草稿已保存，仅管理员可见。','Draft saved. Only visible to administrators.'):A('事件已发布，可在公共校历查看。','Event published to the public calendar.');
  renderAdmin();renderCalendar();
}

function openPreview(event){
  previewEvent=event;
  $('#preview-heading').textContent=A('事件预览','Event preview');
  $('#close-preview').setAttribute('aria-label',A('关闭预览','Close preview'));
  $('#preview-detail').innerHTML=eventDetails(event);
  bindDetailActions($('#preview-detail'));
  $('#preview-dialog').showModal();
}

$('#admin-entry').onclick=openAdmin;
$('#close-preview').onclick=()=>$('#preview-dialog').close();
document.addEventListener('calendar-language',()=>{
  const form=$('#event-form');
  const saved=admin.open&&admin.editing&&form?new FormData(form):null;
  renderAdmin();
  if(saved){
    for(const input of $('#event-form').elements){
      if(!input.name)continue;
      if(input.type==='checkbox')input.checked=saved.getAll(input.name).includes(input.value);
      else input.value=saved.get(input.name)||'';
    }
    updateTimeFields();
  }
});
renderAdmin();

function confirmChange(id,action){
  const event=events.find(e=>e.id===id);
  const deleting=action==='delete';
  $('#confirm-heading').textContent=deleting?A('删除误录事件？','Delete this event?'):A('取消此事件？','Cancel this event?');
  $('#confirm-description').textContent=text(event.title)+' — '+(deleting?A('确认后会从管理列表和公共校历移除，当前演示会话中无法撤销。','This removes the event from the management list and public calendar. It cannot be undone within this demo session.'):A('事件将保留在公共校历，标记为已取消，并关闭报名入口。','The event will remain public, marked cancelled, with registration disabled.'));
  $('#cancel-reason-label').hidden=deleting;
  $('#cancel-reason-text').textContent=A('取消原因（选填）','Cancellation reason (optional)');
  $('#cancel-reason').value='';
  $('#confirm-back').textContent=A('返回','Go back');
  $('#confirm-action').textContent=deleting?A('确认删除','Delete event'):A('确认取消','Cancel event');
  const dialog=$('#confirm-dialog');dialog.returnValue='';
  dialog.onclose=()=>{
    if(dialog.returnValue!=='confirm')return;
    if(deleting)events.splice(events.indexOf(event),1);
    else{event.cancelled=true;event.status='cancelled';event.cancelReason=$('#cancel-reason').value.trim();event.updatedAt=new Date().toLocaleString(state.lang?'en-GB':'zh-CN');}
    if(state.selected===id)state.selected=null;
    admin.notice=deleting?A('事件已删除。','Event deleted.'):A('事件已取消，公共记录已保留。','Event cancelled; the public record is retained.');
    renderAdmin();renderCalendar();renderDetail();
    $('#new-event').focus({preventScroll:true});
  };
  dialog.showModal();$('#confirm-back').focus();
}
