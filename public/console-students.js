import {$,$$,esc,corners,icon,app,T,tx,api,toast,modal,closeModal,busy,errorLine,fail} from './console-core.js';
import {streamApi,reviewView} from './ai-review.js';
import {materialFields,bindMaterials} from './material-input.js';
import {gradeLabel} from './grades.mjs';

const PAGE=50;
let students=null,domain='';
// Filters live in the address (#students?q=…&issues=1&class=…&year=…&page=…) so reloads and Back keep them.
const view={q:'',issues:false,className:'',year:'',page:1};

export async function showStudents(main,hashQuery=''){
 if(app.user.role!==3){main.innerHTML=`<p class="load-error">${T('只有 admin 可以管理学生。','Only admins can manage students.')}</p>`;return;}
 const params=new URLSearchParams(hashQuery);
 Object.assign(view,{q:params.get('q')||'',issues:params.get('issues')==='1',className:params.get('class')||'',year:params.get('year')||'',page:Math.max(1,Number(params.get('page'))||1)});
 if(!students){main.innerHTML=`<p class="loading">${T('正在加载学生…','Loading students…')}</p>`;await load();}
 const classes=[...new Set(students.map(s=>s.className).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 const years=[...new Set(students.map(s=>s.graduationYear).filter(Boolean))].sort();
 const option=(value,label,current)=>`<option value="${esc(value)}"${String(current)===String(value)?' selected':''}>${esc(label)}</option>`;
 main.innerHTML=`<div class="page">
 <header class="page-head"><div><div class="kicker">${T('管理后台','Admin console')}</div><h1>${T('学生管理','Students')}</h1><p class="sub">${T('在考试中录入或导入座位后自动整理学生。身份修正后，请保存并重新发布相关批次座位。','Students are collected from exam seating. After correcting an identity, save and republish the affected seating.')}</p></div>
 <div class="page-actions"><button type="button" class="btn btn-secondary" data-act="check">${T('核验年级','Check grades')}</button><button type="button" class="btn btn-secondary" data-act="refresh">${T('刷新','Refresh')}</button></div></header>
 <section class="panel blueprint">${corners}<h4>${T('学校邮箱域名','School email domain')}</h4>
  <form class="domain-form" id="domain-form" novalidate><input class="input" name="domain" required value="${esc(domain)}" placeholder="${T('学校实际域名','School domain')}" aria-label="${T('学校邮箱域名','School email domain')}"><button type="submit" class="btn btn-primary">${T('保存域名','Save domain')}</button></form>
  <p class="muted" style="font-size:12px;margin-top:8px">${T('保存后，新发布的座位使用此域名匹配；不会改变已有发布结果。','Seating published from now on matches with this domain; existing publications stay as they are.')}</p></section>
 <div class="toolbar">
  <label class="search">${icon.search}<input class="input" id="st-q" type="search" value="${esc(view.q)}" placeholder="${T('搜索姓名、拼音、班级或邮箱','Search name, pinyin, class or email')}" aria-label="${T('搜索学生','Search students')}"></label>
  <select class="input" id="st-class" aria-label="${T('班级','Class')}">${option('',T('全部班级','All classes'),view.className)}${classes.map(c=>option(c,c,view.className)).join('')}</select>
  <select class="input" id="st-year" aria-label="${T('届别','Cohort')}">${option('',T('全部届别','All cohorts'),view.year)}${years.map(y=>option(y,T(`${y} 届`,`Class of ${y}`),view.year)).join('')}</select>
  <button type="button" class="checkbox" id="st-issues" aria-pressed="${view.issues}">${T('只看有问题的','Issues only')}</button>
 </div>
 <div id="student-list"></div>
 </div>`;
 const page=main.querySelector('.page');
 renderList();
 const refilter=()=>{view.page=1;renderList();};
 $('#st-q').oninput=e=>{view.q=e.target.value;refilter();};
 $('#st-class').onchange=e=>{view.className=e.target.value;refilter();};
 $('#st-year').onchange=e=>{view.year=e.target.value;refilter();};
 $('#st-issues').onclick=e=>{view.issues=!view.issues;e.currentTarget.setAttribute('aria-pressed',String(view.issues));refilter();};
 $('#domain-form').onsubmit=saveDomain;
 page.onclick=async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.act==='refresh'){b.disabled=true;try{await load();showStudents(main,query());toast(T('列表已刷新。','List refreshed.'));}catch(error){toast(error.message,{bad:true});}finally{b.disabled=false;}}
  else if(b.dataset.act==='check')checkDialog(main);
  else if(b.dataset.student)editStudent(b.dataset.student,main);
  else if(b.dataset.page){view.page=Number(b.dataset.page);renderList();main.scrollTop=0;}
 };
}

