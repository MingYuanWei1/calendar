import {examSlotRows} from './exam-times.mjs';
import {$,esc,api,date,addDays,monday,divisions,sorted,seatingMarkup} from './exam-common.js';
let lang=Number(localStorage.getItem('exam-language')||0),batch=null,batches=[],week='',division='high',grade='',mine=false,chosen=new Set(),school={configured:false,user:null},config={timeZone:'Asia/Shanghai',schoolName:'学校校历',schoolNameEn:'School calendar'},saving=false,loadNumber=0;
const T=(zh,en)=>lang?en:zh;
const title=s=>lang?(s.titleEn||s.title):s.title;
const notice=(message,error=true)=>{$('#notice').textContent=message;$('#notice').classList.toggle('success',!error);};
const scopeSessions=()=>batch?batch.sessions.filter(s=>mine?chosen.has(s.id):s.division===division&&(!grade||s.grades.includes(grade))):[];
function render(){
 document.documentElement.lang=lang?'en':'zh-CN';document.querySelectorAll('[data-zh]').forEach(el=>el.textContent=el.getAttribute(lang?'data-en':'data-zh'));
 $('#language').textContent=lang?'中文':'EN';$('#language').setAttribute('aria-label',lang?'切换为中文':'Switch to English');$('[data-school-name]').textContent=lang?(config.schoolNameEn||'School calendar'):(config.schoolName||'学校校历');
 $('#sso-note').textContent=school.preview?T('本地体验模式：已跳过 Microsoft SSO。','Local preview: Microsoft SSO is bypassed.'):school.configured?'':T('学校 Microsoft 登录尚未配置；公开考试安排仍可查看。','School Microsoft sign-in is not configured yet. Public schedules remain available.');
 $('#selection-note').textContent=school.user?T('勾选逐场自动保存到账号；不代表学校确认的报考记录。','Selections save to your account. They are your personal choices, not official registrations.'):T('登录后可保存选择，并查看完整教室座位表。','Sign in to save selections and view room seating plans.');
 $('#all-mode').textContent=T('全部考试','All exams');$('#mine-mode').textContent=T('我的考试','My exams');$('#all-mode').setAttribute('aria-pressed',String(!mine));$('#mine-mode').setAttribute('aria-pressed',String(mine));$('#division-filters').hidden=mine;
 $('#download').textContent=T('下载 PDF','Download PDF');$('#download').disabled=!batch;$('#pdf-mine').disabled=!school.user;
 $('#batch').innerHTML=batches.map(b=>`<option value="${esc(b.id)}" ${b.id===batch?.id?'selected':''}>${esc(title(b))}</option>`).join('');
 $('#batch-dates').textContent=batch?`${batch.start} — ${batch.end}`:'';
 $('#divisions').innerHTML=Object.entries(divisions).map(([key,value])=>`<button data-division="${key}" aria-pressed="${division===key}">${value[lang]}</button>`).join('');
 const grades=[...new Set((batch?.sessions||[]).filter(s=>s.division===division).flatMap(s=>s.grades))].sort();
 $('#grade').innerHTML=`<option value="">${T('全部年级','All grades')}</option>`+grades.map(g=>`<option ${g===grade?'selected':''}>${esc(g)}</option>`).join('');
 document.querySelectorAll('[data-division]').forEach(el=>el.addEventListener('click',()=>{division=el.getAttribute('data-division');grade='';render();}));
 $('#current').textContent=T('本批次首周','First week');$('#previous').setAttribute('aria-label',T('上一周','Previous week'));$('#next').setAttribute('aria-label',T('下一周','Next week'));
 $('#select-visible').textContent=T('勾选本周','Select week');$('#clear-visible').textContent=T('取消本周勾选','Clear week');
 $('#select-visible').disabled=saving||!school.user||!batch;$('#clear-visible').disabled=saving||!school.user||!batch;
 if(!batch){$('#schedule').innerHTML=`<p class="no-exams">${T('暂无已发布考试批次','No published exam series')}</p>`;$('#range').textContent='';return;}
 const days=Array.from({length:7},(_,i)=>addDays(week,i)),visible=sorted(scopeSessions()),thisWeek=visible.filter(s=>days.includes(s.date));
 const shownDays=days.filter((day,index)=>index<5||thisWeek.some(exam=>exam.date===day));
 $('#range').textContent=`${week} — ${days[6]}`;$('#previous').disabled=week<=monday(batch.start);$('#next').disabled=days[6]>=batch.end;
 $('#count').textContent=T(`本周 ${thisWeek.length} 场 · 本批次已选 ${chosen.size} 场`,`This week: ${thisWeek.length} · Selected in series: ${chosen.size}`);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:config.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const card=s=>`<article class="exam-card${chosen.has(s.id)?' chosen':''}${s.cancelled?' cancelled':''}"><label><input type="checkbox" data-choice="${esc(s.id)}" ${chosen.has(s.id)?'checked':''} ${!school.user||saving?'disabled':''} aria-label="${esc(T('选择 ','Select ')+title(s))}"><button data-exam="${esc(s.id)}"><time>${s.start}–${s.end}</time><h3>${esc(title(s))}</h3><p>${esc(divisions[s.division][lang])} · ${esc(s.grades.join(' / '))}</p><p>${esc(s.rooms.join(' / '))}</p>${s.cancelled?`<span class="status">${T('已取消','Cancelled')}</span>`:s.changed?`<span class="status">${T('已变更','Updated')}</span>`:''}</button></label></article>`;
 const rows=examSlotRows(batch.timeSlots,thisWeek);
 $('#schedule').innerHTML=`<table class="exam-time-grid"><thead><tr><th class="time-axis">${T('时间段','Time slot')}</th>${shownDays.map(day=>`<th class="exam-day-header${day===today?' today':''}"><small>${new Intl.DateTimeFormat(lang?'en-GB':'zh-CN',{weekday:'short'}).format(date(day))}</small><strong>${date(day).getDate()}</strong></th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><th scope="row" class="time-axis"><time>${row.start}</time><span>–</span><time>${row.end}</time></th>${shownDays.map(day=>`<td class="${[0,6].includes(date(day).getDay())?'weekend':''}">${row.sessions.filter(s=>s.date===day).map(card).join('')||`<span class="empty-slot" aria-label="${T('暂无考试','No exams')}">—</span>`}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 $('#published').textContent=`${T('发布于','Published')} ${new Intl.DateTimeFormat(lang?'en-GB':'zh-CN',{timeZone:config.timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(batch.publishedAt))} · ${config.timeZone}`;
 const own=sorted(batch.sessions.filter(s=>chosen.has(s.id)&&!s.cancelled)),clashes=[];
 for(let i=0;i<own.length;i++)for(let j=i+1;j<own.length;j++)if(own[i].date===own[j].date&&own[i].start<own[j].end&&own[j].start<own[i].end)clashes.push(`${title(own[i])} / ${title(own[j])}`);
 $('#conflicts').hidden=!clashes.length;$('#conflicts').textContent=T('已选考试时间冲突：','Your selected exams overlap: ')+clashes.join('；');
 document.querySelectorAll('[data-choice]').forEach(el=>el.addEventListener('change',()=>{const next=new Set(chosen),id=el.getAttribute('data-choice');next.has(id)?next.delete(id):next.add(id);saveChoices(next);}));
 document.querySelectorAll('[data-exam]').forEach(el=>el.addEventListener('click',()=>showDetail(el.getAttribute('data-exam'))));
}
async function loadBatch(id){
 const generation=++loadNumber;$('#download').disabled=true;
 try{const [data,ids]=await Promise.all([api('/exams/'+id),school.user?api('/exams/'+id+'/choices'):[]]);if(generation!==loadNumber)return;batch=data;chosen=new Set(ids);week=monday(batch.start);grade='';render();history.replaceState(null,'','?batch='+encodeURIComponent(id));}
 catch(e){if(generation===loadNumber){batch=null;render();notice(e.message);}}
}
async function saveChoices(next){
 if(saving||!school.user)return;saving=true;render();const id=batch.id;
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
$('#select-visible').onclick=()=>saveChoices(new Set([...chosen,...scopeSessions().filter(s=>s.date>=week&&s.date<=addDays(week,6)).map(s=>s.id)]));
$('#clear-visible').onclick=()=>{const visible=new Set(scopeSessions().filter(s=>s.date>=week&&s.date<=addDays(week,6)).map(s=>s.id));saveChoices(new Set([...chosen].filter(id=>!visible.has(id))));};
$('#language').onclick=()=>{lang=1-lang;localStorage.setItem('exam-language',String(lang));render();};
$('#download').onclick=()=>{$(`input[name="pdf-scope"][value="${mine?'mine':'all'}"]`).checked=true;$('#pdf-dialog').showModal();};
$('#confirm-download').onclick=async()=>{
 const own=$('input[name="pdf-scope"]:checked').value==='mine',params=new URLSearchParams(own?{mine:'1',lang:lang?'en':'zh'}:{division,grade,lang:lang?'en':'zh'});$('#confirm-download').disabled=true;
 try{const response=await fetch(`/api/exams/${batch.id}/pdf?${params}`);if(!response.ok)throw new Error((await response.json()).error);const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='exam-schedule.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('#pdf-dialog').close();}catch(e){notice(e.message);}finally{$('#confirm-download').disabled=false;}
};
async function start(){try{[school,batches,config]=await Promise.all([api('/school/session'),api('/exams'),api('/config')]);const params=new URLSearchParams(location.search),requested=batches.find(b=>b.id===params.get('batch'));const today=new Intl.DateTimeFormat('en-CA',{timeZone:config.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(Object.hasOwn(divisions,params.get('division')))division=params.get('division');const matching=batches.find(b=>b.start<=params.get('date')&&b.end>=params.get('date'));const nearest=[...batches].filter(b=>b.end>=today).sort((a,b)=>a.start.localeCompare(b.start))[0];render();if(batches.length)await loadBatch((requested||matching||nearest||batches[0]).id);if(params.has('auth'))notice(params.get('auth')==='unconfigured'?T('学校 Microsoft SSO 尚未配置，请联系管理员。','Microsoft SSO is not configured.'):T('登录未完成，请重试。','Sign-in failed. Please retry.'));}catch(e){notice(e.message);}}
start();
