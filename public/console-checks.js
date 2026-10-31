// 核验: compare a complete reference (a roster, the official timetable or seating plan, the school calendar) with
// what is stored, both ways, and apply the corrections an administrator ticks; or 自检 the stored data with no
// reference at all. Readings run as background jobs (see console-jobs.js); the comparison itself is made on the
// server each time a result is opened, so it always reflects the data as it is now.
import {$,$$,esc,app,T,tx,api,toast,refreshNav,loadBatches,loadEvents,loadPlans,loadJobs,fail} from './console-core.js';
import {materialFields,bindMaterials,materialsForm} from './material-input.js';
import {registerJobKind,jobsOf,startJob,openJob,jobStrips,watchJobs,jobAction,discardButton,bindDiscard} from './console-jobs.js';

const STATUS={mismatch:['不一致','Differs'],missing:['缺失','Missing'],extra:['多出','Extra'],ambiguous:['待确认','Unresolved'],noValue:['无法核验','Nothing to compare'],ok:['一致','Matches']};
const LOUD=['mismatch','missing','extra','ambiguous'];
const FIELDS={graduationYear:['届别','Cohort'],className:['班级','Class'],name:['姓名','Name'],englishName:['英文名','English name'],email:['邮箱','Email'],date:['日期','Date'],start:['开始','Start'],end:['结束','End'],grades:['年级','Grades'],cancelled:['取消状态','Cancellation'],exam:['考试','Exam'],room:['考场','Room'],position:['座位','Seat'],title:['名称','Title'],time:['开始时间','Start time'],endTime:['结束时间','End time'],location:['地点','Place'],kind:['安排','Setting']};
const KINDS_OF_DAY={off:['放假','Day off'],school:['调休上课','Make-up day'],half:['半天','Half day'],default:['无安排','None'],term:['学期','Term']};
const value=(field,v)=>v===''||v==null?T('无','none'):field==='graduationYear'?T(`${v} 届`,`Class of ${v}`):field==='cancelled'?(v?T('已取消','cancelled'):T('正常','active')):field==='kind'?String(v).split(' / ').map(k=>tx(KINDS_OF_DAY[k]||[k,k])).join(' / '):String(v);

/**
 * The reference checks. `scope` is 'batch' for the exam checks (one batch at a time); `fields` renders the settings
 * sent with the materials. Each kind's reading streams rows under `itemKey`.
 */