async function load(){
 const [settings,list]=await Promise.all([api('/admin/students/settings'),api('/admin/students')]);
 domain=settings.domain;students=list;
}
function query(){
 const params=new URLSearchParams();
 if(view.q)params.set('q',view.q);if(view.issues)params.set('issues','1');if(view.className)params.set('class',view.className);if(view.year)params.set('year',view.year);if(view.page>1)params.set('page',String(view.page));
 return params.toString();
}
const label=s=>s.name||s.englishName;
function filtered(){
 const q=view.q.trim().toLowerCase();
 return students.filter(s=>(!view.issues||s.issues.length)&&(!view.className||s.className===view.className)&&(!view.year||String(s.graduationYear)===view.year)
  &&(!q||[s.name,s.englishName,s.pinyin,s.className,s.email,s.id].some(v=>String(v||'').toLowerCase().includes(q))));
}
function renderList(){
 const host=$('#student-list');if(!host)return;
 const list=filtered(),pages=Math.max(1,Math.ceil(list.length/PAGE));
 view.page=Math.min(view.page,pages);
 app.replaceHash('students'+(query()?'?'+query():''));
 const rows=list.slice((view.page-1)*PAGE,view.page*PAGE);
 host.innerHTML=!students.length?`<div class="empty"><strong>${T('暂无学生','No students yet')}</strong><p>${T('在考试中录入座位并保存草稿后，学生会出现在这里。','Students appear here after seats are entered in an exam draft.')}</p></div>`
  :`<p class="muted" style="font-size:13px;margin:12px 0 8px">${T(`共 ${list.length} 名学生`,`${list.length} students`)}${list.length!==students.length?T(`（全部 ${students.length}）`,` (of ${students.length})`):''}</p>
 <div class="grid-scroll"><div class="students-grid"><div class="grid-head"><span>${T('学生','Student')}</span><span>${T('班级','Class')}</span><span>${T('届别','Cohort')}</span><span>${T('学校邮箱','School email')}</span><span></span></div>
 ${rows.map(s=>`<div class="grid-row"><div class="clip"><div class="cell-main clip">${esc(label(s))}${s.issues.length?` <span class="tag tag-outline small">${T('待核实','Check')}</span>`:''}</div><div class="cell-sub clip">${esc([s.englishName,s.pinyin].filter(Boolean).join(' · '))}</div>${s.issues.length?`<div class="cell-sub issue">${s.issues.map(esc).join('；')}</div>`:''}</div>
 <span style="font-size:13px">${esc(s.className)}</span><span class="num" style="font-size:13px">${s.graduationYear||T('待补充','Unknown')}</span><span class="clip" style="font-size:13px">${esc(s.email||T('邮箱待补充','Email unknown'))}</span>
 <div class="row-actions"><button type="button" class="btn btn-ghost" data-student="${esc(s.id)}">${T('核实 / 修正','Review')}</button></div></div>`).join('')||`<div class="empty"><strong>${T('没有符合条件的学生','No matching students')}</strong></div>`}</div></div>
 ${pages>1?`<div class="pager"><button type="button" class="btn btn-ghost btn-icon" data-page="${view.page-1}"${view.page===1?' disabled':''} aria-label="${T('上一页','Previous page')}">${icon.prev}</button><span class="num">${view.page} / ${pages}</span><button type="button" class="btn btn-ghost btn-icon" data-page="${view.page+1}"${view.page===pages?' disabled':''} aria-label="${T('下一页','Next page')}">${icon.next}</button></div>`:''}`;
}

