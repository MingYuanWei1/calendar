import {$,esc,api} from './exam-common.js';
let lang=Number(localStorage.getItem('exam-language')||0),accounts=[],currentId='';
const T=(zh,en)=>lang?en:zh;
const notice=(message,ok=false)=>{$('#accounts-notice').textContent=message;$('#accounts-notice').classList.toggle('success',ok);};
function translate(){document.documentElement.lang=lang?'en':'zh-CN';document.querySelectorAll('[data-zh]').forEach(el=>el.textContent=el.getAttribute(lang?'data-en':'data-zh'));$('#language').textContent=lang?'中文':'EN';}
function render(){
 $('#account-rows').innerHTML=accounts.map(account=>`<tr data-account="${esc(account.id)}"><td><strong>${esc(account.name)}</strong>${account.id===currentId?` · ${T('当前账户','You')}`:''}<small>${esc(account.subject)}</small></td><td>${account.provider==='local'?T('账号密码','Password'):'Microsoft'}</td><td><select aria-label="${esc(T('角色：','Role: ')+account.name)}" ${account.id===currentId?'disabled':''}>${[1,2,3].map(role=>`<option value="${role}" ${role===account.role?'selected':''}>${role} · ${['','reader','moderator','admin'][role]}</option>`).join('')}</select></td><td><input type="checkbox" aria-label="${esc(T('启用：','Enabled: ')+account.name)}" ${!account.disabled?'checked':''} ${account.id===currentId?'disabled':''}></td><td><button data-save ${account.id===currentId?'disabled':''}>${T('保存','Save')}</button> <button data-delete class="delete-account" aria-label="${esc(T('删除账户：','Delete account: ')+account.name)}" ${account.id===currentId?'disabled':''}>${T('删除','Delete')}</button></td></tr>`).join('');
 document.querySelectorAll('[data-save]').forEach(button=>button.addEventListener('click',async()=>{
  const row=button.closest('tr');/** @type {HTMLButtonElement} */(button).disabled=true;
  try{await api('/admin/accounts/'+encodeURIComponent(row.dataset.account),{method:'PATCH',body:JSON.stringify({role:Number(row.querySelector('select').value),disabled:!row.querySelector('input').checked})});await load();notice(T('账户已更新。','Account updated.'),true);}
  catch(error){notice(error.message);}finally{/** @type {HTMLButtonElement} */(button).disabled=false;}
 }));
 document.querySelectorAll('[data-delete]').forEach(button=>button.addEventListener('click',async()=>{
  const row=button.closest('tr'),account=accounts.find(value=>value.id===row.dataset.account);
  const message=T(`确定删除账户“${account.name}”？此操作不可撤销，将清除其登录会话和个人考试选择。`,`Delete account “${account.name}”? This cannot be undone and removes its sessions and personal exam choices.`);
  const schoolNote=account.provider==='microsoft'?T(' 学校账户再次登录时会以 reader 身份重新创建；如需禁止登录，请使用停用。',' School accounts will be recreated as readers on their next sign-in. Disable the account to block sign-in.'):'';
  if(!confirm(message+schoolNote))return;
  const buttons=row.querySelectorAll('button');buttons.forEach(control=>control.disabled=true);
  try{await api('/admin/accounts/'+encodeURIComponent(account.id),{method:'DELETE'});await load();notice(T('账户已删除。','Account deleted.'),true);}
  catch(error){notice(error.message);}finally{buttons.forEach(control=>control.disabled=false);}
 }));

}
async function load(){
 try{
  const session=await api('/session');currentId=session.user?.id||'';
  if(session.user?.role!==3){document.body.hidden=true;location.reload();return;}
  $('#accounts-content').hidden=false;
  accounts=await api('/admin/accounts');render();
 }catch(error){if(error.status===401||error.status===403){document.body.hidden=true;location.reload();return;}$('#accounts-content').hidden=true;notice(error.message);}
}
$('#create-account').onsubmit=async event=>{
 event.preventDefault();const form=/** @type {HTMLFormElement} */(event.target),button=form.querySelector('button');button.disabled=true;
 const values=Object.fromEntries(new FormData(form));
 try{await api('/admin/accounts',{method:'POST',body:JSON.stringify({...values,role:Number(values.role)})});form.reset();await load();notice(T('账户已创建。','Account created.'),true);}catch(error){notice(error.message);}finally{button.disabled=false;}
};
$('#refresh-accounts').onclick=()=>{notice('');load();};
$('#language').onclick=()=>{lang=1-lang;localStorage.setItem('exam-language',String(lang));translate();render();};
window.addEventListener('account-changed',()=>load());translate();load();
