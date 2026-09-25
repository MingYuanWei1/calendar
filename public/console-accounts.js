import {$,$$,esc,corners,app,T,api,toast,modal,closeModal,busy,errorLine,refreshNav} from './console-core.js';

const roles={1:'reader',2:'moderator',3:'admin'};
let accounts=null;
export const accountCount=()=>accounts?.length;

export async function showAccounts(main){
 if(app.user.role!==3){main.innerHTML=`<p class="load-error">${T('只有 admin 可以管理账户。','Only admins can manage accounts.')}</p>`;return;}
 if(!accounts){main.innerHTML=`<p class="loading">${T('正在加载账户…','Loading accounts…')}</p>`;await loadAccounts();}
 main.innerHTML=`<div class="page">
 <header class="page-head"><div><div class="kicker">${T('管理后台','Admin console')}</div><h1>${T('账户','Accounts')}</h1><p class="sub">${T('reader 可浏览与勾选个人考试；moderator 可管理事件、考试与日期安排；admin 另可管理账户。Microsoft 账户首次登录后自动加入，默认 reader。','Readers browse and pick personal exams; moderators manage events, exams and school days; admins also manage accounts. Microsoft accounts join as readers on first sign-in.')}</p></div>
 <div class="page-actions"><button type="button" class="btn btn-secondary" data-act="refresh">${T('刷新','Refresh')}</button></div></header>
 <section class="panel blueprint">${corners}<h4>${T('新增本地账户','Create local account')}</h4>
  <form class="account-form" id="create-account" novalidate>
   <div class="field"><label for="acc-name">${T('姓名','Name')}</label><input class="input" id="acc-name" name="name" required maxlength="160"></div>
   <div class="field"><label for="acc-user">${T('账号','Username')}</label><input class="input" id="acc-user" name="username" required pattern="[a-zA-Z0-9_.\\-]{3,64}" maxlength="64" autocomplete="off"></div>
   <div class="field"><label for="acc-pass">${T('初始密码（至少 12 位）','Initial password (12+ characters)')}</label><input class="input" id="acc-pass" name="password" type="password" required minlength="12" maxlength="256" autocomplete="new-password"></div>
   <div class="field"><label for="acc-role">${T('角色','Role')}</label><select class="input" id="acc-role" name="role" style="width:100%">${[1,2,3].map(r=>`<option value="${r}">${r} · ${roles[r]}</option>`).join('')}</select></div>
   <button type="submit" class="btn btn-primary">${T('创建','Create')}</button>
  </form><p class="alert bad" role="alert" id="create-error" hidden></p></section>
 <div class="grid-scroll"><div class="accounts-grid"><div class="grid-head"><span>${T('账户','Account')}</span><span>${T('登录方式','Sign-in')}</span><span>${T('角色','Role')}</span><span>${T('启用','Enabled')}</span><span></span></div><div id="account-rows"></div></div></div>
 </div>`;
 renderRows();
 const page=main.querySelector('.page');
 page.querySelector('#create-account').onsubmit=create;
 page.onclick=async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.act==='refresh'){b.disabled=true;try{await loadAccounts();renderRows();toast(T('列表已刷新。','List refreshed.'));}catch(error){toast(error.message,{bad:true});}finally{b.disabled=false;}}
  else if(b.dataset.save)save(b);
  else if(b.dataset.delete)confirmDelete(accounts.find(a=>a.id===b.dataset.delete));
 };
}

export async function loadAccounts(){accounts=await api('/admin/accounts');refreshNav();}

function renderRows(){
 const host=$('#account-rows');if(!host)return;
 host.innerHTML=accounts.map(a=>{const self=a.id===app.user.id,off=self?' disabled':'';return `<div class="grid-row" data-account="${esc(a.id)}">
 <div class="clip"><div class="cell-main clip">${esc(a.name)}${self?` <span class="tag tag-accent small">${T('当前账户','You')}</span>`:''}</div><div class="cell-sub clip">${esc(a.subject)}</div></div>
 <span style="font-size:13px">${a.provider==='local'?T('账号密码','Password'):'Microsoft'}</span>
 <select class="input" style="width:100%;min-width:0" aria-label="${esc(T('角色：','Role: ')+a.name)}"${off}>${[1,2,3].map(r=>`<option value="${r}"${r===a.role?' selected':''}>${r} · ${roles[r]}</option>`).join('')}</select>
 <button type="button" class="checkbox" data-enabled aria-pressed="${!a.disabled}" aria-label="${esc(T('启用：','Enabled: ')+a.name)}"${off}></button>
 <div class="row-actions"><button type="button" class="btn btn-ghost" data-save="${esc(a.id)}"${off}>${T('保存','Save')}</button><button type="button" class="btn btn-ghost btn-danger" data-delete="${esc(a.id)}"${off}>${T('删除','Delete')}</button></div></div>`;}).join('');
 $$('[data-enabled]',host).forEach(b=>b.onclick=()=>b.setAttribute('aria-pressed',String(b.getAttribute('aria-pressed')!=='true')));
}

async function create(event){
 event.preventDefault();
 const form=event.target,error=$('#create-error'),button=form.querySelector('[type=submit]');
 error.hidden=true;
 if(!form.reportValidity())return;
 const values=Object.fromEntries(new FormData(form));
 button.disabled=true;
 try{
  await api('/admin/accounts',{method:'POST',body:JSON.stringify({...values,name:String(values.name).trim(),role:Number(values.role)})});
  form.reset();await loadAccounts();renderRows();toast(T('账户已创建。','Account created.'));
 }catch(e){error.textContent=e.message;error.hidden=false;}
 finally{button.disabled=false;}
}

async function save(button){
 const row=button.closest('[data-account]'),controls=$$('button,select',row);
 controls.forEach(el=>el.disabled=true);
 try{
  await api('/admin/accounts/'+encodeURIComponent(row.dataset.account),{method:'PATCH',body:JSON.stringify({role:Number(row.querySelector('select').value),disabled:row.querySelector('[data-enabled]').getAttribute('aria-pressed')!=='true'})});
  await loadAccounts();renderRows();toast(T('账户已更新。','Account updated.'));
 }catch(e){toast(e.message,{bad:true});controls.forEach(el=>el.disabled=false);}
}

function confirmDelete(account){
 const schoolNote=account.provider==='microsoft'?T('学校账户再次登录时会以 reader 身份重新创建；如需禁止登录，请改为停用。','School accounts are recreated as readers on their next sign-in. Disable the account instead to block sign-in.'):'';
 const body=modal(T('删除账户？','Delete account?'),`<p class="dialog-text"><strong style="font-weight:500">${esc(account.name)}</strong> — ${T('此操作不可撤销，将清除其登录会话和个人考试选择。','This cannot be undone and removes its sessions and personal exam choices.')}</p>${schoolNote?`<p class="callout">${schoolNote}</p>`:''}${errorLine}
 <div class="dialog-actions"><button type="button" class="btn btn-secondary" data-close>${T('返回','Go back')}</button><button type="button" class="btn btn-primary" data-go>${T('确认删除','Delete account')}</button></div>`);
 body.querySelector('[data-go]').onclick=()=>busy(body,async()=>{
  await api('/admin/accounts/'+encodeURIComponent(account.id),{method:'DELETE'});
  await loadAccounts();closeModal();renderRows();toast(T('账户已删除。','Account deleted.'));
 });
}