async function saveDomain(event){
 event.preventDefault();
 const form=event.target,button=form.querySelector('[type=submit]');
 button.disabled=true;
 try{const saved=await api('/admin/students/settings',{method:'PUT',body:JSON.stringify({domain:form.domain.value})});domain=saved.domain;await load();renderList();toast(T('域名已保存。请重新发布需要更新的座位表。','Domain saved. Republish seating that should use it.'));}
 catch(error){toast(error.message,{bad:true});}
 finally{button.disabled=false;}
}

function editStudent(id,main){
 const s=students.find(s=>s.id===id);if(!s)return;
 const field=(key,text,type='text')=>`<div class="field"><label>${text}</label><input class="input" name="${key}" type="${type}" value="${esc(s[key]??'')}"></div>`;
 const others=students.filter(t=>t.id!==id);
 const body=modal(T('核实学生信息','Review student'),`<p class="muted" style="font-size:12px">${T('学生编号','Student ID')} ${esc(s.id)}</p>
 ${s.issues.length?`<p class="callout">${s.issues.map(esc).join('；')}</p>`:''}
 <div class="two">${field('name',T('中文名','Chinese name'))}${field('englishName',T('英文名','English name'))}</div>
 <div class="two">${field('className',T('班级（最近学年）','Class (latest year)'))}${field('graduationYear',T('毕业年份','Graduation year'),'number')}</div>
 <div class="two">${field('pinyin',T('姓名拼音（小写）','Name pinyin (lowercase)'))}${field('actualEmail',T('实际邮箱（可选）','Actual email (optional)'),'email')}</div>
 <p class="muted" style="font-size:12px">${T('修正仅影响之后发布的座位，已发布结果保持不变。','Corrections apply to seating published from now on.')}</p>
 <h4 class="dialog-sub">${T('关联座位','Linked seats')}</h4>
 <ul class="student-refs">${(s.references||[]).map(r=>`<li>${r.kind==='draft'?T('草稿','Draft'):T('已发布','Published')} · ${esc(r.examId)} · ${esc(r.room)} · ${T(`${r.row} 排 ${r.column} 列`,`Row ${r.row} · Col ${r.column}`)}</li>`).join('')||`<li class="muted">${T('无','None')}</li>`}</ul>
 ${others.length?`<h4 class="dialog-sub">${T('合并重复学生','Merge a duplicate')}</h4>
 <div class="student-merge"><label class="search">${icon.search}<input class="input" type="search" data-merge-q autocomplete="off" placeholder="${T('搜索姓名、拼音、班级或邮箱','Search name, pinyin, class or email')}" aria-label="${T('搜索保留的学生','Search the student to keep')}"></label><button type="button" class="btn btn-secondary" data-merge-preview>${T('预览合并','Preview merge')}</button></div>
 <div class="merge-options" data-merge-options role="listbox" aria-label="${T('保留的学生','Student to keep')}"></div><div data-merge-result></div>`:''}
 ${errorLine}<div class="dialog-actions"><button type="button" class="btn btn-secondary" data-close>${T('返回','Go back')}</button><button type="button" class="btn btn-primary" data-save>${T('保存修正','Save correction')}</button></div>`,{size:'medium'});
 const done=async message=>{await load();closeModal();showStudents(main,query());toast(message);};
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  const data=Object.fromEntries($$('input[name]',body).map(el=>[el.name,el.value.trim()]));
  await api('/admin/students/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({...data,graduationYear:data.graduationYear?Number(data.graduationYear):null,version:s.version})});
  await done(T('学生信息已保存。','Student saved.'));
 });
 const preview=body.querySelector('[data-merge-preview]');
 let targetId='';
 if(preview){
  // With no query, suggest likely duplicates (same name or pinyin); otherwise every word must match one of the fields.
  const search=body.querySelector('[data-merge-q]'),options=body.querySelector('[data-merge-options]');
  const showOptions=()=>{
   const q=search.value.trim().toLowerCase(),words=q.split(/[\s·,，]+/).filter(Boolean);
   const list=q?others.filter(t=>words.every(w=>[t.name,t.englishName,t.pinyin,t.className,t.email,t.id].some(v=>String(v||'').toLowerCase().includes(w))))
    :others.filter(t=>(s.name&&t.name===s.name)||(s.pinyin&&t.pinyin===s.pinyin));
   // A choice that the search no longer shows is dropped, so Preview never uses a hidden student.
   if(targetId&&!list.some(t=>t.id===targetId)){targetId='';body.querySelector('[data-merge-result]').innerHTML='';}
   options.innerHTML=list.map(t=>`<button type="button" role="option" class="merge-option" data-id="${esc(t.id)}" aria-selected="${t.id===targetId}"><span class="cell-main clip">${esc(label(t))}${t.englishName&&t.name?` <span class="muted">${esc(t.englishName)}</span>`:''}</span><span class="cell-sub clip">${esc([t.className,t.graduationYear&&T(`${t.graduationYear} 届`,`Class of ${t.graduationYear}`),t.email].filter(Boolean).join(' · '))}</span></button>`).join('')
    +(!list.length&&q?`<p class="muted merge-more">${T('没有符合条件的学生','No matching students')}</p>`:'');
  };
  search.oninput=showOptions;
  // Enter while an input method is composing only confirms the characters.
  search.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();options.querySelector('.merge-option')?.click();}};
  options.onclick=e=>{const b=e.target.closest('.merge-option');if(!b)return;targetId=b.dataset.id;body.querySelector('[data-merge-result]').innerHTML='';showOptions();};
  showOptions();
 }
 if(preview)preview.onclick=()=>busy(body,async()=>{
  if(!targetId)fail(T('请选择保留的学生。','Choose the student to keep.'));
  const result=await api('/admin/students/'+encodeURIComponent(id)+'/merge-preview?target='+encodeURIComponent(targetId));
  const host=body.querySelector('[data-merge-result]');
  host.innerHTML=result.errors.length?`<p class="callout">${result.errors.map(esc).join('；')}</p>`
   :`<p class="dialog-text" style="margin-top:8px">${T(`将 ${esc(label(s))} 合并至 ${esc(label(result.target))}，影响 ${result.references.length} 条草稿或已发布座位引用。草稿关联会更新，已发布座位需重新发布。`,`Merges ${esc(label(s))} into ${esc(label(result.target))}, affecting ${result.references.length} draft or published seats. Drafts update; published seating needs republishing.`)}</p><button type="button" class="btn btn-primary" data-merge-go>${T('确认合并','Merge')}</button>`;
  const go=host.querySelector('[data-merge-go]');
  if(go)go.onclick=()=>busy(body,async()=>{
   await api('/admin/students/'+encodeURIComponent(id)+'/merge',{method:'POST',body:JSON.stringify({targetId,version:result.source.version,targetVersion:result.target.version})});
   await done(T('学生已合并；请重新发布相关批次座位。','Students merged; republish the affected seating.'));
  });
 });
}