const CHECKS={
 students:{name:['学生信息','Students'],itemKey:'rows',admin:3,
  hint:['粘贴或上传学校的花名册、班级名单（截图、PDF 或 Excel 均可）。核对每位学生的姓名、英文名、班级、年级和邮箱；名单涉及的班级里却不在名单上的学生会列为“多出”，但只报告、不删除。','Paste or upload the school roster or class lists. Each student’s name, English name, class, grade and email is compared; students of the classes covered who are not on the list are listed as extra, but never deleted.'],
  row:r=>[[r.name,r.englishName].filter(Boolean).join(' · '),[r.className,r.grade?T(`${r.grade} 年级`,`Grade ${r.grade}`):'',r.email].filter(Boolean).join(' · ')]},
 sessions:{name:['考试场次','Exam sessions'],itemKey:'sessions',scope:'batch',
  hint:['上传所选考试批次的正式考试安排。只与这个批次的草稿对照：比对日期、时间和年级；草稿里多出的场次，从未发布的会删除，已发布的会标记取消。修正写入草稿，需照常发布。','Upload the official timetable of the chosen batch. Only that batch’s draft is compared: dates, times and grades. Extra sessions are deleted if never published, else cancelled. Corrections go into the draft and are published as usual.'],
  row:r=>[r.title||r.subject,[r.date,r.start&&`${r.start}–${r.end||''}`,(r.grades||[]).join(' / ')].filter(Boolean).join(' · ')]},
 seats:{name:['座位表','Seating'],itemKey:'seats',scope:'batch',mode:true,
  hint:['上传所选考试批次的完整座位表。按“学生 + 场次”与草稿座位对照：缺失的新增、多出的删除、考场或座位不同的修正。身份不明的学生需先在考试页处理。','Upload the complete seating plan of the chosen batch. Seats are compared by student and exam with the draft: missing ones are added, extra ones removed and moved ones corrected. Unidentified students are resolved on the exams page first.'],
  row:r=>[[r.name,r.englishName].filter(Boolean).join(' · '),[r.room,r.row?`${r.row}-${r.column}`:'',r.className].filter(Boolean).join(' · ')]},
 events:{name:['事件','Events'],itemKey:'rows',range:true,
  hint:['上传学校正式校历或活动表。只核对日期范围内的事件（不填则取材料中最早到最晚的日期），考试批次事件不参与。缺失的建为草稿，多出的已发布事件改为取消、草稿删除；重复事件只修正对应的那一次。','Upload the official calendar or activity list. Only events within the date range are compared (by default the material’s first to last date); exam batch events are left out. Missing events become drafts; extra ones are cancelled if published, else deleted; a repeating event changes only on that date.'],
  row:r=>[r.title?.zh||r.title?.en||'',[r.start,r.end&&r.end!==r.start?`– ${r.end}`:'',r.time].filter(Boolean).join(' ')]},
 days:{name:['放假与调休','School days'],itemKey:'rows',range:true,
  hint:['上传学校正式校历，核对日期范围内的放假日、调休上课日、半天和学期起止。勾选的修正立即生效。','Upload the official school calendar to check days off, make-up school days, half days and term dates within the range. Ticked corrections take effect at once.'],
  row:r=>[`${tx(KINDS_OF_DAY[r.kind]||[r.kind,r.kind])} · ${r.title?.zh||r.title?.en||''}`,[r.start,r.end&&r.end!==r.start?`– ${r.end}`:''].join(' ')]}
};
const AREAS={students:['学生','Students'],seats:['座位','Seats'],sessions:['场次','Sessions'],events:['事件','Events'],publish:['待发布','To publish']};
const view={tab:'self',batch:'',mode:'ordered',status:null};
const visible=key=>!CHECKS[key]?.admin||app.user.role>=CHECKS[key].admin;
const scopeOf=key=>CHECKS[key].scope==='batch'?view.batch:key;
const kindJobs=key=>scopeOf(key)?jobsOf(scopeOf(key),`check-${key}`):[];

export async function loadCheckIssues(){app.data.checkIssues=(await api('/admin/checks/self')).issues;return app.data.checkIssues;}

export async function showChecks(main,tab='',query=''){
 const params=new URLSearchParams(query);
 view.tab=tab&&(tab==='self'||(CHECKS[tab]&&visible(tab)))?tab:view.tab;
 if(params.get('batch'))view.batch=params.get('batch');
 if(!app.data.batches)main.innerHTML=`<p class="loading">${T('正在加载…','Loading…')}</p>`;
 await Promise.all([app.data.batches||loadBatches(),app.data.jobs||loadJobs(),view.status||api('/admin/checks').then(s=>view.status=s)]);
 if(!view.batch||!app.data.batches.some(b=>b.id===view.batch))view.batch=app.data.batches[0]?.id||'';
 const tabs=['self',...Object.keys(CHECKS).filter(visible)];
 main.innerHTML=`<div class="page">
 <header class="page-head"><div><div class="kicker">${T('管理后台','Admin console')}</div><h1>${T('核验','Checks')}</h1><p class="sub">${T('用学校的权威资料双向对照现有数据，或直接自检数据中的矛盾','Compare the stored data both ways with the school’s own records, or look for contradictions within it')}</p></div></header>
 <div class="tabs" role="tablist">${tabs.map(key=>`<button type="button" role="tab" data-tab="${key}" aria-selected="${view.tab===key}">${key==='self'?T('自检','Self-check'):tx(CHECKS[key].name)}${key==='self'&&app.data.checkIssues?`<span class="count">${app.data.checkIssues.length}</span>`:''}</button>`).join('')}</div>
 <div id="check-tab"></div></div>`;
 const page=main.querySelector('.page');
 page.onclick=event=>{
  const job=event.target.closest('[data-job-act]');if(job)return jobAction(job);
  const tabButton=event.target.closest('[data-tab]');
  if(tabButton){view.tab=tabButton.dataset.tab;app.replaceHash(`checks/${view.tab}`);showChecks(main,view.tab);}
 };
 if(view.tab==='self')await showSelf($('#check-tab'));else showReference($('#check-tab'),view.tab,main);
}

