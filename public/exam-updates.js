import {$,esc,api} from './exam-common.js';
export function examUpdates({getBatch,getUser,isSaving,apply,language,notice}){
 let state=null,generation=0,running=false,submitting=false;
 const dialog=$('#exam-updates'),T=(zh,en)=>language()?en:zh;
 const current=(id,uid,version)=>generation===version&&getBatch()?.id===id&&getUser()?.id===uid;
 function reset(){generation++;state=null;running=false;submitting=false;if(dialog.open)dialog.close();$('#import-related').hidden=true;}
 async function check(manual=false){
  if(running||submitting||isSaving()||!getBatch()||!getUser())return;
  const id=getBatch().id,uid=getUser().id,version=generation;running=true;
  try{
   const [next,batch]=await Promise.all([api('/exams/'+id+'/personal-sync',{method:'POST',body:'{}'}),api('/exams/'+id)]);
   if(!current(id,uid,version))return;state=next;apply(batch,next.choices);$('#import-related').hidden=state.status!=='active';
   present(manual);
  }catch(e){if(current(id,uid,version)&&manual)notice(e.message);}finally{if(current(id,uid,version))running=false;}
 }
 function present(manual=false){
  if(!state||submitting||document.querySelector('dialog[open]'))return;
  if(!manual&&state.changes.length){showChanges();return;}
  const offered=manual?state.related.filter(id=>!state.choices.includes(id)):state.newExams;
  if(!offered.length){if(manual)notice(T('暂无待导入的关联考试。','No related exams to import.'));return;}
  const id=getBatch().id,uid=getUser().id,version=generation;
  $('#exam-updates-title').textContent=T('有新的关联考试','New related exams');$('#exam-updates-error').textContent='';
  const sessions=getBatch().sessions;
  $('#exam-updates-content').innerHTML=`<div class="import-exams-list">${offered.map(id=>{const s=sessions.find(s=>s.id===id);return `<label><input type="checkbox" value="${esc(id)}" checked hidden><span>${esc(s?(language()?(s.titleEn||s.title):s.title):id)} · ${esc(s?.date||'')}</span></label>`;}).join('')}</div><div class="sync-options"><button id="import-all">${T('一键导入','Import all')}</button><button id="import-select">${T('选择考试导入','Choose exams')}</button><button id="import-cancel">${T('取消','Cancel')}</button></div>`;
  const finish=async ids=>{if(submitting)return;submitting=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);try{const next=await api('/exams/'+id+'/personal-import',{method:'POST',body:JSON.stringify({offered,ids})});if(!current(id,uid,version))return;state=next;apply(getBatch(),next.choices);dialog.close();}catch(e){if(current(id,uid,version)){if(!ids.length){state.newExams=state.newExams.filter(exam=>!offered.includes(exam));dialog.close();notice(e.message);}else $('#exam-updates-error').textContent=e.message;}}finally{if(current(id,uid,version)){submitting=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);if(!dialog.open)present();}}};
  $('#import-all').onclick=()=>finish(offered);
  $('#import-select').onclick=()=>{dialog.querySelectorAll('input').forEach(el=>el.hidden=false);$('#import-select').textContent=T('导入所选','Import selected');$('#import-select').onclick=()=>finish([...dialog.querySelectorAll('input:checked')].map(el=>/** @type {HTMLInputElement} */(el).value));};
  $('#import-cancel').onclick=()=>finish([]);dialog.oncancel=e=>{e.preventDefault();finish([]);};dialog.showModal();
 }
 function showChanges(){
  const changes=state.changes,id=getBatch().id,uid=getUser().id,version=generation;
  const location=seat=>seat?`${seat.room} · ${seat.row} ${T('排','row')} ${seat.column} ${T('列','column')}`:T('无座位','No seat');
  const labels={added:T('已分配座位','Seat assigned'),changed:T('座位已更改','Seat changed'),removed:T('座位安排已移除','Seat removed'),unavailable:T('座位安排暂不可用','Seating temporarily unavailable'),restored:T('座位安排已恢复','Seating restored')};
  $('#exam-updates-title').textContent=T('考试座位安排有更改','Your exam seating has changed');$('#exam-updates-error').textContent='';
  $('#exam-updates-content').innerHTML=`<ul class="student-changes">${changes.map(change=>{const exam=getBatch().sessions.find(s=>s.id===change.examId);return `<li><strong>${esc(exam?(language()?(exam.titleEn||exam.title):exam.title):change.examId)}</strong><p>${esc(labels[change.kind])}</p>${change.kind==='changed'?`<p>${esc(location(change.before))} → ${esc(location(change.after))}</p>`:change.after?`<p>${esc(location(change.after))}</p>`:''}</li>`;}).join('')}</ul><button id="ack-changes">${T('我知道了','Got it')}</button>`;
  const finish=async()=>{if(submitting)return;submitting=true;$('#ack-changes').disabled=true;try{const next=await api('/exams/'+id+'/personal-ack',{method:'POST',body:JSON.stringify({ids:changes.map(c=>c.id)})});if(!current(id,uid,version))return;state=next;apply(getBatch(),next.choices);dialog.close();}catch(e){if(current(id,uid,version))$('#exam-updates-error').textContent=e.message;}finally{if(current(id,uid,version)){submitting=false;if($('#ack-changes'))$('#ack-changes').disabled=false;if(!dialog.open)present();}}};
  $('#ack-changes').onclick=finish;dialog.oncancel=e=>{e.preventDefault();finish();};dialog.showModal();
 }
 $('#import-related').onclick=()=>check(true);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});window.addEventListener('focus',()=>check());
 document.addEventListener('close',()=>queueMicrotask(()=>present()),true);
 setInterval(()=>{if(!document.hidden)check();},60000);
 return {check,reset};
}
