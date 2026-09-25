import {examUpdates} from './exam-updates.js';
import {examDatePages} from './exam-dates.mjs';
import {seatViewTimes} from './exam-seats.mjs';
import {subjectColors} from './exam-subjects.mjs';
import {downloadExamView,prepareExamPdf} from './exam-export.js';
import {examSlotRows,groupExamLevels} from './exam-times.mjs';
import {$,esc,api,date,monday,divisions,sorted,seatingMarkup} from './exam-common.js';
let detailExamId=null;
let lang=Number(localStorage.getItem('exam-language')||0),batch=null,batches=[],week='',division='high',grade='',mine=false,chosen=new Set(),school={configured:false,user:null},config={timeZone:'Asia/Shanghai'},saving=false,loadNumber=0,detailLoadNumber=0;
const T=(zh,en)=>lang?en:zh;
const title=s=>{const name=lang?(s.titleEn||s.title):s.title.replaceAll('商务管理','商管');return name+[s.level].filter(value=>value&&!name.includes(value)).map(value=>' · '+value).join('');};
const notice=(message,error=true)=>{$('#notice').textContent=message;$('#notice').classList.toggle('success',!error);};
const scopeSessions=()=>batch?batch.sessions.filter(s=>mine?chosen.has(s.id):s.division===division&&(!grade||s.grades.includes(grade))):[];
function render(){
 document.documentElement.lang=lang?'en':'zh-CN';document.querySelectorAll('[data-zh]').forEach(el=>el.textContent=el.getAttribute(lang?'data-en':'data-zh'));
 $('#language').textContent=lang?'中文':'EN';$('#language').setAttribute('aria-label',lang?'切换为中文':'Switch to English');
 $('#all-mode').textContent=T('全部考试','All exams');$('#mine-mode').textContent=T('我的考试','My exams');$('#all-mode').setAttribute('aria-pressed',String(!mine));$('#mine-mode').setAttribute('aria-pressed',String(mine));$('#division-filters').hidden=mine;
 $('#download').textContent=T('下载 PDF','Download PDF');$('#download').disabled=!batch;
 $('#batch').innerHTML=batches.map(b=>`<option value="${esc(b.id)}" ${b.id===batch?.id?'selected':''}>${esc(title(b))}</option>`).join('');
 $('#batch-dates').textContent=batch?`${batch.start} — ${batch.end}`:'';
 $('#divisions').innerHTML=Object.entries(divisions).map(([key,value])=>`<button data-division="${key}" aria-pressed="${division===key}">${value[lang]}</button>`).join('');
 const grades=[...new Set((batch?.sessions||[]).filter(s=>s.division===division).flatMap(s=>s.grades))].sort();
 $('#grade').innerHTML=`<option value="">${T('全部年级','All grades')}</option>`+grades.map(g=>`<option ${g===grade?'selected':''}>${esc(g)}</option>`).join('');
 document.querySelectorAll('[data-division]').forEach(el=>el.addEventListener('click',()=>{division=el.getAttribute('data-division');grade='';render();}));
 $('#current').textContent=T('本批次首周','First week');$('#previous').setAttribute('aria-label',T('上一周','Previous week'));$('#next').setAttribute('aria-label',T('下一周','Next week'));
 if(!batch){for(const id of ['previous','current','next'])$('#'+id).hidden=true;$('#schedule').innerHTML=`<p class="no-exams">${T('暂无已发布考试批次','No published exam series')}</p>`;return;}
 const visible=sorted(scopeSessions()),pages=examDatePages(visible);
 let page=pages.findIndex(days=>days.includes(week));if(page<0)page=0;
 const shownDays=pages[page]||[];week=shownDays[0]||'';
 for(const id of ['previous','current','next'])$('#'+id).hidden=pages.length<=1;
 $('#previous').disabled=page===0;$('#next').disabled=page>=pages.length-1;
 $('#schedule').innerHTML=shownDays.length?scheduleMarkup(visible,shownDays,!mine):`<p class="no-exams">${T('当前范围暂无考试','No exams in this selection')}</p>`;
 $('#published').textContent=`${T('发布于','Published')} ${new Intl.DateTimeFormat(lang?'en-GB':'zh-CN',{timeZone:config.timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(batch.publishedAt))}`;
 const own=sorted(batch.sessions.filter(s=>chosen.has(s.id)&&!s.cancelled)),clashes=[];
 for(let i=0;i<own.length;i++)for(let j=i+1;j<own.length;j++)if(own[i].date===own[j].date&&own[i].start<own[j].end&&own[j].start<own[i].end)clashes.push(`${title(own[i])} / ${title(own[j])}`);
 $('#conflicts').hidden=!clashes.length;$('#conflicts').textContent=T('已选考试时间冲突：','Your selected exams overlap: ')+clashes.join('；');
 document.querySelectorAll('[data-choice]').forEach(el=>el.addEventListener('change',()=>{const next=new Set(chosen),id=el.getAttribute('data-choice');next.has(id)?next.delete(id):next.add(id);saveChoices(next);}));
 document.querySelectorAll('[data-exam]').forEach(el=>el.addEventListener('click',()=>showDetail(el.getAttribute('data-exam'))));
}
function scheduleMarkup(visible,shownDays,highlightSelected=true){
 const thisWeek=sorted(visible).filter(s=>shownDays.includes(s.date));
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:config.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 // Use the full batch so filtering, language and selection never reshuffle colors.
 const colorStyle=subjectColors(batch.sessions,batch.subjects||[]);
 const card=s=>`<article style="${colorStyle(s)}" class="exam-card${highlightSelected&&chosen.has(s.id)?' chosen':''}${s.cancelled?' cancelled':''}"><label>${mine?'':`<input type="checkbox" data-choice="${esc(s.id)}" ${chosen.has(s.id)?'checked':''} ${!school.user||saving?'disabled':''} aria-label="${esc(T('选择 ','Select ')+title(s))}">`}<button data-exam="${esc(s.id)}"><time>${s.start}–${s.end}</time><h3>${esc(title(s))}</h3><p>${esc(s.rooms.join(' / '))} · ${esc(s.grades.join(' / '))}</p>${s.cancelled?`<span class="status">${T('已取消','Cancelled')}</span>`:s.changed?`<span class="status">${T('已变更','Updated')}</span>`:''}</button></label></article>`;
 const levelGroup=items=>{
  if(!items[0].subject||!items[0].level)return items.map(card).join('');
  const first=items[0];
  return `<article class="exam-group" style="${colorStyle(first)}"><header><div><h3>${esc(lang?(first.subjectEn||first.subject):first.subject.replaceAll('商务管理','商管'))}</h3><p class="exam-group-grade">${esc(first.grades.join(' / '))}</p></div></header><div class="exam-levels">${items.map(s=>`<div class="exam-level${highlightSelected&&chosen.has(s.id)?' chosen':''}${s.cancelled?' cancelled':''}">${mine?'':`<input type="checkbox" data-choice="${esc(s.id)}" ${chosen.has(s.id)?'checked':''} ${!school.user||saving?'disabled':''} aria-label="${esc(T('选择 ','Select ')+title(s))}">`}<button data-exam="${esc(s.id)}" aria-label="${esc(title(s))}"><strong>${esc(s.level).replace(/ (?=\d+$)/,'&nbsp;')}</strong><time>${s.start}–${s.end}</time><p>${esc(s.rooms.join(' / '))}</p>${s.cancelled?`<span class="status">${T('已取消','Cancelled')}</span>`:s.changed?`<span class="status">${T('已变更','Updated')}</span>`:''}</button></div>`).join('')}</div></article>`;
 };
 const rows=examSlotRows(batch.timeSlots,thisWeek);
 return `<table class="exam-time-grid" style="--day-count:${shownDays.length}"><thead><tr><th class="time-axis">${T('时间段','Time slot')}</th>${shownDays.map(day=>`<th class="exam-day-header${day===today?' today':''}"><small>${new Intl.DateTimeFormat(lang?'en-GB':'zh-CN',{weekday:'short'}).format(date(day))}</small><strong>${date(day).getDate()}</strong></th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><th scope="row" class="time-axis"><time>${row.start}</time><span>–</span><time>${row.end}</time></th>${shownDays.map(day=>`<td class="${[0,6].includes(date(day).getDay())?'weekend':''}">${groupExamLevels(row.sessions.filter(s=>s.date===day)).map(levelGroup).join('')||`<span class="empty-slot" aria-label="${T('暂无考试','No exams')}">—</span>`}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
const updates=examUpdates({getBatch:()=>batch,getUser:()=>school.user,isSaving:()=>saving,language:()=>lang,notice,apply:(data,ids)=>{const changed=batch?.seatingPublishedAt!==data.seatingPublishedAt||batch?.publishedAt!==data.publishedAt;batch=data;chosen=new Set(ids);render();if(changed&&$('#detail').open&&detailExamId)showDetail(detailExamId);}});
async function loadBatch(id){
 updates.reset();const generation=++loadNumber;detailLoadNumber++;$('#detail').close();$('#download').disabled=true;
 try{const [data,sync]=await Promise.all([api('/exams/'+id),school.user?api('/exams/'+id+'/personal-sync',{method:'POST',body:'{}'}):{choices:[]}]);if(generation!==loadNumber)return;batch=data;chosen=new Set(sync.choices);week=monday(batch.start);grade='';render();history.replaceState(null,'','?batch='+encodeURIComponent(id));await updates.check();}
 catch(e){if(generation===loadNumber){batch=null;render();notice(e.message);}}
}
async function saveChoices(next){
 if(mine||saving||!school.user)return;updates.reset();saving=true;render();const id=batch.id;
 try{const ids=await api('/exams/'+id+'/choices',{method:'PUT',body:JSON.stringify({ids:[...next]})});if(batch?.id===id){chosen=new Set(ids);notice(T('选择已保存','Selections saved'),false);}}
 catch(e){notice(e.message);}finally{saving=false;render();await updates.check();}
}
async function showDetail(id){
 const generation=++detailLoadNumber;
 const exam=batch.sessions.find(s=>s.id===id);if(!exam){$('#detail').close();return;}detailExamId=id;
 $('#detail-title').textContent=title(exam);
 $('#detail-content').innerHTML=`<dl class="detail-meta"><dt>${T('时间','Time')}</dt><dd>${exam.date} ${exam.start}–${exam.end}</dd><dt>${T('适用','For')}</dt><dd>${esc(divisions[exam.division][lang])} · ${esc(exam.grades.join(' / '))}</dd><dt>${T('地点','Rooms')}</dt><dd>${esc(exam.rooms.join(' / '))}</dd></dl>${exam.cancelled?`<p class="warning">${T('此考试已取消','This exam is cancelled')}</p>`:''}<p>${esc(exam.note)}</p><div id="seating-content"><p class="muted">${T('正在读取座位表…','Loading seating…')}</p></div>`;$('#detail').showModal();
 if(!school.user){$('#seating-content').innerHTML=`<p class="muted">${T('请使用学校账号登录后查看座位表。','Sign in with your school account to view seating.')}</p><a href="/api/school/login?returnTo=${esc(encodeURIComponent(location.pathname+location.search+location.hash))}">Microsoft ${T('登录','sign-in')}</a>`;return;}
  try{
  const seating=await api('/exams/'+batch.id+'/seats');if(!$('#detail').open||generation!==detailLoadNumber)return;
  let room=seating.personal?.[exam.id]?.room||exam.rooms[0],point=exam.start;
  const renderSeats=()=>{
   const times=seatViewTimes(batch,exam,room);if(!times.includes(point))point=exam.start;
   $('#seating-content').innerHTML=`<div class="room-tabs">${exam.rooms.map(r=>`<button data-room="${esc(r)}" aria-pressed="${r===room}">${esc(r)}</button>`).join('')}</div><label class="time-select">${T('查看时刻','View at')}<select id="seat-time">${times.map(time=>`<option value="${esc(time)}" ${time===point?'selected':''}>${esc(time)}</option>`).join('')}</select></label><div id="seat-grid">${seatingMarkup(batch,seating,exam,room,point,lang,false,seating.personal?.[exam.id])}</div>`;
   document.querySelectorAll('[data-room]').forEach(el=>el.addEventListener('click',()=>{room=el.getAttribute('data-room');point=exam.start;renderSeats();}));
   $('#seat-time').onchange=()=>{point=$('#seat-time').value;renderSeats();};
  };renderSeats();
 }catch(e){if(generation===detailLoadNumber&&$('#detail').open)$('#seating-content').textContent=e.message;}
}
$('#close-detail').onclick=()=>{detailLoadNumber++;$('#detail').close();};$('#batch').onchange=()=>loadBatch($('#batch').value);$('#grade').onchange=()=>{grade=$('#grade').value;render();};
$('#all-mode').onclick=()=>{mine=false;render();};$('#mine-mode').onclick=()=>{if(!school.user){notice(T('请先使用学校 Microsoft 账号登录。','Please sign in with your school Microsoft account.'));return;}mine=true;render();};
function changeExamPage(offset){const pages=examDatePages(scopeSessions()),index=pages.findIndex(days=>days.includes(week));week=pages[Math.max(0,Math.min(pages.length-1,index+offset))]?.[0]||'';render();}
$('#previous').onclick=()=>changeExamPage(-1);$('#next').onclick=()=>changeExamPage(1);$('#current').onclick=()=>{week='';render();};
$('#language').onclick=()=>{lang=1-lang;localStorage.setItem('exam-language',String(lang));render();};
function updateDownloadScope(){
 const scope=$('input[name="pdf-scope"]:checked').value;
 $('#pdf-grades').hidden=scope!=='grades';
 $('#pdf-error').textContent='';
}
$('#download').onclick=()=>{
 if(!batch)return;
 prepareExamPdf().catch(()=>{});
 $('#pdf-title').textContent=T('下载考试表','Download exam schedule');
 $('#pdf-description').textContent=T('导出整个批次，按学部和周分页，保留考试表布局。','Export the full series, with separate pages by division and week.');
 $('#pdf-all-label').textContent=T('下载全部考试','All exams');$('#pdf-grade-label').textContent=T('下载所选年级考试','Selected grades');$('#pdf-mine-label').textContent=T('下载我的考试','My exams');$('#pdf-grade-summary').textContent=T('选择年级（可多选）','Choose grades (multiple)');$('#pdf-submit').textContent=T('下载 PDF','Download PDF');
 $('#pdf-mine').disabled=!school.user;
 $('#pdf-grade-options').innerHTML=Object.entries(divisions).map(([key,names])=>{const grades=[...new Set(batch.sessions.filter(s=>s.division===key).flatMap(s=>s.grades))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));return grades.length?`<fieldset><legend>${names[lang]}</legend>${grades.map(g=>`<label class="pdf-grade-option"><input type="checkbox" data-division="${key}" value="${esc(g)}" ${key===division&&g===grade?'checked':''}>${esc(g)}</label>`).join('')}</fieldset>`:'';}).join('');
 $(`input[name="pdf-scope"][value="${mine?'mine':grade?'grades':'all'}"]`).checked=true;
 updateDownloadScope();$('#pdf-dialog').showModal();
};
$('#pdf-dialog').addEventListener('change',event=>{if(event.target.name==='pdf-scope')updateDownloadScope();});
$('#pdf-close').onclick=()=>$('#pdf-dialog').close();
$('#pdf-submit').onclick=async()=>{
 const scope=$('input[name="pdf-scope"]:checked').value;
 const selected=[...document.querySelectorAll('#pdf-grade-options input:checked')].map(el=>({division:el.getAttribute('data-division'),grade:/** @type {HTMLInputElement} */(el).value}));
 if(scope==='grades'&&!selected.length){$('#pdf-error').textContent=T('请至少选择一个年级。','Choose at least one grade.');return;}
 if(scope==='mine'&&!school.user)return;
 const sessions=batch.sessions.filter(s=>scope==='all'||(scope==='mine'?chosen.has(s.id):selected.some(g=>g.division===s.division&&s.grades.includes(g.grade))));
 if(!sessions.length){$('#pdf-error').textContent=T('此范围暂无考试。','No exams in this selection.');return;}
 const container=document.createElement('div');container.className='pdf-export-host';
 const panels=[];
 for(const [key,names] of Object.entries(divisions)){
  const scoped=sessions.filter(s=>s.division===key);if(!scoped.length)continue;
  for(const exportDays of examDatePages(scoped)){
   const panel=document.createElement('section');panel.className='schedule-panel';
   panel.innerHTML=`<div class="selection-toolbar"><span>${esc(title(batch))} · ${names[lang]} · ${exportDays[0]} — ${exportDays.at(-1)}</span></div><div class="schedule">${scheduleMarkup(scoped,exportDays,scope==='grades')}</div><footer>${esc($('#published').textContent)}</footer>`;
   container.append(panel);panels.push(panel);
  }
 }
 document.body.append(container);$('#pdf-submit').disabled=true;$('#pdf-close').disabled=true;
 try{await downloadExamView(`exam-schedule-${scope}-${batch.start}.pdf`,panels,stage=>{$('#pdf-submit').textContent=stage==='fonts'?T('正在加载字体…','Loading fonts…'):stage==='layout'?T('正在排版…','Preparing layout…'):T('正在生成 PDF…','Generating PDF…');});$('#pdf-dialog').close();}
 catch(error){$('#pdf-error').textContent=T('PDF 导出失败，请重试。','PDF export failed. Please retry.');}
 finally{container.remove();$('#pdf-submit').textContent=T('下载 PDF','Download PDF');$('#pdf-submit').disabled=false;$('#pdf-close').disabled=false;}
};
async function start(){try{[school,batches,config]=await Promise.all([api('/school/session'),api('/exams'),api('/config')]);const params=new URLSearchParams(location.search),requested=batches.find(b=>b.id===params.get('batch'));const today=new Intl.DateTimeFormat('en-CA',{timeZone:config.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(Object.hasOwn(divisions,params.get('division')))division=params.get('division');const matching=batches.find(b=>b.start<=params.get('date')&&b.end>=params.get('date'));const nearest=[...batches].filter(b=>b.end>=today).sort((a,b)=>a.start.localeCompare(b.start))[0];render();if(batches.length)await loadBatch((requested||matching||nearest||batches[0]).id);if(params.has('auth'))notice(params.get('auth')==='unconfigured'?T('学校 Microsoft SSO 尚未配置，请联系管理员。','Microsoft SSO is not configured.'):T('登录未完成，请重试。','Sign-in failed. Please retry.'));}catch(e){notice(e.message);}}
start();

window.addEventListener('account-changed',()=>location.reload());
