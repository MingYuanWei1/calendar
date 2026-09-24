import {$,esc,api} from './exam-common.js';
let students=[];
$('#language').hidden=true;
async function load(){try{const [settings,list]=await Promise.all([api('/admin/students/settings'),api('/admin/students')]);$('#domain').value=settings.domain;students=list;render();}catch(e){$('#notice').textContent=e.message;}}
function render(){const query=$('#search').value.toLowerCase();$('#students').innerHTML=students.filter(s=>JSON.stringify(s).toLowerCase().includes(query)).map(s=>`<article class="admin-panel"><h2>${esc(s.name||s.englishName)}</h2><p>${esc(s.englishName)} · ${esc(s.className)} · ${s.graduationYear||'届别待补充'}</p><p>${esc(s.pinyin)} · ${esc(s.email||'邮箱待补充')}</p><p class="warning">${s.issues.map(esc).join('；')}</p><small>学生编号 ${esc(s.id)}</small><p><button data-student="${esc(s.id)}">核实 / 修正</button></p></article>`).join('')||'<p>暂无学生。在考试管理中录入座位后保存草稿。</p>';}
$('#search').oninput=render;
$('#settings').onsubmit=async e=>{e.preventDefault();try{await api('/admin/students/settings',{method:'PUT',body:JSON.stringify({domain:$('#domain').value})});await load();$('#notice').textContent='域名已保存。请重新发布需要更新的座位表。';}catch(e){$('#notice').textContent=e.message;}};
window.addEventListener('account-changed',()=>location.reload());
load();

async function editStudent(id){
 const s=students.find(s=>s.id===id);if(!s)return;
 const field=(key,label,type='text')=>`<label>${label}<input name="${key}" type="${type}" value="${esc(s[key]??'')}"></label>`;
 $('#student-form').innerHTML=`<form id="identity-form" class="form-grid">${field('name','中文名')}${field('englishName','英文名')}${field('className','班级（最近学年）')}${field('graduationYear','毕业年份','number')}${field('pinyin','姓名拼音（小写）')}${field('actualEmail','实际邮箱（可选）','email')}<button class="primary">保存修正</button></form><p>修正仅影响之后发布的座位。已发布结果保持不变。</p><h3>关联座位</h3><ul>${(s.references||[]).map(r=>`<li>${r.kind==='draft'?'草稿':'已发布'} · ${esc(r.examId)} · ${esc(r.room)} · ${r.row} 排 ${r.column} 列</li>`).join('')}</ul><h3>合并重复学生</h3><label>保留的学生<select id="merge-target"><option value="">请选择</option>${students.filter(t=>t.id!==id).map(t=>`<option value="${esc(t.id)}">${esc(t.name||t.englishName)} · ${esc(t.className)} · ${esc(t.email)}</option>`).join('')}</select></label><button id="merge-preview">预览合并</button><div id="merge-result"></div><p id="student-error" role="alert"></p>`;
 $('#identity-form').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));try{await api('/admin/students/'+id,{method:'PATCH',body:JSON.stringify({...data,graduationYear:data.graduationYear?Number(data.graduationYear):null,version:s.version})});$('#student-dialog').close();await load();}catch(e){$('#student-error').textContent=e.message;}};
 $('#merge-preview').onclick=async()=>{try{const targetId=$('#merge-target').value;if(!targetId)throw new Error('请选择保留的学生');const result=await api('/admin/students/'+id+'/merge-preview?target='+encodeURIComponent(targetId));$('#merge-result').innerHTML=result.errors.length?`<p class="warning">${result.errors.map(esc).join('；')}</p>`:`<p>将 ${esc(s.name)} 合并至 ${esc(result.target.name)}，影响 ${result.references.length} 条草稿/已发布座位引用。草稿关联会更新，已发布座位需重新发布。</p><button id="confirm-merge">确认合并</button>`;if($('#confirm-merge'))$('#confirm-merge').onclick=async()=>{try{await api('/admin/students/'+id+'/merge',{method:'POST',body:JSON.stringify({targetId,version:result.source.version,targetVersion:result.target.version})});$('#student-dialog').close();await load();}catch(e){$('#student-error').textContent=e.message;}};}catch(e){$('#student-error').textContent=e.message;}};
 $('#student-dialog').showModal();
}
$('#close-student').onclick=()=>$('#student-dialog').close();
$('#students').onclick=e=>{const button=e.target.closest('[data-student]');if(button)editStudent(button.dataset.student);};