/* — 核验年级: the model reads an admin's reference list; each row is compared with the stored students on the server,
   and the admin applies the corrections they tick through the usual student edit. — */
const STATUS={mismatch:['需修正','Needs correction'],ambiguous:['同名待选','Namesakes'],missing:['学生库中没有','Not in the database'],noGrade:['名单无年级','No grade listed'],ok:['一致','Matches']};
const ORDER=Object.keys(STATUS);
// Mirrors the server: "11.3", "11-3" and "G11 3" are one class.
const classKey=value=>String(value||'').toUpperCase().replace(/^GRADE\s*/,'').replace(/^G(?=\d)/,'').replace(/[\s.\-_·/]/g,'');
const changesFor=(student,item)=>({...(item.expected&&student.graduationYear!==item.expected?{graduationYear:item.expected}:{}),...(item.row.className&&classKey(student.className)!==classKey(item.row.className)?{className:item.row.className}:{})});

function checkDialog(main){
 const body=modal(T('核验学生年级','Check student grades'),`<p class="muted" style="font-size:13px;line-height:1.7">${T('粘贴学校的班级名单或花名册，也可以加入截图、照片或 PDF。AI 读出每位学生的班级和年级，再与学生库对照；核对后勾选的修正才会保存。','Paste a class list or roster, or add screenshots, photos or PDFs. The AI reads each student’s class and grade and compares them with the student records; only the corrections you tick are saved.')}</p>
 <div class="field"><label for="check-year">${T('名单所属学年（开始年份，如 2026 即 2026–2027 学年）','School year of the list (starting year, e.g. 2026 for 2026–27)')}</label><input class="input" id="check-year" type="number" min="2000" max="2199" name="academicYear"></div>
 ${materialFields({placeholder:T('在此粘贴名单文字，或直接粘贴截图…','Paste the list here, or paste a screenshot…'),drop:T('拖入或粘贴名单截图、照片或 PDF（可多选），或点击选择','Drop or paste screenshots, photos or PDFs (several allowed), or click to choose'),label:T('参考名单','Reference list')})}
 <p class="alert" data-progress hidden></p>${errorLine}
 <div class="dialog-actions"><button type="button" class="btn btn-secondary" data-close>${T('返回','Go back')}</button><button type="button" class="btn btn-primary" data-save>${T('开始核验','Check')}</button></div>`,{size:'medium'});
 const progress=message=>{const el=body.querySelector('[data-progress]');el.textContent=message;el.hidden=!message;};
 const materials=bindMaterials(body),year=/** @type {HTMLInputElement} */(body.querySelector('[name=academicYear]'));
 api('/admin/students/check').then(status=>{
  if(!year.value)year.value=String(status.academicYear);
  if(!status.configured){const el=body.querySelector('[data-error]');el.textContent=T('尚未配置 LLM_WORKER_URL 和 LLM_WORKER_TOKEN，请配置后重启服务。','LLM_WORKER_URL and LLM_WORKER_TOKEN are not configured. Configure them and restart the service.');el.hidden=false;}
 }).catch(()=>{});
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  const academicYear=Number(year.value);
  if(!Number.isInteger(academicYear)||academicYear<2000||academicYear>2199)fail(T('请填写名单所属学年。','Enter the school year of the list.'));
  const {parts,pane}=await materials.collect(progress);
  closeModal();
  await runCheck(parts.map(({items,...part})=>part),pane,academicYear,main);
 });
}

