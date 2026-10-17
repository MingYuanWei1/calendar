import {examUpdates} from './exam-updates.js';
import {examDatePages} from './exam-dates.mjs';
import {seatViewTimes} from './exam-seats.mjs';
import {examPdfName} from './exam-file-name.mjs';
import {subjectColors,subjectName} from './exam-subjects.mjs';
import {examSlotRows,groupExamLevels,slotOf,defaultExamSlots} from './exam-times.mjs';
import {gradeLabel} from './grades.mjs';
import {$,esc,api,date,monday,divisions,sorted,seatingMarkup} from './exam-common.js';
let detailExamId=null;
let lang=Number(localStorage.getItem('exam-language')||0),batch=null,batches=[],week='',division='high',grade=/** @type {number|''} */(''),mine=false,chosen=new Set(),seats={},school={configured:false,user:null},config={timeZone:'Asia/Shanghai'},saving=false,loadNumber=0,detailLoadNumber=0;
const T=(zh,en)=>lang?en:zh;
const mobileQuery=matchMedia('(max-width:760px)');
/** Phones show one day of the series at a time; `autoDay` asks for the first day with visible exams again. */
let day='',autoDay=true,sheet=/** @type {null|'batch'|'filter'|'menu'} */(null);
const title=s=>{const name=lang?(s.titleEn||s.title):s.title.replaceAll('商务管理','商管');return name+[s.level].filter(value=>value&&!name.includes(value)).map(value=>' · '+value).join('');};
const notice=(message,error=true)=>{$('#notice').textContent=message;$('#notice').classList.toggle('success',!error);};
/** My exams show only the student's own room once the seating places them. */
const roomsOf=s=>mine&&seats[s.id]?[seats[s.id].room]:s.rooms;
const scopeSessions=()=>batch?batch.sessions.filter(s=>mine?chosen.has(s.id):s.division===division&&(!grade||s.grades.includes(grade))):[];
function render(){
 document.documentElement.lang=lang?'en':'zh-CN';document.title=lang?'Keydion Calendar - Exams':'Keydion日历 - 考试安排';document.querySelectorAll('[data-zh]').forEach(el=>el.textContent=el.getAttribute(lang?'data-en':'data-zh'));
 $('#language').textContent=lang?'中文':'EN';$('#language').setAttribute('aria-label',lang?'切换为中文':'Switch to English');
 $('#all-mode').textContent=T('全部考试','All exams');$('#mine-mode').textContent=T('我的考试','My exams');$('#all-mode').setAttribute('aria-pressed',String(!mine));$('#mine-mode').setAttribute('aria-pressed',String(mine));$('#division-filters').hidden=mine;
 $('#download').textContent=T('下载 PDF','Download PDF');$('#download').disabled=!batch;
 $('#batch').innerHTML=batches.map(b=>`<option value="${esc(b.id)}" ${b.id===batch?.id?'selected':''}>${esc(title(b))}</option>`).join('');
 $('#batch-dates').textContent=batch?`${batch.start} — ${batch.end}`:'';
 $('#divisions').innerHTML=Object.entries(divisions).map(([key,value])=>`<button data-division="${key}" aria-pressed="${division===key}">${value[lang]}</button>`).join('');
 const grades=[...new Set((batch?.sessions||[]).filter(s=>s.division===division).flatMap(s=>s.grades))].sort((a,b)=>a-b);
 $('#grade').innerHTML=`<option value="">${T('全部年级','All grades')}</option>`+grades.map(g=>`<option value="${g}" ${g===grade?'selected':''}>${esc(gradeLabel(g,lang))}</option>`).join('');
 document.querySelectorAll('[data-division]').forEach(el=>el.addEventListener('click',()=>{division=el.getAttribute('data-division');grade='';render();}));
 $('#current').textContent=T('本批次首周','First week');$('#previous').setAttribute('aria-label',T('上一周','Previous week'));$('#next').setAttribute('aria-label',T('下一周','Next week'));
 if(!batch){for(const id of ['previous','current','next'])$('#'+id).hidden=true;$('#schedule').innerHTML=`<p class="no-exams">${T('暂无已发布考试批次','No published exam series')}</p>`;renderMobile();return;}
 const visible=sorted(scopeSessions()),pages=examDatePages(visible);
 let page=pages.findIndex(days=>days.includes(week));if(page<0)page=0;
 const shownDays=pages[page]||[];week=shownDays[0]||'';
 for(const id of ['previous','current','next'])$('#'+id).hidden=pages.length<=1;
 $('#previous').disabled=page===0;$('#next').disabled=page>=pages.length-1;
 $('#schedule').innerHTML=shownDays.length?scheduleMarkup(visible,shownDays,!mine):`<p class="no-exams">${T('当前范围暂无考试','No exams in this selection')}</p>`;
 $('#published').textContent=published();
 const clashes=clashPairs().map(([a,b])=>`${title(a)} / ${title(b)}`);
 $('#conflicts').hidden=!clashes.length;$('#conflicts').textContent=T('已选考试时间冲突：','Your selected exams overlap: ')+clashes.join('；');
 document.querySelectorAll('[data-choice]').forEach(el=>el.addEventListener('change',()=>{const next=new Set(chosen),id=el.getAttribute('data-choice');next.has(id)?next.delete(id):next.add(id);saveChoices(next);}));
 document.querySelectorAll('[data-exam]').forEach(el=>el.addEventListener('click',()=>showDetail(el.getAttribute('data-exam'))));
 renderMobile();
}
/** Chosen sessions that overlap on the same day. */
function clashPairs(){
 const own=sorted(batch.sessions.filter(s=>chosen.has(s.id)&&!s.cancelled)),pairs=[];
 for(let i=0;i<own.length;i++)for(let j=i+1;j<own.length;j++)if(own[i].date===own[j].date&&own[i].start<own[j].end&&own[j].start<own[i].end)pairs.push([own[i],own[j]]);
 return pairs;
}
const corners='<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
const svg=(paths,size=18,extra='')=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${paths}</svg>`;
const icons={
 down:svg('<path d="m6 9 6 6 6-6"/>'),left:svg('<path d="m15 18-6-6 6-6"/>'),right:svg('<path d="m9 18 6-6-6-6"/>'),next:svg('<path d="m9 18 6-6-6-6"/>',16),
 filter:svg('<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>',16),check:svg('<path d="M20 6 9 17l-5-5"/>',14,' stroke-width="2"'),
 alert:svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
 subscribe:svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4"/>'),
 download:svg('<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>')
};
const subjectOf=s=>lang?(s.subjectEn||s.subject):s.subject.replaceAll('商务管理','商管');
/** A group's heading: the session's subject, or the catalogue subject its title names. */
const subjectLabel=s=>{
 if(s.subject)return subjectOf(s);
 const name=subjectName(s,batch.subjects||[]),known=(batch.subjects||[]).find(x=>x.name===name);
 return known?(lang?known.english||name:name):title(s);
};
const dayName=(iso,format)=>new Intl.DateTimeFormat(lang?'en-GB':'zh-CN',format).format(date(iso));
const monthDay=iso=>lang?dayName(iso,{day:'numeric',month:'short'}):`${date(iso).getMonth()+1}月${date(iso).getDate()}日`;
const published=()=>`${T('发布于','Published')} ${new Intl.DateTimeFormat(lang?'en-GB':'zh-CN',{timeZone:config.timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(batch.publishedAt))}`;
// Phones: the series title opens a batch sheet, a day strip picks one day, and that day's sessions list by time slot.
function renderMobile(){
 const root=$('#mobile-exams');
 if(!mobileQuery.matches){root.innerHTML='';return;}
 const list=root.querySelector('.mx-list'),scroll=list?.scrollTop||0;
 const focused=document.activeElement?.closest?.('#mobile-exams [data-key]')?.getAttribute('data-key');
 if(!batch){root.innerHTML=`<div class="mx-list"><div class="mx-empty"><h4>${T('暂无已发布考试批次','No published exam series')}</h4></div></div>`;renderSheet();return;}
 const visible=sorted(scopeSessions()),has=d=>visible.some(s=>s.date===d);
 // The strip pages through the whole series, so it holds still while filters change.
 const pages=examDatePages(batch.sessions);
 let page=pages.findIndex(days=>days.includes(day));
 if(autoDay||page<0){const days=pages[Math.max(0,page)]||[];day=days.find(has)||visible[0]?.date||days[0]||'';page=Math.max(0,pages.findIndex(days=>days.includes(day)));autoDay=false;}
 const shownDays=pages[page]||[],colorStyle=subjectColors(batch.sessions,batch.subjects||[]);
 const chosenCount=batch.sessions.filter(s=>chosen.has(s.id)).length;
 const strip=shownDays.map(d=>{
  const on=visible.filter(s=>s.date===d),swatches=[...new Map(on.map(s=>[s.subject||s.title,s])).values()].slice(0,4);
  return `<button type="button" class="mx-day${on.length?'':' quiet'}" data-key="day-${d}" data-day="${d}" aria-pressed="${d===day}" aria-label="${esc(dayName(d,{weekday:'long',month:'long',day:'numeric'}))} · ${esc(T(`${on.length} 场考试`,`${on.length} exams`))}"><span class="mx-weekday">${esc(dayName(d,{weekday:'short'}))}</span><span class="mx-date num${d===day?' ticked':''}">${date(d).getDate()}</span><span class="mx-swatches">${swatches.map(s=>`<i style="${colorStyle(s)}"></i>`).join('')}</span></button>`;
 }).join('');
 const paging=pages.length>1;
 const pageButton=(offset,icon,name)=>`<button type="button" class="btn btn-icon mx-page" data-key="page${offset}" data-page="${offset}" aria-label="${esc(name)}" ${page+offset<0||page+offset>=pages.length?'disabled':''}>${icon}</button>`;
 const clashes=school.user?clashPairs():[];
 const daySessions=visible.filter(s=>s.date===day),rows=examSlotRows(batch.timeSlots,daySessions).filter(row=>row.sessions.length);
 const canPick=Boolean(school.user)&&!mine;
 const item=(s,early,levelled)=>{
  const on=chosen.has(s.id),status=s.cancelled?T('已取消','Cancelled'):s.changed?T('已变更','Updated'):'';
  return `<div class="mx-row${!mine&&on?' chosen':''}${s.cancelled?' cancelled':''}">${canPick?`<button type="button" class="mx-check" role="checkbox" aria-checked="${on}" data-key="choice-${esc(s.id)}" data-choice-toggle="${esc(s.id)}" aria-label="${esc(T('选择 ','Select ')+title(s))}" ${saving?'disabled':''}><span class="mx-box">${on?icons.check:''}</span></button>`:''}<button type="button" class="mx-open" data-key="exam-${esc(s.id)}" data-open-exam="${esc(s.id)}"><span class="mx-main"><span class="mx-label"><strong>${esc(levelled?s.level:title(s))}</strong>${status?`<span class="tag tag-accent">${status}</span>`:''}</span><small><span class="num${early.has(s.id)?' early':''}">${s.start}–${s.end}${early.has(s.id)?' '+T('提前开考','starts early'):''}</span> · ${esc(roomsOf(s).join(' / '))}</small></span>${icons.next}</button></div>`;
 };
 const group=(items,early)=>{
  const first=items[0],levelled=Boolean(first.subject&&first.level);
  return `<article class="mx-group" style="${colorStyle(first)}"><header><i class="mx-swatch"></i><span class="mx-subject">${esc(subjectLabel(first))}</span><span class="mx-grades">${esc(first.grades.map(g=>gradeLabel(g,lang)).join(' / '))}</span></header>${items.map(s=>item(s,early,levelled)).join('')}</article>`;
 };
 const empty=(heading,help='')=>`<div class="mx-empty"><h4>${esc(heading)}</h4>${help?`<p>${esc(help)}</p>`:''}</div>`;
 const body=!visible.length?(mine&&!chosenCount?empty(T('还没有选择考试','No exams chosen yet'),T('在「全部考试」中勾选场次，即可加入我的考试。','Tick sessions under “All exams” to add them to My exams.')):empty(T('当前范围暂无考试','No exams in this selection')))
  :!rows.length?empty(T('当天暂无考试','No exams on this day'),T('选择上方其他日期查看。','Pick another day above.'))
  :rows.map(row=>`<section class="mx-slot"><h5 class="mx-slot-head"><span class="num">${row.start}–${row.end}</span></h5>${groupExamLevels(row.sessions).map(items=>group(items,row.early)).join('')}</section>`).join('');
 root.innerHTML=`<div class="mx-head">
  <button type="button" class="mx-batch" data-key="batch" data-sheet="batch" aria-haspopup="dialog"><h1>${esc(title(batch))}</h1>${icons.down}</button>
  <p class="mx-range num">${esc(batch.start)} — ${esc(batch.end)}</p>
  <div class="mx-controls"><div class="seg" role="group" aria-label="${esc(T('查看范围','Show'))}"><button type="button" class="seg-opt" data-key="all" data-mode="all" aria-pressed="${!mine}">${T('全部考试','All exams')}</button><button type="button" class="seg-opt" data-key="mine" data-mode="mine" aria-pressed="${mine}">${T('我的考试','My exams')}${school.user?' · '+chosenCount:''}</button></div><button type="button" class="btn mx-filter" data-key="filter" data-sheet="filter" aria-haspopup="dialog" ${mine?'disabled':''}>${icons.filter}<span>${esc(divisions[division][lang])} · ${esc(grade?gradeLabel(grade,lang):T('全部年级','All grades'))}</span></button></div>
  <div class="mx-strip${paging?' paged':''}" style="--days:${shownDays.length}">${paging?pageButton(-1,icons.left,T('上一页','Previous days')):''}${strip}${paging?pageButton(1,icons.right,T('下一页','Next days')):''}</div>
 </div><div class="mx-list">${clashes.length?`<div class="mx-clash blueprint" role="status">${corners}${icons.alert}<span><strong>${T('已选考试时间冲突','Your chosen exams overlap')}</strong><span>${esc(clashes.map(([a,b])=>`${monthDay(a.date)} · ${title(a)} / ${title(b)}`).join(T('；','; ')))}</span></span></div>`:''}${body}<p class="mx-published">${esc(published())}</p></div>`;
 root.querySelector('.mx-list').scrollTop=scroll;
 const on=(selector,action)=>root.querySelectorAll(selector).forEach(el=>el.addEventListener('click',()=>action(el)));
 on('[data-day]',el=>{day=el.getAttribute('data-day');render();root.querySelector('.mx-list').scrollTop=0;});
 on('[data-page]',el=>{const days=pages[page+Number(el.getAttribute('data-page'))];if(!days)return;day=days.find(has)||days[0];render();});
 on('[data-mode]',el=>setMode(el.getAttribute('data-mode')==='mine'));
 on('[data-sheet]',el=>openSheet(/** @type {any} */(el.getAttribute('data-sheet'))));
 on('[data-choice-toggle]',el=>toggleChoice(el.getAttribute('data-choice-toggle')));
 on('[data-open-exam]',el=>showDetail(el.getAttribute('data-open-exam')));
 if(focused)/** @type {HTMLElement|null} */(root.querySelector(`[data-key="${focused}"]`))?.focus();
 refreshDetailPick();renderSheet();
}
function setMode(next){
 if(next&&!school.user){notice(T('请先使用学校 Microsoft 账号登录。','Please sign in with your school Microsoft account.'));return;}
 mine=next;autoDay=true;render();
}
function toggleChoice(id){const next=new Set(chosen);next.has(id)?next.delete(id):next.add(id);saveChoices(next);}
function openSheet(kind){sheet=kind;renderSheet();const dialog=$('#exam-sheet');if(!dialog.open)dialog.showModal();}
function renderSheet(){
 const dialog=$('#exam-sheet');if(!sheet)return;
 const focused=document.activeElement?.closest?.('#exam-sheet [data-key]')?.getAttribute('data-key');
 dialog.className='sheet'+(sheet==='menu'?' menu':sheet==='batch'?' list':'');
 if(sheet==='batch'){
  dialog.setAttribute('aria-label',T('考试批次','Exam series'));
  dialog.innerHTML=`<h3 class="sheet-title">${T('考试批次','Exam series')}</h3>${batches.map(b=>`<button type="button" class="menu-row" data-key="batch-${esc(b.id)}" data-batch="${esc(b.id)}" aria-current="${b.id===batch?.id}"><span class="menu-text"><span>${esc(title(b))}</span><small class="num">${esc(b.start)} — ${esc(b.end)}</small></span>${b.id===batch?.id?`<span class="menu-check">${icons.check}</span>`:''}</button>`).join('')}`;
 }else if(sheet==='filter'){
  dialog.setAttribute('aria-label',T('筛选','Filter'));
  const grades=[...new Set((batch?.sessions||[]).filter(s=>s.division===division).flatMap(s=>s.grades))].sort((a,b)=>a-b);
  dialog.innerHTML=`<h3>${T('筛选','Filter')}</h3>
   <div class="sheet-section"><h6 class="m-h6">${T('学部','Division')}</h6><div class="seg" role="group" style="align-self:flex-start">${Object.entries(divisions).map(([key,value])=>`<button type="button" class="seg-opt" data-key="division-${key}" data-division-pick="${key}" aria-pressed="${division===key}">${value[lang]}</button>`).join('')}</div></div>
   <div class="sheet-section"><h6 class="m-h6">${T('年级','Grade')}</h6><div class="sheet-chips">${[['',T('全部年级','All grades')],...grades.map(g=>[g,gradeLabel(g,lang)])].map(([g,name])=>`<button type="button" class="chip" data-key="grade-${g}" data-grade-pick="${g}" aria-pressed="${g===grade}">${esc(name)}</button>`).join('')}</div></div>
   <button type="button" class="btn btn-primary blueprint" data-key="done" data-sheet-done>${corners}${esc(T(`显示 ${scopeSessions().length} 场考试`,`Show ${scopeSessions().length} exams`))}</button>`;
 }else{
  dialog.setAttribute('aria-label',T('更多','More'));
  dialog.innerHTML=`<button type="button" class="menu-row" data-key="feed-exams" data-feed-open="exams">${icons.subscribe}<span class="menu-text"><span>${T('订阅所有考试','Subscribe to all exams')}</span><small>${T('全部已发布的考试场次','Every published exam session')}</small></span></button>
   <button type="button" class="menu-row" data-key="feed-mine" data-feed-open="mine">${icons.subscribe}<span class="menu-text"><span>${T('订阅我的考试','Subscribe to my exams')}</span><small>${T('只含我关注的考试，附本人考场与座位','Only the exams I follow, with my room and seat')}</small></span></button>
   <button type="button" class="menu-row" data-key="pdf" data-pdf ${batch?'':'disabled'}>${icons.download}<span class="menu-text">${T('下载 PDF','Download PDF')}</span></button>
   <button type="button" class="menu-row" data-key="language" data-language><span class="lang-mark">${lang?'中':'EN'}</span><span class="menu-text">${lang?'切换为中文':'Switch to English'}</span></button>`;
 }
 const on=(selector,action)=>dialog.querySelectorAll(selector).forEach(el=>el.addEventListener('click',()=>action(el)));
 on('[data-batch]',el=>{dialog.close();const id=el.getAttribute('data-batch');if(id!==batch?.id){autoDay=true;loadBatch(id);}});
 on('[data-division-pick]',el=>{division=el.getAttribute('data-division-pick');grade='';autoDay=true;render();});
 on('[data-grade-pick]',el=>{grade=Number(el.getAttribute('data-grade-pick'))||'';autoDay=true;render();});
 on('[data-sheet-done]',()=>dialog.close());
 on('[data-feed-open]',el=>{dialog.close();/** @type {any} */(window).siteHeader?.openFeed(el.getAttribute('data-feed-open'));});
 on('[data-pdf]',()=>{dialog.close();$('#download').click();});
 on('[data-language]',()=>{dialog.close();$('#language').click();});
 if(focused)/** @type {HTMLElement|null} */(dialog.querySelector(`[data-key="${focused}"]`))?.focus();
}
/** The 加入我的考试 toggle on the phone's exam page follows saves made anywhere. */
function refreshDetailPick(){
 const button=$('#detail-pick');if(!button||!detailExamId)return;
 const on=chosen.has(detailExamId);
 button.className=`btn ${on?'btn-secondary':'btn-primary'} blueprint`;button.disabled=saving;
 button.innerHTML=corners+(on?T('已在我的考试 · 点按移除','In My exams · tap to remove'):T('加入我的考试','Add to My exams'));
}
function scheduleMarkup(visible,shownDays,highlightSelected=true){
 const thisWeek=sorted(visible).filter(s=>shownDays.includes(s.date));
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:config.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 // Use the full batch so filtering, language and selection never reshuffle colors.
 const colorStyle=subjectColors(batch.sessions,batch.subjects||[]);
 const card=(s,early)=>`<article style="${colorStyle(s)}" class="exam-card${highlightSelected&&chosen.has(s.id)?' chosen':''}${s.cancelled?' cancelled':''}"><label>${mine?'':`<input type="checkbox" data-choice="${esc(s.id)}" ${chosen.has(s.id)?'checked':''} ${!school.user||saving?'disabled':''} aria-label="${esc(T('选择 ','Select ')+title(s))}">`}<button data-exam="${esc(s.id)}">${slotTime(s,early)}<h3>${esc(title(s))}</h3><p>${esc(roomsOf(s).join(' / '))} · ${esc(s.grades.map(g=>gradeLabel(g,lang)).join(' / '))}</p>${s.cancelled?`<span class="status">${T('已取消','Cancelled')}</span>`:s.changed?`<span class="status">${T('已变更','Updated')}</span>`:''}</button></label></article>`;
 // A session that starts before its slot still sits in it, with its time flagged.
 const slotTime=(s,early)=>early.has(s.id)?`<time class="early" title="${T('提前开考','Starts early')}">${s.start}–${s.end}<span class="visually-hidden"> ${T('提前开考','starts early')}</span></time>`:`<time>${s.start}–${s.end}</time>`;
 const levelGroup=(items,early)=>{
  if(!items[0].subject||!items[0].level)return items.map(s=>card(s,early)).join('');
  const first=items[0];
  return `<article class="exam-group" style="${colorStyle(first)}"><header><div><h3>${esc(lang?(first.subjectEn||first.subject):first.subject.replaceAll('商务管理','商管'))}</h3><p class="exam-group-grade">${esc(first.grades.map(g=>gradeLabel(g,lang)).join(' / '))}</p></div></header><div class="exam-levels">${items.map(s=>`<div class="exam-level${highlightSelected&&chosen.has(s.id)?' chosen':''}${s.cancelled?' cancelled':''}">${mine?'':`<input type="checkbox" data-choice="${esc(s.id)}" ${chosen.has(s.id)?'checked':''} ${!school.user||saving?'disabled':''} aria-label="${esc(T('选择 ','Select ')+title(s))}">`}<button data-exam="${esc(s.id)}" aria-label="${esc(title(s))}"><strong>${esc(s.level).replace(/ (?=\d+$)/,'&nbsp;')}</strong>${slotTime(s,early)}<p>${esc(roomsOf(s).join(' / '))}</p>${s.cancelled?`<span class="status">${T('已取消','Cancelled')}</span>`:s.changed?`<span class="status">${T('已变更','Updated')}</span>`:''}</button></div>`).join('')}</div></article>`;
 };
 const rows=examSlotRows(batch.timeSlots,thisWeek);
 return `<table class="exam-time-grid" style="--day-count:${shownDays.length}"><thead><tr><th class="time-axis">${T('时间段','Time slot')}</th>${shownDays.map(day=>`<th class="exam-day-header${day===today?' today':''}"><small>${new Intl.DateTimeFormat(lang?'en-GB':'zh-CN',{weekday:'short'}).format(date(day))}</small><strong>${date(day).getDate()}</strong></th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><th scope="row" class="time-axis"><time>${row.start}</time><span>–</span><time>${row.end}</time></th>${shownDays.map(day=>`<td class="${[0,6].includes(date(day).getDay())?'weekend':''}">${groupExamLevels(row.sessions.filter(s=>s.date===day)).map(items=>levelGroup(items,row.early)).join('')||`<span class="empty-slot" aria-label="${T('暂无考试','No exams')}">—</span>`}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
const updates=examUpdates({getBatch:()=>batch,getUser:()=>school.user,isSaving:()=>saving,language:()=>lang,notice,apply:(data,ids,personal={})=>{const changed=batch?.seatingPublishedAt!==data.seatingPublishedAt||batch?.publishedAt!==data.publishedAt;batch=data;chosen=new Set(ids);seats=personal;render();if(changed&&$('#detail').open&&detailExamId)showDetail(detailExamId);}});
async function loadBatch(id){
 updates.reset();const generation=++loadNumber;detailLoadNumber++;$('#detail').close();autoDay=true;$('#download').disabled=true;
 try{const [data,sync]=await Promise.all([api('/exams/'+id),school.user?api('/exams/'+id+'/personal-sync',{method:'POST',body:'{}'}):{choices:[],personal:{}}]);if(generation!==loadNumber)return;batch=data;chosen=new Set(sync.choices);seats=sync.personal||{};week=monday(batch.start);grade='';render();history.replaceState(null,'','?batch='+encodeURIComponent(id));await updates.check();}
 catch(e){if(generation===loadNumber){batch=null;render();notice(e.message);}}
}
async function saveChoices(next){
 if(saving||!school.user)return;updates.reset();saving=true;render();const id=batch.id;
 try{const ids=await api('/exams/'+id+'/choices',{method:'PUT',body:JSON.stringify({ids:[...next]})});if(batch?.id===id){chosen=new Set(ids);notice(T('选择已保存','Selections saved'),false);}}
 catch(e){notice(e.message);}finally{saving=false;render();await updates.check();}
}
// Shows an exam's week and opens its details; used by assistant citations and ?exam= links.
async function examFocus(batchId,examId){
 if(batch?.id!==batchId){if(!batches.some(b=>b.id===batchId))return;await loadBatch(batchId);}
 const exam=batch?.sessions.find(s=>s.id===examId);if(!exam)return;
 mine=false;division=exam.division||division;grade='';week=exam.date;day=exam.date;autoDay=false;render();await showDetail(examId);
}
/** @type {any} */(window).examFocus=examFocus;
async function showDetail(id){
 const generation=++detailLoadNumber;
 const exam=batch.sessions.find(s=>s.id===id);if(!exam){$('#detail').close();return;}detailExamId=id;
 // Phones open a full-screen page in the same dialog.
 const phone=mobileQuery.matches;
 $('#detail').classList.toggle('m-detail',phone);
 $('#detail-title').textContent=phone?T('考试详情','Exam details'):title(exam);
 if(phone){$('#detail-content').innerHTML=mobileDetail(exam);$('#detail-pick')?.addEventListener('click',()=>toggleChoice(exam.id));refreshDetailPick();}
 else $('#detail-content').innerHTML=`<dl class="detail-meta"><dt>${T('时间','Time')}</dt><dd>${exam.date} ${exam.start}–${exam.end}</dd><dt>${T('适用','For')}</dt><dd>${esc(divisions[exam.division][lang])} · ${esc(exam.grades.map(g=>gradeLabel(g,lang)).join(' / '))}</dd><dt>${T('地点','Rooms')}</dt><dd>${esc(exam.rooms.join(' / '))}</dd></dl>${exam.cancelled?`<p class="warning">${T('此考试已取消','This exam is cancelled')}</p>`:''}<p>${esc(exam.note)}</p><div id="seating-content"><p class="muted">${T('正在读取座位表…','Loading seating…')}</p></div>`;
 if(!$('#detail').open)$('#detail').showModal();
 const login=`/api/school/login?returnTo=${esc(encodeURIComponent(location.pathname+location.search+location.hash))}`;
 if(!school.user){$('#seating-content').innerHTML=`<p class="muted">${T('请使用学校账号登录后查看座位表。','Sign in with your school account to view seating.')}</p><a href="${login}"${phone?' class="btn btn-primary blueprint mx-login"':''}>${phone?corners:''}Microsoft ${T('登录','sign-in')}</a>`;return;}
  try{
  const seating=await api('/exams/'+batch.id+'/seats');if(!$('#detail').open||generation!==detailLoadNumber)return;
  let room=seating.personal?.[exam.id]?.room||exam.rooms[0],point=exam.start;
  const renderSeats=()=>{
   const times=seatViewTimes(batch,exam,room);if(!times.includes(point))point=exam.start;
   const timeSelect=`<select id="seat-time">${times.map(time=>`<option value="${esc(time)}" ${time===point?'selected':''}>${esc(time)}</option>`).join('')}</select>`;
   const own=seating.personal?.[exam.id],grid=seatingMarkup(batch,seating,exam,room,point,lang,false,own);
   $('#seating-content').innerHTML=phone
    ?`<div class="mx-seat-tools"><div class="seg" role="group" aria-label="${esc(T('考场','Room'))}">${exam.rooms.map(r=>`<button type="button" class="seg-opt" data-room="${esc(r)}" aria-pressed="${r===room}">${esc(r)}</button>`).join('')}</div>${times.length>1?`<label class="mx-time">${T('查看时刻','View at')} ${timeSelect}</label>`:`<span class="mx-time">${T('查看时刻','View at')} <span class="num">${esc(point)}</span></span>`}</div>${own?.room===room?`<p class="mx-my-seat">${T('你的座位：','Your seat: ')}<strong>${esc(own.room)} · ${lang?`row ${own.row}, column ${own.column}`:`第 ${own.row} 排 第 ${own.column} 列`}</strong></p>`:''}<div id="seat-grid" class="mx-seat-grid">${grid}</div><p class="mx-caption">${T('排从讲台向后，列从左向右。','Rows run back from the podium; columns run left to right.')}</p>`
    :`<div class="room-tabs">${exam.rooms.map(r=>`<button data-room="${esc(r)}" aria-pressed="${r===room}">${esc(r)}</button>`).join('')}</div><label class="time-select">${T('查看时刻','View at')}${timeSelect}</label><div id="seat-grid">${grid}</div>`;
   document.querySelectorAll('[data-room]').forEach(el=>el.addEventListener('click',()=>{room=el.getAttribute('data-room');point=exam.start;renderSeats();}));
   if($('#seat-time'))$('#seat-time').onchange=()=>{point=$('#seat-time').value;renderSeats();};
  };renderSeats();
 }catch(e){if(generation===detailLoadNumber&&$('#detail').open)$('#seating-content').textContent=e.message;}
}
/** The phone's exam page: subject, title, notice, time, audience, rooms, note, the 我的考试 toggle and seating. */
function mobileDetail(exam){
 const found=slotOf(batch.timeSlots||defaultExamSlots,exam),early=Boolean(found?.early);
 const slotStart=found?(batch.timeSlots||defaultExamSlots)[found.index].start:'';
 const grades=exam.grades.map(g=>gradeLabel(g,lang)).join(' / '),audience=`${divisions[exam.division][lang]} · ${grades}`;
 const when=lang?`${dayName(exam.date,{weekday:'short',day:'numeric',month:'short'})} ${exam.start}–${exam.end}`:`${monthDay(exam.date)} ${dayName(exam.date,{weekday:'short'})} ${exam.start}–${exam.end}`;
 const changeNote=exam.changed&&!exam.cancelled?exam.note:'';
 const notice=exam.cancelled?[T('此考试已取消','This exam is cancelled'),T('保留记录供查阅。','The record is kept for reference.')]:exam.changed?[T('已变更','Updated'),changeNote]:null;
 const row=(name,value,sub='',subClass='')=>`<div class="m-meta-row"><span class="label">${name}</span><span class="value">${value}${sub?`<small class="${subClass}">${sub}</small>`:''}</span></div>`;
 return `<div class="mx-detail-head"><span class="tag tag-neutral" style="${subjectColors(batch.sessions,batch.subjects||[])(exam)}"><i class="mx-swatch"></i>${esc(subjectLabel(exam))}</span><h2${exam.cancelled?' class="cancelled"':''}>${esc(title(exam))}</h2><p class="mx-sub">${esc(audience)}</p></div>
  ${notice?`<div class="mx-notice blueprint">${corners}<strong>${esc(notice[0])}</strong>${notice[1]?`<span>${esc(notice[1])}</span>`:''}</div>`:''}
  <div class="m-meta">${row(T('时间','Time'),esc(when),early?esc(T(`提前开考 · 归入 ${slotStart} 时间段`,`Starts early · in the ${slotStart} slot`)):esc(T('学校当地时间','School local time')),early?'early':'')}${row(T('适用','For'),esc(audience))}${row(T('地点','Rooms'),esc(exam.rooms.join(' / ')))}</div>
  ${exam.note&&exam.note!==changeNote?`<p class="mx-note-text">${esc(exam.note)}</p>`:''}
  ${school.user?'<button type="button" id="detail-pick" class="btn btn-primary blueprint"></button>':''}
  <section class="mx-seats"><h4>${T('座位表','Seating')}</h4><div id="seating-content"><p class="muted">${T('正在读取座位表…','Loading seating…')}</p></div></section>`;
}
$('#close-detail').onclick=()=>{detailLoadNumber++;$('#detail').close();};
$('#exam-sheet').addEventListener('close',()=>{sheet=null;});
// Tapping the backdrop (outside the sheet's box) closes it.
$('#exam-sheet').addEventListener('click',e=>{const box=e.currentTarget.getBoundingClientRect();if(e.clientY<box.top||e.clientY>box.bottom||e.clientX<box.left||e.clientX>box.right)e.currentTarget.close();});
window.addEventListener('site-menu',()=>openSheet('menu'));
mobileQuery.addEventListener('change',()=>{if($('#detail').open&&detailExamId)showDetail(detailExamId);render();});$('#batch').onchange=()=>loadBatch($('#batch').value);$('#grade').onchange=()=>{grade=Number($('#grade').value)||'';render();};
$('#all-mode').onclick=()=>{mine=false;autoDay=true;render();};$('#mine-mode').onclick=()=>{if(!school.user){notice(T('请先使用学校 Microsoft 账号登录。','Please sign in with your school Microsoft account.'));return;}mine=true;render();};
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
 $('#pdf-title').textContent=T('下载考试表','Download exam schedule');
 $('#pdf-description').textContent=T('导出为 A4 横向考试表，按周分页。','Export an A4 landscape timetable, one page per week.');
 $('#pdf-all-label').textContent=T('下载全部考试','All exams');$('#pdf-grade-label').textContent=T('下载所选年级考试','Selected grades');$('#pdf-mine-label').textContent=T('下载我的考试','My exams');$('#pdf-grade-summary').textContent=T('选择年级（可多选）','Choose grades (multiple)');$('#pdf-language-summary').textContent=T('PDF 语言','PDF language');$('#pdf-submit').textContent=T('下载 PDF','Download PDF');
 $('#pdf-mine').disabled=!school.user;
 $('#pdf-grade-options').innerHTML=Object.entries(divisions).map(([key,names])=>{const grades=[...new Set(batch.sessions.filter(s=>s.division===key).flatMap(s=>s.grades))].sort((a,b)=>a-b);return grades.length?`<fieldset><legend>${names[lang]}</legend>${grades.map(g=>`<label class="pdf-grade-option"><input type="checkbox" data-division="${key}" value="${g}" ${key===division&&g===grade?'checked':''}>${esc(gradeLabel(g,lang))}</label>`).join('')}</fieldset>`:'';}).join('');
 $(`input[name="pdf-scope"][value="${mine?'mine':grade?'grades':'all'}"]`).checked=true;
 $(`input[name="pdf-lang"][value="${lang?'en':'zh'}"]`).checked=true;
 updateDownloadScope();$('#pdf-dialog').showModal();
};
$('#pdf-dialog').addEventListener('change',event=>{if(event.target.name==='pdf-scope')updateDownloadScope();});
$('#pdf-close').onclick=()=>$('#pdf-dialog').close();
$('#pdf-submit').onclick=async()=>{
 const scope=$('input[name="pdf-scope"]:checked').value;
 const grades=[...document.querySelectorAll('#pdf-grade-options input:checked')].map(el=>Number(/** @type {HTMLInputElement} */(el).value));
 if(scope==='grades'&&!grades.length){$('#pdf-error').textContent=T('请至少选择一个年级。','Choose at least one grade.');return;}
 const language=$('input[name="pdf-lang"]:checked').value;
 if(scope==='mine'&&!school.user)return;
 const sessions=batch.sessions.filter(s=>!s.cancelled&&(scope==='all'||(scope==='mine'?chosen.has(s.id):s.grades.some(g=>grades.includes(g)))));
 if(!sessions.length){$('#pdf-error').textContent=T('此范围暂无考试。','No exams in this selection.');return;}
 $('#pdf-submit').disabled=true;$('#pdf-close').disabled=true;$('#pdf-submit').textContent=T('正在生成 PDF…','Generating PDF…');
 try{
  const query=new URLSearchParams({scope,lang:language,...(scope==='grades'?{grades:grades.join(',')}:{})});
  const response=await fetch(`/api/exams/${encodeURIComponent(batch.id)}/pdf?${query}`);
  if(!response.ok)throw new Error('PDF export failed');
  const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=examPdfName(batch,{scope,grades,email:school.user?.email,english:language==='en'});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  $('#pdf-dialog').close();
 }
 catch(error){$('#pdf-error').textContent=T('PDF 导出失败，请重试。','PDF export failed. Please retry.');}
 finally{$('#pdf-submit').textContent=T('下载 PDF','Download PDF');$('#pdf-submit').disabled=false;$('#pdf-close').disabled=false;}
};
async function start(){try{[school,batches,config]=await Promise.all([api('/school/session'),api('/exams'),api('/config')]);const params=new URLSearchParams(location.search),requested=batches.find(b=>b.id===params.get('batch'));const today=new Intl.DateTimeFormat('en-CA',{timeZone:config.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(Object.hasOwn(divisions,params.get('division')))division=params.get('division');const matching=batches.find(b=>b.start<=params.get('date')&&b.end>=params.get('date'));const nearest=[...batches].filter(b=>b.end>=today).sort((a,b)=>a.start.localeCompare(b.start))[0];render();if(batches.length)await loadBatch((requested||matching||nearest||batches[0]).id);if(matching&&batch?.id===matching.id&&!requested){day=params.get('date');autoDay=!batch.sessions.some(s=>s.date===day&&scopeSessions().includes(s));render();}if(params.get('exam')&&batch)await examFocus(batch.id,params.get('exam'));if(params.has('auth'))notice(params.get('auth')==='unconfigured'?T('学校 Microsoft SSO 尚未配置，请联系管理员。','Microsoft SSO is not configured.'):T('登录未完成，请重试。','Sign-in failed. Please retry.'));}catch(e){notice(e.message);}}
start();
// 访问统计: report this page load; counting never holds up or breaks the page.
fetch('/api/views',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:'exams'}),keepalive:true}).catch(()=>{});

window.addEventListener('account-changed',()=>location.reload());