/* — 自检 — */
async function showSelf(el){
 el.innerHTML=`<p class="loading">${T('正在自检…','Checking…')}</p>`;
 const issues=await loadCheckIssues();refreshNav();
 const tab=$('[data-tab="self"]');
 if(tab){let count=tab.querySelector('.count');if(!count){count=document.createElement('span');count.className='count';tab.append(count);}count.textContent=String(issues.length);}
 const groups=Object.keys(AREAS).map(area=>[area,issues.filter(i=>i.area===area)]).filter(([,list])=>list.length);
 el.innerHTML=`<p class="muted" style="font-size:13px;margin:4px 0 16px">${T('不需要参考资料：系统扫描现有数据，列出彼此矛盾或需要处理的地方。每次打开都会重新检查。','No reference needed: the stored data is scanned for contradictions and loose ends, afresh each time this opens.')}</p>
 ${groups.length?groups.map(([area,list])=>`<section class="check-group"><h3>${esc(tx(AREAS[area]))}<span class="count">${list.length}</span></h3>
 ${list.map(issue=>`<div class="grid-row check-issue"><div class="clip"><div class="cell-main">${esc(issue.message)}</div>${issue.batch?`<div class="cell-sub clip">${esc(issue.batch)}</div>`:''}</div><a class="btn btn-ghost" href="${esc(issue.link)}">${T('去处理','Fix')}</a></div>`).join('')}</section>`).join('')
 :`<div class="empty"><strong>${T('没有发现问题','No problems found')}</strong><p>${T('现有数据之间没有发现矛盾。','The stored data shows no contradictions.')}</p></div>`}`;
}