async function runCheck(parts,pane,academicYear,main){
 const streamed=[];let final=null;
 const review=reviewView({title:T('核验学生年级','Check student grades'),sourceOf:i=>(final?final.items[i]:streamed[i])?.source});
 review.source(pane);
 const close=/** @type {HTMLElement} */(review.actions(`<button type="button" class="btn btn-secondary" data-dismiss>${T('关闭','Close')}</button>`).querySelector('[data-dismiss]'));close.onclick=review.close;
 try{
  const done=await streamApi('/admin/students/check',{body:JSON.stringify({parts,academicYear}),signal:review.signal},message=>{
   review.message(message);
   if(message.type==='reset')streamed.length=0;
   if(message.type==='item'&&message.key==='students'){const s=message.item;streamed.push(s);review.append(`<div class="ai-card" data-pick="${streamed.length-1}" tabindex="0"><span class="ai-card-title">${esc([s.name,s.englishName].filter(Boolean).join(' · '))}</span><span class="muted num">${esc([s.className,typeof s.grade==='number'?gradeLabel(s.grade,app.lang):s.grade].filter(Boolean).join(' · '))}</span></div>`);}
  });
  final=done.result;
  showCheck(final,review,main,done.elapsed);
 }catch(error){if(error.name!=='AbortError')review.error(error.message);}
}

