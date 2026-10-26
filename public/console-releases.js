import {$,esc,corners,app,T,api,toast,modal,closeModal,busy,errorLine,refreshNav} from './console-core.js';
import {showReleaseNotes,noteBody} from './release-notes.mjs';

// 更新说明: release notes that pop up once on the calendar and exams pages. Only admins manage them.
let notes=null;
export const releaseCount=()=>notes?.length;
export async function loadReleases(){notes=await api('/admin/release-notes');refreshNav();return notes;}

const DAY=86400000;
const expired=note=>note.status==='published'&&note.publishedAt+note.days*DAY<=Date.now();
const statusOf=note=>expired(note)?['tag tag-neutral',T('已过期','Expired')]:note.status==='published'?['tag tag-accent',T('已发布','Published')]:['tag tag-outline',T('草稿','Draft')];
/** The next patch release after the newest one, e.g. 0.1.3 → 0.1.4. */
const nextRelease=()=>{const [x,y,z]=(notes[0]?.release||'0.0.0').split('.').map(Number);return `${x}.${y}.${z+1}`;};

export async function showReleases(main){
 if(app.user.role!==3){main.innerHTML=`<p class="load-error">${T('只有 admin 可以管理更新说明。','Only admins can manage release notes.')}</p>`;return;}
 if(!notes){main.innerHTML=`<p class="loading">${T('正在加载更新说明…','Loading release notes…')}</p>`;await loadReleases();}
 main.innerHTML=`<div class="page narrow">
 <header class="page-head"><div><div class="kicker">${T('管理后台','Admin console')}</div><h1>${T('更新说明','Release notes')}</h1><p class="sub">${T('发布后，用户下次打开校历或考试安排时会弹出一次，点“我知道了”后不再显示。弹窗同时显示中文和英文；同一用户最多一次看到最近 3 条未读说明。','Once published, a note pops up the next time someone opens the calendar or exams page, until they press “Got it”. It shows Chinese and English together; each person sees at most their 3 newest unread notes.')}</p></div>
 <div class="page-actions"><button type="button" class="btn btn-primary" data-act="new">+ ${T('新建更新说明','New release note')}</button></div></header>
 <div id="release-list"></div></div>`;
 renderList();
 main.querySelector('.page').onclick=e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.act==='new')edit(null);
  else if(b.dataset.edit)edit(notes.find(n=>n.id===b.dataset.edit));
  else if(b.dataset.delete)confirmDelete(notes.find(n=>n.id===b.dataset.delete));
 };
}

function renderList(){
 const host=$('#release-list');if(!host)return;
 if(!notes.length){host.innerHTML=`<div class="empty"><strong>${T('暂无更新说明','No release notes yet')}</strong><p>${T('新建一条，写下这次更新的内容。','Create one describing what changed.')}</p></div>`;return;}
 host.innerHTML=notes.map(note=>{const [tag,label]=statusOf(note);return `<section class="panel blueprint release-row">${corners}
  <div class="release-row-head"><h4>Release ${esc(note.release)}</h4><span class="${tag}">${label}</span>
   <span class="cell-sub">${note.publishedAt?`${T('发布于','Published')} ${esc(note.date)} · ${T(`展示 ${note.days} 天`,`shown for ${note.days} days`)}`:T(`展示期 ${note.days} 天`,`Shows for ${note.days} days`)}</span>
   <div class="row-actions"><button type="button" class="btn btn-ghost" data-edit="${esc(note.id)}">${T('编辑','Edit')}</button><button type="button" class="btn btn-ghost btn-danger" data-delete="${esc(note.id)}">${T('删除','Delete')}</button></div></div>
  <div class="release-row-body">${noteBody(note.zh)}${note.en?`<div lang="en">${noteBody(note.en)}</div>`:''}</div></section>`;}).join('');
}