/* — reference checks — */
function showReference(el,key,main){
 const spec=CHECKS[key],batches=app.data.batches;
 const batchField=spec.scope==='batch'?`<div class="field"><label for="check-batch">${T('考试批次（每次只对照一个批次）','Exam batch (one at a time)')}</label>${batches.length?`<select class="input" id="check-batch">${batches.map(b=>`<option value="${esc(b.id)}"${b.id===view.batch?' selected':''}>${esc(app.lang&&b.titleEn?b.titleEn:b.title)} · ${esc(b.start)}</option>`).join('')}</select>`:`<p class="muted">${T('还没有考试批次。','There are no exam batches yet.')}</p>`}</div>`:'';
 const modeField=spec.mode?`<div class="field"><span class="label">${T('座位表类型','Seating type')}</span><div class="seg full">${[['ordered',T('按座位排序','By seat')],['unordered',T('只有考场名单','Room lists only')]].map(([k,label])=>`<button type="button" data-mode="${k}" aria-pressed="${view.mode===k}">${label}</button>`).join('')}</div></div>`:'';
 const yearField=key==='students'?`<div class="field"><label for="check-year">${T('名单所属学年（开始年份，如 2026 即 2026–2027 学年）','School year of the list (starting year, e.g. 2026 for 2026–27)')}</label><input class="input" id="check-year" type="number" min="2000" max="2199" value="${esc(view.status?.academicYear||'')}"></div>`:'';
 const rangeField=spec.range?`<div class="field check-range"><span class="label">${T('日期范围（可不填，默认取材料中最早到最晚的日期）','Date range (optional; by default the material’s first to last date)')}</span><div><input class="input" type="date" id="check-from" aria-label="${T('开始日期','From')}"><span>–</span><input class="input" type="date" id="check-to" aria-label="${T('结束日期','To')}"></div></div>`:'';
 el.innerHTML=`${jobStrips(kindJobs(key))}
 <section class="panel blueprint check-panel"><h4>${T(`核验${tx(spec.name)}`,`Check ${tx(spec.name).toLowerCase()}`)}</h4><p class="muted" style="font-size:13px;line-height:1.7">${esc(tx(spec.hint))}</p>
 ${batchField}${modeField}${yearField}${rangeField}
 ${materialFields({placeholder:T('在此粘贴参考资料文字，或直接粘贴截图…','Paste the reference here, or paste a screenshot…'),drop:T('拖入或粘贴参考资料截图、照片、PDF 或 Excel（可多选），或点击选择','Drop or paste screenshots, photos, PDFs or Excel workbooks (several allowed), or click to choose'),label:T('参考资料','Reference')})}
 <p class="alert" data-progress hidden></p><p class="alert bad" role="alert" data-error hidden></p>
 <div class="dialog-actions"><button type="button" class="btn btn-primary" data-start${spec.scope==='batch'&&!batches.length?' disabled':''}>${T('开始核验','Check')}</button></div></section>`;
 const panel=el.querySelector('.check-panel'),materials=bindMaterials(panel);
 const progress=message=>{const p=panel.querySelector('[data-progress]');p.textContent=message;p.hidden=!message;};
 if(!view.status?.configured){const e=panel.querySelector('[data-error]');e.textContent=T('尚未配置 LLM_WORKER_URL 和 LLM_WORKER_TOKEN，请配置后重启服务。','LLM_WORKER_URL and LLM_WORKER_TOKEN are not configured. Configure them and restart the service.');e.hidden=false;}
 const select=panel.querySelector('#check-batch');if(select)select.onchange=()=>{view.batch=select.value;showReference(el,key,main);};
 $$('[data-mode]',panel).forEach(b=>b.onclick=()=>{view.mode=b.dataset.mode;$$('[data-mode]',panel).forEach(x=>x.setAttribute('aria-pressed',String(x===b)));});
 const start=/** @type {HTMLButtonElement} */(panel.querySelector('[data-start]'));
 start.onclick=async()=>{
  const error=panel.querySelector('[data-error]');error.hidden=true;start.disabled=true;
  try{
   const fields={};
   if(key==='students'){const year=Number(panel.querySelector('#check-year').value);if(!Number.isInteger(year)||year<2000||year>2199)fail(T('请填写名单所属学年。','Enter the school year of the list.'));fields.academicYear=year;}
   if(spec.range){fields.from=panel.querySelector('#check-from').value;fields.to=panel.querySelector('#check-to').value;if(fields.from&&fields.to&&fields.from>fields.to)fail(T('结束日期不能早于开始日期。','The end date cannot precede the start date.'));}
   if(spec.mode)fields.mode=view.mode;
   const collected=await materials.collect(progress);
   const job=await startJob(`check-${key}`,materialsForm(collected,fields),spec.scope==='batch'?`batch=${encodeURIComponent(view.batch)}`:'');
   openJob(job,{panes:collected.panes});
  }catch(e){error.textContent=e.message;error.hidden=false;}
  finally{start.disabled=false;}
 };
 watchJobs(()=>kindJobs(key),()=>Boolean(el.isConnected)&&view.tab===key);
}