function showCheck(result,review,main,elapsed){
 const {items,academicYear:year}=result;
 const cohort=y=>{if(!y)return T('届别待补充','Cohort unknown');const g=year+13-y;return T(`${y} 届`,`Class of ${y}`)+(g>=1&&g<=12?` · ${gradeLabel(g,app.lang)}`:'');};
 const diff=(student,changes)=>Object.keys(changes).length?Object.entries(changes).map(([field,value])=>`<label class="notice-diff" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="field" value="${field}" checked>${field==='graduationYear'?`${T('届别','Cohort')}：<span class="struck">${esc(cohort(student.graduationYear))}</span> → <span>${esc(cohort(value))}</span>`:`${T('班级','Class')}：<span class="struck">${esc(student.className||T('无','none'))}</span> → <span>${esc(value)}</span>`}</label>`).join('')
  :`<p class="muted notice-note">${T('与名单一致，无需修正。','Matches the list; nothing to correct.')}</p>`;
 const card=i=>{
  const item=items[i],r=item.row,s=item.student,listed=[r.className,r.grade&&gradeLabel(r.grade,app.lang)].filter(Boolean).join(' · ')||T('未注明班级和年级','No class or grade listed');
  const editable=item.status==='mismatch'||item.status==='ambiguous';
  let detail='';
  if(item.status==='mismatch')detail=diff(s,item.changes);
  else if(item.status==='ambiguous')detail=`<select class="input" name="candidate" aria-label="${T('选择学生','Choose the student')}"><option value="">${T(`${item.candidates.length} 位同名学生，请选择…`,`${item.candidates.length} students share this name; choose one…`)}</option>${item.candidates.map(c=>`<option value="${esc(c.id)}">${esc([c.name||c.englishName,c.englishName&&c.name?c.englishName:'',c.className,cohort(c.graduationYear),c.email].filter(Boolean).join(' · '))}</option>`).join('')}</select><div data-diff></div>`;
  else if(item.status==='missing')detail=`<p class="muted notice-note">${T('学生库中没有此学生；在考试中录入座位后才会建档。','No such student yet; students are created from exam seating.')}</p>`;
  else detail=`<p class="muted notice-note">${T('学生库：','Records: ')}${esc([s.className,cohort(s.graduationYear)].filter(Boolean).join(' · '))}${item.status==='noGrade'?T('；名单未注明年级，无法核验。','; the list gives no grade to check.'):''}</p>`;
  return `<div class="ai-card notice-card" data-pick="${i}" data-item="${i}"><div class="notice-head">${editable?`<input type="checkbox" name="include"${item.status==='mismatch'?' checked':''} aria-label="${T('应用此项','Apply this item')}">`:''}<span class="tag ${editable?'tag-accent':'tag-outline'} small">${esc(tx(STATUS[item.status]))}</span><strong>${esc(r.name||r.englishName)}</strong>${r.name&&r.englishName?`<span class="muted">${esc(r.englishName)}</span>`:''}</div>
  <p class="muted notice-note">${T('名单：','List: ')}${esc(listed)}</p>${detail}<p class="alert bad" data-item-error hidden></p></div>`;
 };
 const sorted=items.map((_,i)=>i).sort((a,b)=>ORDER.indexOf(items[a].status)-ORDER.indexOf(items[b].status));
 const quiet=sorted.filter(i=>['ok','noGrade'].includes(items[i].status)),loud=sorted.filter(i=>!quiet.includes(i));
 const counts=ORDER.map(k=>[k,items.filter(i=>i.status===k).length]).filter(([,n])=>n).map(([k,n])=>`${tx(STATUS[k])} ${n}`).join(' · ');
 review.results(items.length?loud.map(card).join('')+(quiet.length?`<details class="check-quiet"><summary class="muted" style="cursor:pointer;padding:8px 0">${T(`另有 ${quiet.length} 名无需修正`,`${quiet.length} more need no correction`)}</summary>${quiet.map(card).join('')}</details>`:''):`<p class="muted">${T('名单中没有识别到学生。','No students were found in the list.')}</p>`,
  {notes:[...(counts?[T(`${year}–${year+1} 学年 · `,`${year}–${String(year+1).slice(2)} · `)+counts]:[]),...(result.warnings||[])],elapsed,total:items.length,invalid:result.invalid||[]});
 review.body.querySelectorAll('[name=candidate]').forEach(select=>select.onchange=()=>{
  const el=select.closest('[data-item]'),item=items[Number(el.dataset.item)],chosen=item.candidates.find(c=>c.id===select.value);
  const changes=chosen?changesFor(chosen,item):{};
  el.querySelector('[data-diff]').innerHTML=chosen?diff(chosen,changes):'';
  el.querySelector('[name=include]').checked=Boolean(Object.keys(changes).length);
 });
 const editable=items.some(i=>i.status==='mismatch'||i.status==='ambiguous');
 const bar=review.actions(`<button type="button" class="btn btn-secondary" data-dismiss>${T('关闭','Close')}</button><button type="button" class="btn btn-primary" data-apply${editable?'':' disabled'}>${T('保存勾选的修正','Save ticked corrections')}</button>`);
 bar.querySelector('[data-dismiss]').onclick=review.close;
 /** @type {HTMLElement} */(bar.querySelector('[data-apply]')).onclick=()=>applyCheck(items,review,main);
}

