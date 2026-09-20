import {subjectColors} from './exam-subjects.mjs';
import {downloadExamView} from './exam-export.js';
import {examSlotRows,groupExamLevels} from './exam-times.mjs';
import {$,esc,api,date,addDays,monday,divisions,sorted,seatingMarkup} from './exam-common.js';
let lang=Number(localStorage.getItem('exam-language')||0),batch=null,batches=[],week='',division='high',grade='',mine=false,chosen=new Set(),school={configured:false,user:null},config={timeZone:'Asia/Shanghai',schoolName:'学校校历',schoolNameEn:'School calendar'},saving=false,loadNumber=0;
const T=(zh,en)=>lang?en:zh;
const title=s=>{const name=lang?(s.titleEn||s.title):s.title.replaceAll('商务管理','商管');return name+[s.level].filter(value=>value&&!name.includes(value)).map(value=>' · '+value).join('');};
const notice=(message,error=true)=>{$('#notice').textContent=message;$('#notice').classList.toggle('success',!error);};
const shownWeekDays=(days,sessions)=>days.filter((day,index)=>index<5||sessions.some(exam=>exam.date===day));
const scopeSessions=()=>batch?batch.sessions.filter(s=>mine?chosen.has(s.id):s.division===division&&(!grade||s.grades.includes(grade))):[];
function render(){
 document.documentElement.lang=lang?'en':'zh-CN';document.querySelectorAll('[data-zh]').forEach(el=>el.textContent=el.getAttribute(lang?'data-en':'data-zh'));
 $('#language').textContent=lang?'中文':'EN';$('#language').setAttribute('aria-label',lang?'切换为中文':'Switch to English');$('[data-school-name]').textContent=lang?(config.schoolNameEn||'School calendar'):(config.schoolName||'学校校历');
 $('#all-mode').textContent=T('全部考试','All exams');$('#mine-mode').textContent=T('我的考试','My exams');$('#all-mode').setAttribute('aria-pressed',String(!mine));$('#mine-mode').setAttribute('aria-pressed',String(mine));$('#division-filters').hidden=mine;
 $('#download').textContent=T('下载 PDF','Download PDF');$('#download').disabled=!batch;
 $('#batch').innerHTML=batches.map(b=>`<option value="${esc(b.id)}" ${b.id===batch?.id?'selected':''}>${esc(title(b))}</option>`).join('');
 $('#batch-dates').textContent=batch?`${batch.start} — ${batch.end}`:'';
 $('#divisions').innerHTML=Object.entries(divisions).map(([key,value])=>`<button data-division="${key}" aria-pressed="${division===key}">${value[lang]}</button>`).join('');
 const grades=[...new Set((batch?.sessions||[]).filter(s=>s.division===division).flatMap(s=>s.grades))].sort();
 $('#grade').innerHTML=`<option value="">${T('全部年级','All grades')}</option>`+grades.map(g=>`<option ${g===grade?'selected':''}>${esc(g)}</option>`).join('');
 document.querySelectorAll('[data-division]').forEach(el=>el.addEventListener('click',()=>{division=el.getAttribute('data-division');grade='';render();}));
 $('#current').textContent=T('本批次首周','First week');$('#previous').setAttribute('aria-label',T('上一周','Previous week'));$('#next').setAttribute('aria-label',T('下一周','Next week'));
 if(!batch){$('#schedule').innerHTML=`<p class="no-exams">${T('暂无已发布考试批次','No published exam series')}</p>`;$('#range').textContent='';return;}
 const days=Array.from({length:7},(_,i)=>addDays(week,i)),visible=sorted(scopeSessions()),thisWeek=visible.filter(s=>days.includes(s.date));
 const shownDays=shownWeekDays(days,thisWeek);
 $('#range').textContent=`${shownDays[0]} — ${shownDays.at(-1)}`;$('#previous').disabled=week<=monday(batch.start);$('#next').disabled=days[6]>=batch.end;
 $('#schedule').innerHTML=scheduleMarkup(visible,week,!mine);
 $('#published').textContent=`${T('发布于','Published')} ${new Intl.DateTimeFormat(lang?'en-GB':'zh-CN',{timeZone:config.timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(batch.publishedAt))} · ${config.timeZone}`;
 const own=sorted(batch.sessions.filter(s=>chosen.has(s.id)&&!s.cancelled)),clashes=[];
 for(let i=0;i<own.length;i++)for(let j=i+1;j<own.length;j++)if(own[i].date===own[j].date&&own[i].start<own[j].end&&own[j].start<own[i].end)clashes.push(`${title(own[i])} / ${title(own[j])}`);
 $('#conflicts').hidden=!clashes.length;$('#conflicts').textContent=T('已选考试时间冲突：','Your selected exams overlap: ')+clashes.join('；');
 document.querySelectorAll('[data-choice]').forEach(el=>el.addEventListener('change',()=>{const next=new Set(chosen),id=el.getAttribute('data-choice');next.has(id)?next.delete(id):next.add(id);saveChoices(next);}));
 document.querySelectorAll('[data-exam]').forEach(el=>el.addEventListener('click',()=>showDetail(el.getAttribute('data-exam'))));
}
function scheduleMarkup(visible,weekValue,highlightSelected=true){
 const days=Array.from({length:7},(_,i)=>addDays(weekValue,i)),thisWeek=sorted(visible).filter(s=>days.includes(s.date));
 const shownDays=shownWeekDays(days,thisWeek);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:config.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 // Use the full batch so filtering, language and selection never reshuffle colors.
 const colorStyle=subjectColors(batch.sessions,batch.subjects||[]);
 const card=s=>`<article style="${colorStyle(s)}" class="exam-card${highlightSelected&&chosen.has(s.id)?' chosen':''}${s.cancelled?' cancelled':''}"><label>${mine?'':`<input type="checkbox" data-choice="${esc(s.id)}" ${chosen.has(s.id)?'checked':''} ${!school.user||saving?'disabled':''} aria-label="${esc(T('选择 ','Select ')+title(s))}">`}<button data-exam="${esc(s.id)}"><time>${s.start}–${s.end}</time><h3>${esc(title(s))}</h3><p>${esc(s.rooms.join(' / '))} · ${esc(s.grades.join(' / '))}</p>${s.cancelled?`<span class="status">${T('已取消','Cancelled')}</span>`:s.changed?`<span class="status">${T('已变更','Updated')}</span>`:''}</button></label></article>`;
 const levelGroup=items=>{
  if(!items[0].subject||!items[0].level)return items.map(card).join('');
  const first=items[0];
  return `<article class="exam-group" style="${colorStyle(first)}"><header><div><h3>${esc(lang?(first.subjectEn||first.subject):first.subject.replaceAll('商务管理','商管'))}</h3><p class="exam-group-grade">${esc(first.grades.join(' / '))}</p></div></header><div class="exam-levels">${items.map(s=>`<div class="exam-level${highlightSelected&&chosen.has(s.id)?' chosen':''}${s.cancelled?' cancelled':''}">${mine?'':`<input type="checkbox" data-choice="${esc(s.id)}" ${chosen.has(s.id)?'checked':''} ${!school.user||saving?'disabled':''} aria-label="${esc(T('选择 ','Select ')+title(s))}">`}<button data-exam="${esc(s.id)}" aria-label="${esc(title(s))}"><strong>${esc(s.level)}</strong><time>${s.start}–${s.end}</time><p>${esc(s.rooms.join(' / '))}</p>${s.cancelled?`<span class="status">${T('已取消','Cancelled')}</span>`:s.changed?`<span class="status">${T('已变更','Updated')}</span>`:''}</button></div>`).join('')}</div></article>`;
 };
 const rows=examSlotRows(batch.timeSlots,thisWeek);
 return `<table class="exam-time-grid" style="--day-count:${shownDays.length}"><thead><tr><th class="time-axis">${T('时间段','Time slot')}</th>${shownDays.map(day=>`<th class="exam-day-header${day===today?' today':''}"><small>${new Intl.DateTimeFormat(lang?'en-GB':'zh-CN',{weekday:'short'}).format(date(day))}</small><strong>${date(day).getDate()}</strong></th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><th scope="row" class="time-axis"><time>${row.start}</time><span>–</span><time>${row.end}</time></th>${shownDays.map(day=>`<td class="${[0,6].includes(date(day).getDay())?'weekend':''}">${groupExamLevels(row.sessions.filter(s=>s.date===day)).map(levelGroup).join('')||`<span class="empty-slot" aria-label="${T('暂无考试','No exams')}">—</span>`}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
async function loadBatch(id){
 const generation=++loadNumber;$('#download').disabled=true;
 try{const [data,ids]=await Promise.all([api('/exams/'+id),school.user?api('/exams/'+id+'/choices'):[]]);if(generation!==loadNumber)return;batch=data;chosen=new Set(ids);week=monday(batch.start);grade='';render();history.replaceState(null,'','?batch='+encodeURIComponent(id));}
 catch(e){if(generation===loadNumber){batch=null;render();notice(e.message);}}
}
async function saveChoices(next){
 if(mine||saving||!school.user)return;saving=true;render();const id=batch.id;
 try{const ids=await api('/exams/'+id+'/choices',{method:'PUT',body:JSON.stringify({ids:[...next]})});if(batch?.id===id){chosen=new Set(ids);notice(T('选择已保存','Selections saved'),false);}}
 catch(e){notice(e.message);}finally{saving=false;render();}
}
async function showDetail(id){
 const exam=batch.sessions.find(s=>s.id===id);if(!exam)return;
 $('#detail-title').textContent=title(exam);
 $('#detail-content').innerHTML=`<dl class="detail-meta"><dt>${T('时间','Time')}</dt><dd>${exam.date} ${exam.start}–${exam.end}</dd><dt>${T('适用','For')}</dt><dd>${esc(divisions[exam.division][lang])} · ${esc(exam.grades.join(' / '))}</dd><dt>${T('地点','Rooms')}</dt><dd>${esc(exam.rooms.join(' / '))}</dd></dl>${exam.cancelled?`<p class="warning">${T('此考试已取消','This exam is cancelled')}</p>`:''}<p>${esc(exam.note)}</p><div id="seating-content"><p class="muted">${T('正在读取座位表…','Loading seating…')}</p></div>`;$('#detail').showModal();
 if(!school.user){$('#seating-content').innerHTML=`<p class="muted">${T('请使用学校账号登录后查看座位表。','Sign in with your school account to view seating.')}</p><a href="/api/school/login?returnTo=${esc(encodeURIComponent(location.pathname+location.search+location.hash))}">Microsoft ${T('登录','sign-in')}</a>`;return;}
 if(!batch.seatingPublished){$('#seating-content').textContent=T('座位表待公布','Seating will be published later');return;}
 try{
  const seating=await api('/exams/'+batch.id+'/seats');if(!$('#detail').open)return;
  let room=exam.rooms[0];
  const renderSeats=()=>{
   const sessions=batch.sessions.filter(s=>s.date===exam.date&&s.rooms.includes(room)&&!s.cancelled&&s.start<exam.end&&exam.start<s.end);
   const points=[...new Set([exam.start,...sessions.flatMap(s=>[s.start,s.end]).filter(t=>t>exam.start&&t<exam.end)])].sort();
   $('#seating-content').innerHTML=`<div class="room-tabs">${exam.rooms.map(r=>`<button data-room="${esc(r)}" aria-pressed="${r===room}">${esc(r)}</button>`).join('')}</div><label class="time-select">${T('查看时段（含本教室混考）','Time slot (all exams in this room)')}<select id="seat-time">${points.map((t,i)=>`<option value="${t}">${t}–${points[i+1]||exam.end}</option>`).join('')}</select></label><div id="seat-grid"></div>`;
   const draw=()=>$('#seat-grid').innerHTML=seatingMarkup(batch,seating,exam,room,$('#seat-time').value,lang);draw();$('#seat-time').onchange=draw;
   document.querySelectorAll('[data-room]').forEach(el=>el.addEventListener('click',()=>{room=el.getAttribute('data-room');renderSeats();}));
  };renderSeats();
 }catch(e){$('#seating-content').textContent=e.message;}
}
$('#close-detail').onclick=()=>$('#detail').close();$('#batch').onchange=()=>loadBatch($('#batch').value);$('#grade').onchange=()=>{grade=$('#grade').value;render();};
$('#all-mode').onclick=()=>{mine=false;render();};$('#mine-mode').onclick=()=>{if(!school.user){notice(T('请先使用学校 Microsoft 账号登录。','Please sign in with your school Microsoft account.'));return;}mine=true;render();};
$('#previous').onclick=()=>{week=addDays(week,-7);render();};$('#next').onclick=()=>{week=addDays(week,7);render();};$('#current').onclick=()=>{week=monday(batch.start);render();};
$('#language').onclick=()=>{lang=1-lang;localStorage.setItem('exam-language',String(lang));render();};
function updateDownloadScope(){
 const scope=$('input[name="pdf-scope"]:checked').value;
 $('#pdf-grades').hidden=scope!=='grades';
 $('#pdf-error').textContent='';
}
$('#download').onclick=()=>{
 if(!batch)return;
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
  for(let start=monday(batch.start);start<=batch.end;start=addDays(start,7)){
   if(!scoped.some(s=>s.date>=start&&s.date<=addDays(start,6)))continue;
   const exportDays=shownWeekDays(Array.from({length:7},(_,i)=>addDays(start,i)),scoped);
   const panel=document.createElement('section');panel.className='schedule-panel';
   panel.innerHTML=`<div class="selection-toolbar"><span>${esc(title(batch))} · ${names[lang]} · ${exportDays[0]} — ${exportDays.at(-1)}</span></div><div class="schedule">${scheduleMarkup(scoped,start,scope==='grades')}</div><footer>${esc($('#published').textContent)}</footer>`;
   container.append(panel);panels.push(panel);
  }
 }
 document.body.append(container);$('#pdf-submit').disabled=true;$('#pdf-close').disabled=true;
 try{await downloadExamView(`exam-schedule-${scope}-${batch.start}.pdf`,panels);$('#pdf-dialog').close();}
 catch(error){$('#pdf-error').textContent=T('PDF 导出失败，请重试。','PDF export failed. Please retry.');}
 finally{container.remove();$('#pdf-submit').disabled=false;$('#pdf-close').disabled=false;}
};
async function start(){try{[school,batches,config]=await Promise.all([api('/school/session'),api('/exams'),api('/config')]);const params=new URLSearchParams(location.search),requested=batches.find(b=>b.id===params.get('batch'));const today=new Intl.DateTimeFormat('en-CA',{timeZone:config.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(Object.hasOwn(divisions,params.get('division')))division=params.get('division');const matching=batches.find(b=>b.start<=params.get('date')&&b.end>=params.get('date'));const nearest=[...batches].filter(b=>b.end>=today).sort((a,b)=>a.start.localeCompare(b.start))[0];render();if(batches.length)await loadBatch((requested||matching||nearest||batches[0]).id);if(params.has('auth'))notice(params.get('auth')==='unconfigured'?T('学校 Microsoft SSO 尚未配置，请联系管理员。','Microsoft SSO is not configured.'):T('登录未完成，请重试。','Sign-in failed. Please retry.'));}catch(e){notice(e.message);}}
start();