/* — the review: the server's comparison, grouped by status, with the corrections to tick — */
const changeLine=(change,choosable)=>`<label class="notice-diff check-change">${choosable?`<input type="checkbox" name="field" value="${esc(change.field)}" checked>`:''}<span>${esc(tx(FIELDS[change.field]||[change.field,change.field]))}：<span class="struck">${esc(value(change.field,change.from))}</span> → <span>${esc(value(change.field,change.to))}</span></span></label>`;
const recordLine=record=>record?[record.title,record.when,record.status==='draft'?T('草稿','draft'):''].filter(Boolean).join(' · '):'';
function itemCard(key,item,i){
 const spec=CHECKS[key],row=item.row?spec.row(item.row):null,choosable=Boolean(item.apply?.fields);
 // A card locates its source by the reference row it came from (key r<index>); an extra item has none.
 const index=/^r(\d+)$/.exec(item.key)?.[1];
 const what=item.status==='extra'?(item.action==='cancel'?T('应用后将标记取消','Will be cancelled'):item.action==='delete'?T('应用后将删除','Will be deleted'):T('只报告，不会删除','Reported only; never deleted')):item.status==='missing'?(item.apply?T(key==='events'?'应用后将新建为草稿':'应用后将新增','Will be added'):T('只报告','Reported only')):'';
 const stored=item.student?[item.student.name,item.student.englishName,item.student.className,item.student.graduationYear&&value('graduationYear',item.student.graduationYear),item.student.email].filter(Boolean).join(' · ')
  :item.session?[item.session.title,item.session.date,`${item.session.start}–${item.session.end}`,(item.session.grades||[]).join(' / ')].join(' · ')
  :item.seat?[item.seat.name,item.seat.room,item.seat.row?`${item.seat.row}-${item.seat.column}`:'',item.seat.className].filter(Boolean).join(' · ')
  :recordLine(item.record);
 const candidates=item.candidates?.length?`<p class="muted notice-note">${T('候选：','Candidates: ')}${item.candidates.map(c=>esc([c.name,c.englishName,c.className,c.graduationYear&&value('graduationYear',c.graduationYear)].filter(Boolean).join(' · '))).join('；')}</p>`:'';
 return `<div class="ai-card notice-card check-card"${index!=null?` data-pick="${index}"`:''} data-item="${i}"><div class="notice-head">${item.apply?`<input type="checkbox" name="include"${item.status==='extra'?'':' checked'} aria-label="${T('应用此项','Apply this item')}">`:''}<span class="tag ${LOUD.includes(item.status)?'tag-accent':'tag-outline'} small">${esc(tx(STATUS[item.status]))}</span><strong>${esc(item.title||row?.[0]||item.student?.name||item.student?.englishName||'')}</strong></div>
 ${row?`<p class="muted notice-note">${T('参考：','Reference: ')}${esc(row.filter(Boolean).join(' · '))}</p>`:''}${stored?`<p class="muted notice-note">${T('现有：','Stored: ')}${esc(stored)}</p>`:''}
 ${item.changes.map(change=>changeLine(change,choosable)).join('')}${what?`<p class="notice-note">${esc(what)}</p>`:''}${item.note?`<p class="muted notice-note">${esc(item.note)}</p>`:''}${candidates}<p class="alert bad" data-item-error hidden></p></div>`;
}
async function showComparison(key,review,job){
 let compared;
 try{compared=await api('/admin/checks/'+encodeURIComponent(job.id));}catch(error){review.error(error.message);return;}
 const items=compared.items,loud=items.map((item,i)=>[item,i]).filter(([item])=>LOUD.includes(item.status)),quiet=items.map((item,i)=>[item,i]).filter(([item])=>!LOUD.includes(item.status));
 const counts=Object.keys(STATUS).map(s=>[s,items.filter(i=>i.status===s).length]).filter(([,n])=>n).map(([s,n])=>`${tx(STATUS[s])} ${n}`).join(' · ');
 const notes=[...(compared.partial?[T('核验未完成：以下只对照了中断前读出的部分。','The check stopped early: only what was read before then is compared.')]:[]),...compared.warnings];
 const range=compared.from?T(` · 对照 ${compared.from} 至 ${compared.to}`,` · ${compared.from} to ${compared.to}`):'';
 review.results((loud.length?loud.map(([item,i])=>itemCard(key,item,i)).join(''):`<p class="muted">${T('没有需要处理的差异。','Nothing differs.')}</p>`)
  +(quiet.length?`<details class="check-quiet"><summary class="muted" style="cursor:pointer;padding:8px 0">${T(`另有 ${quiet.length} 项一致或无法核验`,`${quiet.length} more match or cannot be compared`)}</summary>${quiet.map(([item,i])=>itemCard(key,item,i)).join('')}</details>`:''),
  {notes,elapsed:null,total:null,invalid:compared.invalid});
 review.count((counts||T('没有读出任何条目','Nothing was read'))+range);
 const bar=review.actions(`${discardButton(job)}<button type="button" class="btn btn-secondary" data-dismiss>${T('关闭','Close')}</button><button type="button" class="btn btn-primary" data-apply${items.some(i=>i.apply)?'':' disabled'}>${T('应用勾选的修正','Apply ticked corrections')}</button>`);
 bar.querySelector('[data-dismiss]').onclick=review.close;bindDiscard(bar,job,review);
 bar.querySelector('[data-apply]').onclick=()=>applyItems(key,items,review,job);
}
/**
 * Applies the ticked items: exam checks in one update of the batch draft, the rest each through its record's own API.
 * A record changed by several items (dates of one series) takes the version its previous response gave.
 */