function edit(note){
 const published=note?.status==='published';
 const body=modal(note?T(`编辑 Release ${note.release}`,`Edit release ${note.release}`):T('新建更新说明','New release note'),`<form class="release-form" novalidate>
  <div class="release-form-row"><div class="field"><label for="rn-release">${T('版本号','Release')}</label><input class="input mono" id="rn-release" name="release" required pattern="\\d+\\.\\d+\\.\\d+" placeholder="0.0.1" value="${esc(note?.release||nextRelease())}"></div>
  <div class="field"><label for="rn-days">${T('展示期（天）','Shows for (days)')}</label><input class="input" id="rn-days" name="days" type="number" min="1" max="365" required value="${note?.days||30}"></div></div>
  <div class="field"><label for="rn-zh">${T('中文说明','Chinese')}</label><textarea class="input" id="rn-zh" name="zh" required maxlength="4000" rows="6" placeholder="${T('以“- ”开头的行显示为列表','Lines starting with “- ” become a list')}">${esc(note?.zh||'')}</textarea></div>
  <div class="field"><label for="rn-en">${T('英文说明（可选，显示在中文之后）','English (optional, shown after the Chinese)')}</label><textarea class="input" id="rn-en" name="en" maxlength="4000" rows="5">${esc(note?.en||'')}</textarea></div>
  ${published?`<label class="release-renotify"><input type="checkbox" name="renotify"> ${T('重新提醒所有人（已看过的用户会再看到一次）','Remind everyone again (people who have read it will see it once more)')}</label>`:''}
  ${errorLine}
  <div class="dialog-actions"><button type="button" class="btn btn-ghost" data-preview>${T('预览','Preview')}</button><span style="flex:1"></span>
   ${published?`<button type="button" class="btn btn-secondary" data-save="draft">${T('撤回为草稿','Withdraw to draft')}</button><button type="button" class="btn btn-primary" data-save="published">${T('保存','Save')}</button>`
   :`<button type="button" class="btn btn-secondary" data-save="draft">${T('保存草稿','Save draft')}</button><button type="button" class="btn btn-primary" data-save="published">${T('发布','Publish')}</button>`}</div></form>`,{size:'medium'});
 const form=body.querySelector('form');
 app.dirty=true;
 form.closest('dialog').addEventListener('close',()=>{app.dirty=false;},{once:true});
 const values=()=>{const v=Object.fromEntries(new FormData(form));return {release:String(v.release).trim(),days:Number(v.days),zh:String(v.zh),en:String(v.en),renotify:v.renotify==='on'};};
 body.querySelector('[data-preview]').onclick=()=>{const v=values();showReleaseNotes([{release:v.release||'0.0.0',zh:v.zh||T('（中文说明）','(Chinese text)'),en:v.en,date:note?.date||app.today}]);};
 body.querySelectorAll('[data-save]').forEach(button=>button.onclick=()=>{
  if(!form.reportValidity())return;
  const status=button.dataset.save;
  if(published&&status==='draft'&&!confirm(T('撤回后用户将不再看到这条更新说明，确定撤回？','Withdrawn notes stop popping up. Withdraw this note?')))return;
  // Read the form before busy() disables it, since disabled fields leave FormData.
  const payload=JSON.stringify({...values(),status,...(note?{version:note.version}:{})});
  busy(body,async()=>{
   await api(note?'/admin/release-notes/'+encodeURIComponent(note.id):'/admin/release-notes',{method:note?'PUT':'POST',body:payload});
   await loadReleases();closeModal();renderList();
   toast(status==='draft'?(published?T('已撤回为草稿。','Withdrawn to draft.'):T('草稿已保存。','Draft saved.')):published?T('已保存。','Saved.'):T('已发布，用户下次打开网站时会看到。','Published. People will see it on their next visit.'));
  });
 });
}

function confirmDelete(note){
 const body=modal(T('删除更新说明？','Delete release note?'),`<p class="dialog-text"><strong style="font-weight:500">Release ${esc(note.release)}</strong> — ${T('此操作不可撤销，已读记录会一并删除。','This cannot be undone; its read records are removed too.')}</p>${errorLine}
 <div class="dialog-actions"><button type="button" class="btn btn-secondary" data-close>${T('返回','Go back')}</button><button type="button" class="btn btn-primary" data-go>${T('确认删除','Delete')}</button></div>`);
 body.querySelector('[data-go]').onclick=()=>busy(body,async()=>{
  await api('/admin/release-notes/'+encodeURIComponent(note.id),{method:'DELETE'});
  await loadReleases();closeModal();renderList();toast(T('更新说明已删除。','Release note deleted.'));
 });
}