async function applyCheck(items,review,main){
 const buttons=$$('[data-apply],[data-dismiss]',review.body);buttons.forEach(b=>b.disabled=true);review.alert('');
 const cards=$$('[data-item]',review.body).filter(c=>c.querySelector('[name=include]')?.checked&&!c.dataset.applied);
 let applied=0,failed=0;
 try{
  if(!cards.length)fail(T('请至少勾选一项。','Tick at least one item.'));
  await load();
  for(const el of cards){
   const item=items[Number(el.dataset.item)],error=el.querySelector('[data-item-error]');error.hidden=true;
   try{
    const id=item.student?.id||el.querySelector('[name=candidate]')?.value;
    if(!id)fail(T('请选择学生。','Choose the student.'));
    const current=students.find(s=>s.id===id);if(!current)fail(T('该学生已被删除或合并，请刷新后重试。','This student was removed or merged; refresh and try again.'));
    // Compared again with the latest record, so a correction saved meanwhile is not undone.
    const changes=changesFor(current,item),fields=$$('[name=field]:checked',el).map(b=>b.value).filter(f=>f in changes);
    if(!fields.length)fail(T('没有需要保存的修正。','Nothing left to correct.'));
    const saved=await api('/admin/students/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({name:current.name||'',englishName:current.englishName||'',className:current.className||'',graduationYear:current.graduationYear??null,pinyin:current.pinyin||'',actualEmail:current.actualEmail||'',...Object.fromEntries(fields.map(f=>[f,changes[f]])),version:current.version})});
    students=students.map(s=>s.id===id?{...s,...saved}:s);
    el.dataset.applied='1';el.classList.add('notice-done');el.querySelector('[name=include]').disabled=true;applied++;
   }catch(e){failed++;error.textContent=e.message;error.hidden=false;}
  }
  await load();showStudents(main,query());
  if(!failed){review.close();toast(T(`已修正 ${applied} 名学生。已发布的座位需重新发布才会更新。`,`Corrected ${applied} students. Republish seating for it to take effect.`));}
  else review.alert(T(`已修正 ${applied} 名，${failed} 名未能保存，请查看后重试。`,`${applied} corrected, ${failed} could not be saved. Check them and try again.`));
 }catch(e){review.alert(e.message);}
 finally{buttons.forEach(b=>b.disabled=false);}
}
