import {$,$$,esc,corners,icon,app,T,api,toast,modal,closeModal,busy,errorLine,fail} from './console-core.js';

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
 <div class="page-actions"><button type="button" class="btn btn-secondary" data-act="refresh">${T('刷新','Refresh')}</button></div></header>
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