async function applyItems(key,items,review,job){
 const buttons=$$('[data-actions] button',review.body);buttons.forEach(b=>b.disabled=true);review.alert('');
 const ticked=$$('[data-item]',review.body).filter(card=>card.querySelector('[name=include]')?.checked).map(card=>({card,item:items[Number(card.dataset.item)]}));
 let applied=0,failed=0;
 try{
  if(!ticked.length)fail(T('请至少勾选一项。','Tick at least one item.'));
  if(CHECKS[key].scope==='batch'){
   const result=await api(`/admin/checks/${encodeURIComponent(job.id)}/apply`,{method:'POST',body:JSON.stringify({keys:ticked.map(t=>t.item.key)})});
   applied=result.applied.length;
  }else{
   const versions={};
   for(const {card,item} of ticked){
    const error=card.querySelector('[data-item-error]');error.hidden=true;
    const {method,path,body,fields,record}=item.apply;
    const chosen=fields?$$('[name=field]:checked',card).map(box=>box.value).filter(f=>fields[f]):[];
    if(fields&&!chosen.length)continue;
    try{
     const result=await api(path,{method,body:JSON.stringify({...body,...(record&&versions[record]?{version:versions[record]}:{}),...Object.assign({},...chosen.map(f=>fields[f]))})});
     if(result?.id&&result.version)versions[result.id]=result.version;
     applied++;
    }catch(e){failed++;error.textContent=e.message;error.hidden=false;}
   }
  }
  await Promise.allSettled([loadBatches(),loadEvents(),loadPlans()]);refreshNav();
  if(failed)review.alert(T(`已应用 ${applied} 项，${failed} 项未能保存（可能已被他人修改），请查看后重试。`,`${applied} applied, ${failed} could not be saved (perhaps changed elsewhere). Check them and try again.`));
  else toast(T(`已应用 ${applied} 项修正。`,`Applied ${applied} corrections.`));
  if(!failed)await showComparison(key,review,job);
 }catch(e){review.alert(e.message);}
 finally{buttons.forEach(b=>b.disabled=false);}
}

for(const key of Object.keys(CHECKS))registerJobKind(`check-${key}`,{name:[`核验${CHECKS[key].name[0]}`,`${CHECKS[key].name[1]} check`],itemKey:CHECKS[key].itemKey,
 card:(row,i)=>{const [title,detail]=CHECKS[key].row(row);return `<div class="ai-card" data-pick="${i}" tabindex="0"><span class="ai-card-title">${esc(title)}</span><span class="muted num">${esc(detail)}</span></div>`;},
 show:(result,review,{job})=>showComparison(key,review,job)});
