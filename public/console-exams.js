import {$,$$,esc,corners,icon,app,T,tx,SCOPES,api,toast,modal,closeModal,busy,errorLine,fail,go,refreshNav,md,mdw,stamp,loadBatches,loadSubjects} from './console-core.js';
import {moveSeat,roomExamsAt,seatViewTimes} from './exam-seats.mjs';
import {subjectName} from './exam-subjects.mjs';
import {defaultExamSlots} from './exam-times.mjs';
import {importPreview} from './exam-import-preview.js';
import {readExamPdf} from './exam-pdf-input.js';

const view={id:'',tab:'sessions',room:0,exam:'',time:''};
const divisions=['primary','middle','high'];
const batch=()=>app.data.batches.find(b=>b.id===view.id);
const bTitle=b=>app.lang?(b.titleEn||b.title):b.title;
const bDivision=b=>b.division?tx(SCOPES[b.division]):[...new Set(b.sessions.map(s=>s.division))].map(d=>tx(SCOPES[d])).join(' / ')||'—';
const sName=s=>{const name=app.lang?(s.titleEn||s.title):s.title;return name+(s.level&&!name.includes(s.level)?' '+s.level:'');};
const sorted=sessions=>[...sessions].sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start)||a.title.localeCompare(b.title));
const slotsOf=b=>b.timeSlots||defaultExamSlots;
const pubTag=on=>on?'tag tag-accent':'tag tag-outline';
const count=(n,zh,en)=>T(`${n} ${zh}`,`${n} ${en}`);
const segHtml=(attr,items,value)=>`<div class="seg full">${items.map(([k,label])=>`<button type="button" data-${attr}="${k}" aria-pressed="${value===k}">${label}</button>`).join('')}</div>`;
let rerender=()=>{};

async function ensureData(main){
 if(app.data.batches&&app.data.subjects)return;
 main.innerHTML=`<p class="loading">${T('正在加载考试…','Loading exams…')}</p>`;
 await Promise.all([app.data.batches||loadBatches(),app.data.subjects||loadSubjects()]);
}

/* — batch list — */
export async function showExams(main){
 await ensureData(main);
 rerender=()=>showExams(main);
 const batches=[...app.data.batches].sort((a,b)=>b.start.localeCompare(a.start));
 main.innerHTML=`<div class="page">
 <header class="page-head"><div><div class="kicker">${T('管理后台','Admin console')}</div><h1>${T('考试','Exams')}</h1><p class="sub">${T('按批次管理场次、教室与座位；考试安排与座位表分别发布。','Manage sessions, rooms and seats by batch; schedule and seating publish separately.')}</p></div>
 <div class="page-actions"><a class="btn btn-secondary" href="/students.html">${T('学生管理','Students')}</a><button type="button" class="btn btn-secondary" data-act="subjects">${T('管理学科','Subjects')}</button><button type="button" class="btn btn-primary blueprint" data-act="new">${corners}${icon.plus}${T('新建考试批次','New batch')}</button></div></header>
 <div class="grid-scroll"><div class="batches-grid"><div class="grid-head"><span>${T('批次','Batch')}</span><span>${T('日期','Date')}</span><span>${T('场次','Sessions')}</span><span>${T('考试安排','Schedule')}</span><span>${T('座位表','Seating')}</span></div>
 ${batches.map(b=>`<button type="button" class="grid-row" data-open="${esc(b.id)}"><div class="clip"><div class="cell-main clip">${esc(bTitle(b))}</div><div class="cell-sub">${esc(bDivision(b))}</div></div><span class="num" style="font-size:13px">${b.start.slice(0,4)} · ${esc(md(b.start))} – ${esc(md(b.end))}</span><span class="num" style="font-size:13px">${b.sessions.length}</span>
 <span><span class="${pubTag(b.publishedAt)}">${b.publishedAt?T('已发布','Published')+(b.scheduleChanged?T(' · 有修改',' · edited'):''):T('草稿','Draft')}</span></span><span><span class="${pubTag(b.seatingPublishedAt)}">${b.seatingPublishedAt?T('已发布','Published'):T('未发布','Not published')}</span></span></button>`).join('')
 ||`<div class="empty"><strong>${T('暂无考试批次','No exam batches yet')}</strong><p>${T('新建批次后添加场次、教室与座位。','Create a batch, then add sessions, rooms and seats.')}</p></div>`}</div></div></div>`;
 main.querySelector('.page').onclick=e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.open)location.hash='exams/'+encodeURIComponent(b.dataset.open);
  else if(b.dataset.act==='new')batchMetaDialog(null);
  else if(b.dataset.act==='subjects')subjectsDialog();
 };
}

/* — saving the draft — */
function payload(b){const {id,publishedAt,seatingPublishedAt,scheduleChanged,updatedAt,...data}=b;return data;}
function replace(saved){const list=app.data.batches,i=list.findIndex(b=>b.id===saved.id);if(i<0)list.push(saved);else list[i]=saved;refreshNav();}
async function put(next){return api('/admin/exams/'+encodeURIComponent(next.id),{method:'PUT',body:JSON.stringify(payload(next))});}
/** Save a changed copy of the current draft, with an Undo that restores the previous draft. */
async function commit(next,message){
 const before=batch();
 const saved=await put(next);replace(saved);rerender();
 toast(message,{undo:async()=>{const restored=await put({...before,version:batch().version});replace(restored);rerender();toast(T('已撤销更改。','Change undone.'));}});
}
const update=(mutate,message)=>{const next=structuredClone(batch());mutate(next);return commit(next,message);};
const draftMsg=()=>T('已保存到草稿，发布后学生可见。','Saved to draft. Publish to show students.');

/* — batch detail — */
export async function showBatch(main,id){
 await ensureData(main);
 if(view.id!==id)Object.assign(view,{id,tab:'sessions',room:0,exam:'',time:''});
 rerender=()=>renderBatch(main);
 renderBatch(main);
}
function renderBatch(main){
 const b=batch();
 if(!b){main.innerHTML=`<div class="page"><a class="btn btn-ghost back" href="#exams">← ${T('考试','Exams')}</a><p class="load-error" style="padding:0">${T('考试批次不存在或已被删除。','This exam batch no longer exists.')}</p></div>`;return;}
 const tabs=[['sessions',T('场次','Sessions'),b.sessions.length],['rooms',T('教室','Rooms'),b.rooms.length],['slots',T('时间段','Time slots'),slotsOf(b).length]];
 main.innerHTML=`<div class="page">
 <a class="btn btn-ghost back" href="#exams">← ${T('考试','Exams')}</a>
 <header class="page-head"><div><div class="kicker">${esc(bDivision(b))}</div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h1 style="font-size:32px">${esc(bTitle(b))}</h1><button type="button" class="btn btn-ghost" data-act="meta" style="font-size:13px">${T('编辑信息','Edit info')}</button></div>
 <p class="sub">${esc(md(b.start))} – ${esc(md(b.end))} · ${count(b.sessions.length,'场考试','sessions')} · ${count(b.rooms.length,'间教室','rooms')}${b.academicYear?' · '+T(`${b.academicYear}–${b.academicYear+1} 学年`,`${b.academicYear}–${b.academicYear+1} academic year`):''}</p></div>
 <div class="page-actions"><span class="muted" style="font-size:12px">${T('修改即时保存为草稿','Changes save to draft automatically')}</span><button type="button" class="btn btn-ghost btn-danger" data-act="delete">${T('删除批次','Delete batch')}</button></div></header>
 <div class="status-cards">
  <div class="status-card blueprint">${corners}<div><div class="title">${T('考试安排','Schedule')}<span class="${pubTag(b.publishedAt)}">${b.publishedAt?T('已发布','Published'):T('草稿','Draft')}</span></div><div class="note">${b.publishedAt?T(`上次发布 ${stamp(b.publishedAt)}`,`Last published ${stamp(b.publishedAt)}`)+(b.scheduleChanged?T(' · 有未发布修改',' · unpublished changes'):''):T('尚未发布','Not yet published')}</div></div><button type="button" class="btn btn-primary" data-act="pub-schedule">${T('预览并发布','Preview & publish')}</button></div>
  <div class="status-card blueprint">${corners}<div><div class="title">${T('座位表','Seating')}<span class="${pubTag(b.seatingPublishedAt)}">${b.seatingPublishedAt?T('已发布','Published'):T('未发布','Not published')}</span></div><div class="note">${b.seatingPublishedAt?T(`上次发布 ${stamp(b.seatingPublishedAt)}`,`Last published ${stamp(b.seatingPublishedAt)}`):T('学生暂不可见座位','Students cannot see seats yet')}</div></div><button type="button" class="btn btn-secondary" data-act="pub-seating">${T('预览并发布','Preview & publish')}</button></div>
 </div>
 <div class="tabs" role="tablist">${tabs.map(([k,label,n])=>`<button type="button" role="tab" data-tab="${k}" aria-selected="${view.tab===k}">${label}<span class="count">${n}</span></button>`).join('')}</div>
 <div id="batch-tab">${view.tab==='sessions'?sessionsTab(b):view.tab==='rooms'?roomsTab(b):slotsTab(b)}</div></div>`;
 const page=main.querySelector('.page');
 page.onclick=e=>onBatchClick(e,b);
 if(view.tab==='rooms')bindSeats(b);
 $$('[data-import]').forEach(input=>input.onchange=()=>{importSeats(input.files[0],input.dataset.import==='llm');input.value='';});
}

function sessionsTab(b){
 const rows=sorted(b.sessions);
 return `<div class="tab-actions"><button type="button" class="btn btn-secondary" data-act="extract">${T('从 PDF 提取','Extract from PDF')}</button><button type="button" class="btn btn-secondary" data-act="add-exam">+ ${T('新增考试','Add exam')}</button></div>
 ${rows.length?`<div class="grid-scroll"><div class="sessions-grid"><div class="grid-head"><span>${T('日期','Date')}</span><span>${T('考试','Exam')}</span><span>${T('学部 / 年级','Division / grade')}</span><span>${T('教室','Rooms')}</span><span>${T('状态','Status')}</span><span></span></div>
 ${rows.map(s=>`<div class="grid-row"><div class="num"><div class="cell-main">${esc(mdw(s.date))}</div><div class="cell-sub">${s.start}–${s.end}</div></div><div class="cell-main${s.cancelled?' struck':''}">${esc(sName(s))}</div><span style="font-size:13px">${esc(tx(SCOPES[s.division]))} · ${esc(s.grades.join(' / '))}</span><span style="font-size:13px">${esc(s.rooms.join(' / '))}</span><span>${s.cancelled?`<span class="tag tag-outline">${T('已取消','Cancelled')}</span>`:''}</span><button type="button" class="btn btn-ghost" style="justify-self:end" data-exam="${esc(s.id)}">${T('编辑','Edit')}</button></div>`).join('')}</div></div>`
 :`<p class="empty"><span class="muted" style="font-size:14px">${T('暂无考试。新增考试，或从 PDF 提取。','No exams yet. Add one, or extract from a PDF.')}</span></p>`}`;
}

/** Seat view context for the selected room: which exams share the room at the selected moment. */
function seatContext(b){
 const room=b.rooms[view.room]||b.rooms[0];if(!room)return null;
 const editable={...b,sessions:b.sessions.map(s=>({...s,cancelled:false}))};
 const exams=sorted(editable.sessions.filter(s=>s.rooms.includes(room.name)));
 const exam=exams.find(s=>s.id===view.exam)||exams[0];
 const times=exam?seatViewTimes(editable,exam,room.name):[];
 const time=times.includes(view.time)?view.time:exam?.start;
 const active=exam?roomExamsAt(editable,exam,room.name,time):[];
 return {room,exams,exam,times,time,active,ids:active.map(s=>s.id)};
}
function roomsTab(b){
 const ctx=seatContext(b);
 if(!ctx)return `<div class="empty"><p style="font-size:14px">${T('暂无教室，请先新增教室。','No rooms yet. Add a room first.')}</p><button type="button" class="btn btn-secondary" data-act="add-room">+ ${T('新增教室','Add room')}</button></div>`;
 const {room,exams,exam,times,time,active,ids}=ctx;
 let seats='',filled=0;
 for(let r=1;r<=room.rows;r++)for(let c=1;c<=room.columns;c++){
  const index=b.seats.findIndex(s=>s.room===room.name&&s.row===r&&s.column===c&&ids.includes(s.examId)),seat=b.seats[index];
  if(seat)filled++;
  const label=seat?(tx([seat.name,seat.englishName])||'—'):T('空位','Empty');
  const examNote=seat&&active.length>1?' · '+sName(active.find(s=>s.id===seat.examId)):'';
  seats+=`<button type="button" class="seat${seat?' taken':''}" data-row="${r}" data-column="${c}"${seat?` data-index="${index}"`:''} title="${esc(`${T(`第 ${r} 排 · 第 ${c} 列`,`Row ${r}, column ${c}`)}${examNote}`)}"><strong>${esc(label)}</strong><span>${esc(seat?seat.className:`${r}-${c}`)}</span></button>`;
 }
 return `<div class="rooms-layout"><div class="room-list">${b.rooms.map((r,i)=>`<button type="button" data-room="${i}" aria-pressed="${r===room}"><strong>${esc(r.name)}</strong><small>${r.rows} × ${r.columns} · ${count(b.sessions.filter(s=>s.rooms.includes(r.name)).length,'场','sessions')}</small></button>`).join('')}<button type="button" class="btn btn-ghost" data-act="add-room" style="align-self:flex-start;margin-top:8px">+ ${T('新增教室','Add room')}</button></div>
 <div class="room-detail"><div class="head"><h4>${esc(room.name)}</h4><span class="muted" style="font-size:13px">${T(`${room.rows} 排 × ${room.columns} 列`,`${room.rows} rows × ${room.columns} columns`)}</span><button type="button" class="btn btn-ghost" data-act="edit-room" style="margin-left:auto;font-size:13px">${T('编辑教室','Edit room')}</button></div>
 ${exams.length?`<div class="chips">${exams.map(s=>`<button type="button" class="chip plain" data-room-exam="${esc(s.id)}" aria-pressed="${s===exam}">${esc(md(s.date))} ${s.start} · ${esc(sName(s))}${b.sessions.find(x=>x.id===s.id).cancelled?T('（已取消）',' (cancelled)'):''}</button>`).join('')}</div>
 ${times.length>1?`<div class="chips" aria-label="${T('查看时刻','View time')}"><span class="muted" style="font-size:12px;align-self:center">${T('查看时刻','View at')}</span>${times.map(t=>`<button type="button" class="chip plain" data-time="${t}" aria-pressed="${t===time}">${t}</button>`).join('')}</div>`:''}
 <div class="seat-scroll"><div class="seat-map"><div class="podium">${T('讲 台','FRONT')}</div><div class="seat-grid" id="seat-grid" style="grid-template-columns:repeat(${room.columns},92px)">${seats}</div></div></div>`
 :`<p class="muted" style="font-size:13px">${T('此教室暂无考试。请先在场次中分配此教室。','No sessions use this room yet. Assign it to a session first.')}</p>`}
 <div class="seat-foot"><span class="muted">${exam?T(`该时刻 ${filled} 人 · 点击座位编辑，拖动可换位 · 排从讲台向后，列从左到右`,`${filled} students · click a seat to edit, drag to move · rows run front to back, columns left to right`):''}</span>
 <a class="btn btn-secondary" href="/api/admin/exams/${encodeURIComponent(b.id)}/template" download>${T('下载 Excel 模板','Excel template')}</a><label class="btn btn-secondary file-btn">${T('导入 Excel','Import Excel')}<input type="file" accept=".xlsx" data-import="xlsx"></label><label class="btn btn-secondary file-btn" title="${T('将工作簿文字与布局发送到配置的 LLM Worker','Sends the workbook text and layout to the configured LLM Worker')}">${T('LLM 提取座位表','Extract seats with LLM')}<input type="file" accept=".xlsx" data-import="llm"></label></div></div></div>`;
}

function slotsTab(b){
 return `<div class="slot-list">${slotsOf(b).map(s=>`<div class="row"><span class="cell-main">${s.start}–${s.end}</span><span class="muted" style="font-size:13px">${count(b.sessions.filter(x=>x.start>=s.start&&x.start<s.end).length,'场','sessions')}</span></div>`).join('')}
 <p class="note">${T('按考试开始时间归入时间段；卡片保留实际起止时间。修改分组不会更改已有考试时间。','Sessions group by start time; cards keep their actual times. Changing slots never changes session times.')}</p><button type="button" class="btn btn-secondary" data-act="slots">${T('修改时间段','Edit time slots')}</button></div>`;
}

function onBatchClick(e,b){
 const t=e.target.closest('button');if(!t)return;
 const d=t.dataset;
 if(d.tab){view.tab=d.tab;rerender();$(`[data-tab=${d.tab}]`)?.focus();}
 else if(d.exam)examDialog(b.sessions.find(s=>s.id===d.exam));
 else if(d.room){view.room=Number(d.room);view.exam='';view.time='';rerender();}
 else if(d.roomExam){view.exam=d.roomExam;view.time='';rerender();}
 else if(d.time){view.time=d.time;rerender();}
 else if(d.row&&!t.dataset.dragged)seatDialog(b,Number(d.row),Number(d.column),d.index===undefined?-1:Number(d.index));
 else ({meta:()=>batchMetaDialog(b),delete:()=>deleteDialog(b),'pub-schedule':()=>publishDialog(b,false),'pub-seating':()=>publishDialog(b,true),extract:()=>extractDialog(b),'add-exam':()=>examDialog(null),'add-room':()=>roomDialog(-1),'edit-room':()=>roomDialog(b.rooms.indexOf(seatContext(b).room)),slots:()=>slotsDialog(b)})[d.act]?.();
}

/* Drag a taken seat onto another seat to move or swap it. */
function bindSeats(b){
 const grid=$('#seat-grid');if(!grid)return;
 const ctx=seatContext(b);
 $$('.seat.taken',grid).forEach(el=>{
  el.onpointerdown=event=>{
   if(event.button!==0)return;
   const x=event.clientX,y=event.clientY;let dragging=false,target=null;
   const move=e=>{
    if(!dragging&&Math.hypot(e.clientX-x,e.clientY-y)<6)return;
    dragging=true;el.classList.add('dragging');
    target?.classList.remove('drop');
    target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.seat');
    if(target&&!grid.contains(target))target=null;
    if(target!==el)target?.classList.add('drop');
   };
   const end=async cancelled=>{
    el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',cancel);
    el.classList.remove('dragging');target?.classList.remove('drop');
    if(!dragging||cancelled||!target||target===el)return;
    el.dataset.dragged='1';setTimeout(()=>delete el.dataset.dragged,0);
    try{
     const next=structuredClone(batch());
     if(!moveSeat(next,Number(el.dataset.index),Number(target.dataset.row),Number(target.dataset.column),ctx.ids))return;
     await commit(next,T('座位已调整并保存到草稿。','Seat moved and saved to draft.'));
    }catch(error){toast(error.message,{bad:true});}
   };
   const up=()=>end(false),cancel=()=>end(true);
   el.setPointerCapture(event.pointerId);el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',cancel);
  };
 });
}

/* — dialogs — */
const actions=({left='',saveLabel=T('保存到草稿','Save to draft')}={})=>`${errorLine}<div class="dialog-actions">${left}<button type="button" class="btn btn-secondary" data-close>${T('返回','Go back')}</button><button type="button" class="btn btn-primary" data-save>${saveLabel}</button></div>`;
const field=(label,input,cls='')=>`<div class="field${cls?' '+cls:''}"><label>${label}</label>${input}</div>`;
const input=(name,value,attrs='')=>`<input class="input" name="${name}" value="${esc(value??'')}" ${attrs}>`;
const values=body=>Object.fromEntries($$('[name]',body).map(el=>[el.name,el.value.trim()]));
/** A delete button that asks for a second click before acting. */
function confirmButton(body,selector,label,run){
 const button=body.querySelector(selector);if(!button)return;
 button.onclick=()=>{if(button.dataset.armed)return busy(body,run);button.dataset.armed='1';button.textContent=T('再次点击确认','Click again to confirm');};
 button.onblur=()=>{delete button.dataset.armed;button.textContent=label;};
}
function pickOne(body,attr,onPick){$$(`[data-${attr}]`,body).forEach(b=>b.onclick=()=>{$$(`[data-${attr}]`,body).forEach(x=>x.setAttribute('aria-pressed',String(x===b)));onPick(b.dataset[attr]);});}

function batchMetaDialog(b){
 let division=b?.division||'';
 const body=modal(b?T('批次信息','Batch info'):T('新建考试批次','New exam batch'),`
 ${field(T('名称 · 中文 *','Name · Chinese *'),input('title',b?.title,'maxlength="180"'))}${field(T('名称 · English（可选）','Name · English (optional)'),input('titleEn',b?.titleEn,'maxlength="180"'))}
 <div class="field"><span class="label">${T('学部（新增考试的默认值）','Division (default for new exams)')}</span>${segHtml('division',divisions.map(k=>[k,tx(SCOPES[k])]),division)}</div>
 <div class="two">${field(T('开始日期 *','Start date *'),input('start',b?.start,'type="date"'))}${field(T('结束日期 *','End date *'),input('end',b?.end,'type="date"'))}</div>
 ${field(T('学年起始年份（例如 2026 = 2026–2027）','Academic year start (e.g. 2026 = 2026–2027)'),input('academicYear',b?.academicYear,'type="number" min="2000" max="2199"'))}
 <p class="muted" style="font-size:12px">${T('学年用于按年级推算学生毕业年份和邮箱。','The academic year is used to derive graduation years and school emails from grades.')}</p>${actions({saveLabel:b?T('保存到草稿','Save to draft'):T('创建批次','Create batch')})}`,{size:'medium'});
 pickOne(body,'division',k=>division=k);
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  const v=values(body);
  if(!v.title)fail(T('请填写名称。','Enter a name.'));
  if(!v.start||!v.end||v.end<v.start)fail(T('结束日期不能早于开始日期。','End date must not precede start date.'));
  const meta={title:v.title,titleEn:v.titleEn,start:v.start,end:v.end,academicYear:v.academicYear?Number(v.academicYear):undefined,division:division||undefined};
  if(b){await update(next=>Object.assign(next,meta),draftMsg());closeModal();return;}
  const created=await api('/admin/exams',{method:'POST',body:JSON.stringify({...meta,timeSlots:defaultExamSlots,sessions:[],rooms:[],seats:[]})});
  created.publishedAt=null;created.seatingPublishedAt=null;replace(created);closeModal();go('exams/'+encodeURIComponent(created.id));
  toast(T('已新建草稿批次。','Draft batch created.'));
 });
}

function examDialog(s){
 const b=batch(),subjects=app.data.subjects;
 const current=s?.subject?subjectName(s,subjects):'';
 const options=subjects.map(x=>[x.name,x.english]);if(current&&!subjects.some(x=>x.name===current))options.push([current,s.subjectEn||'']);
 const d={subject:current,subjectEn:s?.subjectEn||subjects.find(x=>x.name===current)?.english||'',division:s?.division||b.division||'high',rooms:[...(s?.rooms||(b.rooms[0]?[b.rooms[0].name]:[]))],cancelled:Boolean(s?.cancelled)};
 const slot0=slotsOf(b)[0];
 const body=modal(s?T('编辑考试场次','Edit exam session'):T('新增考试场次','New exam session'),`<div class="dialog-grid">
 ${field(T('考试名称','Exam name'),input('title',s?.title,'maxlength="180"'),'span2')}${field(T('Level（可选）','Level (optional)'),input('level',s?.level,'maxlength="40" placeholder="HL / SL"'))}
 ${field(T('英文名称（可选）','English name (optional)'),input('titleEn',s?.titleEn,'maxlength="180"'),'all')}
 <div class="field all"><span class="label">${T('学科','Subject')}</span><div class="chips">${options.map(([name,english])=>`<button type="button" class="chip" data-subject="${esc(name)}" data-en="${esc(english)}" aria-pressed="${d.subject===name}">${esc(tx([name,english]))}</button>`).join('')}</div></div>
 <div class="field"><span class="label">${T('学部','Division')}</span>${segHtml('division',divisions.map(k=>[k,tx(SCOPES[k])]),d.division)}</div>
 ${field(T('适用年级（逗号分隔）*','Grades (comma-separated) *'),input('grades',s?.grades.join(', '),'placeholder="G10, G11"'))}${field(T('日期 *','Date *'),input('date',s?.date||b.start,`type="date" min="${b.start}" max="${b.end}"`))}
 <div class="field all"><span class="label">${T('时间 · 可套用时间段 *','Time · apply a slot *')}</span><div class="inline">${input('start',s?.start||slot0?.start,'type="time" style="width:120px"')}<span>–</span>${input('end',s?.end||slot0?.end,'type="time" style="width:120px"')}<span style="width:6px"></span>${slotsOf(b).map(x=>`<button type="button" class="btn btn-ghost" style="font-size:13px" data-slot="${x.start}-${x.end}">${x.start}–${x.end}</button>`).join('')}</div></div>
 <div class="field all"><span class="label">${T('教室（可多选）*','Rooms (select any) *')}</span>${b.rooms.length?`<div class="chips">${b.rooms.map(r=>`<button type="button" class="chip" data-room-pick="${esc(r.name)}" aria-pressed="${d.rooms.includes(r.name)}">${esc(r.name)}</button>`).join('')}</div>`:`<span class="muted" style="font-size:12px">${T('暂无教室，请先在“教室”页新增。','No rooms yet. Add one on the Rooms tab first.')}</span>`}</div>
 <div class="field all"><label>${T('说明','Description')}</label><textarea class="input" name="note" maxlength="1000" style="min-height:60px">${esc(s?.note)}</textarea></div>
 <button type="button" class="checkbox all" data-cancelled aria-pressed="${d.cancelled}" style="justify-self:start">${T('标记为已取消','Mark as cancelled')}</button></div>
 <p class="muted" style="font-size:12px">${s?T(`编号 ${s.id}。如需保留记录和个人勾选，可标记取消而非删除。`,`ID ${s.id}. To keep the record and students' selections, mark it cancelled instead of deleting.`):T('保存后分配编号。同学部、同年级、同科目、同一天及同时间段自动合并显示，各 Level 独立勾选。','An ID is assigned on save. Sessions with the same division, grade, subject, date and slot are shown merged; each Level is selected separately.')}</p>
 ${actions({left:s?`<button type="button" class="btn btn-ghost btn-danger left" data-del>${T('删除考试','Delete exam')}</button>`:''})}`,{size:'wide'});
 $$('[data-subject]',body).forEach(el=>el.onclick=()=>{const on=d.subject!==el.dataset.subject;d.subject=on?el.dataset.subject:'';d.subjectEn=on?el.dataset.en:'';$$('[data-subject]',body).forEach(x=>x.setAttribute('aria-pressed',String(on&&x===el)));});
 pickOne(body,'division',k=>d.division=k);
 $$('[data-slot]',body).forEach(el=>el.onclick=()=>{const [a,z]=el.dataset.slot.split('-');body.querySelector('[name=start]').value=a;body.querySelector('[name=end]').value=z;});
 $$('[data-room-pick]',body).forEach(el=>el.onclick=()=>{const name=el.dataset.roomPick,on=!d.rooms.includes(name);d.rooms=on?[...d.rooms,name]:d.rooms.filter(x=>x!==name);el.setAttribute('aria-pressed',String(on));});
 body.querySelector('[data-cancelled]').onclick=e=>{d.cancelled=!d.cancelled;e.currentTarget.setAttribute('aria-pressed',String(d.cancelled));};
 confirmButton(body,'[data-del]',T('删除考试','Delete exam'),async()=>{await update(next=>{next.sessions=next.sessions.filter(x=>x.id!==s.id);next.seats=next.seats.filter(x=>x.examId!==s.id);},T('已从草稿删除考试及其座位。','Exam and its seats removed from draft.'));closeModal();});
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  const v=values(body),grades=[...new Set(v.grades.split(/[,，]/).map(x=>x.trim()).filter(Boolean))];
  const title=v.title||[d.subject,v.level].filter(Boolean).join(' ');
  if(!title)fail(T('请填写考试名称或选择学科。','Enter an exam name or choose a subject.'));
  if(v.level&&!d.subject)fail(T('填写 Level 时请选择学科。','Choose a subject when setting a Level.'));
  if(!grades.length)fail(T('请填写适用年级。','Enter at least one grade.'));
  if(!v.date||v.date<b.start||v.date>b.end)fail(T('日期须在批次日期范围内。','The date must fall within the batch dates.'));
  if(!v.start||!v.end||v.end<=v.start)fail(T('结束时间必须晚于开始。','End must be later than start.'));
  if(!d.rooms.length)fail(T('请至少勾选一个教室。','Select at least one room.'));
  const session={id:s?.id||crypto.randomUUID(),title,titleEn:v.titleEn,subject:d.subject,subjectEn:d.subjectEn,level:v.level,division:d.division,grades,date:v.date,start:v.start,end:v.end,rooms:d.rooms,note:v.note,cancelled:d.cancelled};
  await update(next=>{
   if(s){next.sessions=next.sessions.map(x=>x.id===s.id?session:x);next.seats=next.seats.filter(x=>x.examId!==s.id||session.rooms.includes(x.room));}
   else next.sessions.push(session);
  },draftMsg());
  if(d.subject&&!app.data.subjects.some(x=>x.name===d.subject))await loadSubjects();
  closeModal();
 });
}

function roomDialog(index){
 const b=batch(),room=b.rooms[index];
 const body=modal(room?T('教室设置','Room settings'):T('新增教室','New room'),`<div style="display:grid;grid-template-columns:minmax(0,1fr) 96px 96px;gap:12px">
 ${field(T('教室名称','Room name'),input('name',room?.name,'maxlength="60"'))}${field(T('排数','Rows'),input('rows',room?.rows??5,'type="number" min="1" max="40"'))}${field(T('列数','Columns'),input('columns',room?.columns??6,'type="number" min="1" max="40"'))}</div>
 ${room?`<p class="muted" style="font-size:12px">${T('缩小教室会使超出范围的座位无法保存，请先调整座位。','Shrinking a room fails if seats fall outside it; move those seats first.')}</p>`:''}
 ${actions({left:room?`<button type="button" class="btn btn-ghost btn-danger left" data-del>${T('删除教室','Delete room')}</button>`:''})}`);
 confirmButton(body,'[data-del]',T('删除教室','Delete room'),async()=>{
  const only=b.sessions.filter(s=>s.rooms.length===1&&s.rooms[0]===room.name);
  if(only.length)fail(T(`该教室是 ${only.length} 场考试的唯一教室，请先为这些考试选择其他教室。`,`This is the only room for ${only.length} exam(s). Assign another room first.`));
  await update(next=>{next.rooms.splice(index,1);next.sessions.forEach(s=>s.rooms=s.rooms.filter(n=>n!==room.name));next.seats=next.seats.filter(s=>s.room!==room.name);},T('已从草稿删除教室及其座位。','Room and its seats removed from draft.'));
  view.room=0;closeModal();
 });
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  const v=values(body),rows=Number(v.rows),columns=Number(v.columns);
  if(!v.name||![rows,columns].every(n=>Number.isInteger(n)&&n>=1&&n<=40))fail(T('请输入有效名称和 1–40 的整数。','Enter a name and whole numbers from 1 to 40.'));
  if(b.rooms.some((r,i)=>r.name===v.name&&i!==index))fail(T('教室名称重复。','Room name already exists.'));
  const next={name:v.name,rows,columns};
  await update(n=>{
   if(!room){n.rooms.push(next);return;}
   n.rooms[index]=next;n.sessions.forEach(s=>s.rooms=s.rooms.map(x=>x===room.name?v.name:x));n.seats.forEach(s=>{if(s.room===room.name)s.room=v.name;});
  },draftMsg());
  if(!room){view.room=b.rooms.length;view.tab='rooms';rerender();}
  closeModal();
 });
}

function seatDialog(b,row,column,index){
 const ctx=seatContext(b),seat=b.seats[index];
 const body=modal(seat?T('编辑座位','Edit seat'):T('添加座位','Add seat'),`<p class="muted" style="font-size:13px">${esc(ctx.room.name)} · ${T(`第 ${row} 排 · 第 ${column} 列`,`Row ${row}, column ${column}`)}</p>
 ${ctx.active.length>1?field(T('考试（本教室当前时段）','Exam (this room, this time)'),`<select class="input" name="examId" style="width:100%">${ctx.active.map(s=>`<option value="${esc(s.id)}"${(seat?.examId||ctx.exam.id)===s.id?' selected':''}>${esc(sName(s))} ${s.start}–${s.end}</option>`).join('')}</select>`):''}
 <div class="two">${field(T('班级 *','Class *'),input('className',seat?.className,'maxlength="60" placeholder="11-1"'))}${field(T('年级（可留空推算）','Grade (optional)'),input('grade',seat?.grade,'type="number" min="1" max="12"'))}</div>
 <div class="two">${field(T('中文名','Chinese name'),input('name',seat?.name,'maxlength="80"'))}${field(T('英文名','English name'),input('englishName',seat?.englishName,'maxlength="120"'))}</div>
 ${actions({left:seat?`<button type="button" class="btn btn-ghost btn-danger left" data-del>${T('清空座位','Clear seat')}</button>`:''})}`);
 confirmButton(body,'[data-del]',T('清空座位','Clear seat'),async()=>{await update(next=>next.seats.splice(index,1),T('已在草稿中清空座位。','Seat cleared in draft.'));closeModal();});
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  const v=values(body);
  if(!v.className)fail(T('请填写班级。','Class is required.'));
  if(!v.name&&!v.englishName)fail(T('至少填写一种姓名。','Enter at least one name.'));
  const examId=v.examId||seat?.examId||ctx.exam.id;
  const same=seat&&seat.name===v.name&&seat.className===v.className;
  const value={...(seat||{}),examId,room:ctx.room.name,row,column,className:v.className,name:v.name,englishName:v.englishName,grade:v.grade?Number(v.grade):null,studentId:same?seat.studentId:undefined};
  await update(next=>{if(seat)next.seats[index]=value;else next.seats.push(value);},draftMsg());
  closeModal();
 });
}

function slotsDialog(b){
 const body=modal(T('修改时间段','Edit time slots'),`${field(T('每行一个时间段（最多 20 个），例如 08:10-09:40','One slot per line (up to 20), e.g. 08:10-09:40'),`<textarea class="input" name="slots" style="min-height:140px;font-family:ui-monospace,Menlo,monospace;font-size:13px">${esc(slotsOf(b).map(s=>s.start+'-'+s.end).join('\n'))}</textarea>`)}
 <p class="muted" style="font-size:12px">${T('按考试开始时间归入时间段；卡片保留实际起止时间。修改分组不会更改已有考试时间。','Sessions group by start time; cards keep their actual times. Changing slots never changes session times.')}</p>${actions()}`);
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  const invalid=T('每行一个时间段，例如 08:10-09:40；时间段不能重叠。','One slot per line, e.g. 08:10-09:40. Slots must not overlap.');
  const slots=values(body).slots.split(/\n+/).filter(Boolean).map(line=>{const m=line.trim().replace(/：/g,':').match(/^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})$/);if(!m)fail(invalid);return {start:m[1].padStart(5,'0'),end:m[2].padStart(5,'0')};}).sort((x,y)=>x.start.localeCompare(y.start));
  if(!slots.length||slots.length>20||slots.some((s,i)=>![s.start,s.end].every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t))||s.end<=s.start||(i>0&&s.start<slots[i-1].end)))fail(invalid);
  await update(next=>next.timeSlots=slots,draftMsg());closeModal();
 });
}

function subjectsDialog(){
 const render=()=>{
  const body=modal(T('管理学科','Subjects'),`<p class="muted" style="font-size:13px">${T('学科在所有批次共用，并出现在考试编辑器中；同一学科在学生端使用同一颜色。','Subjects are shared across batches and appear in the exam editor; each keeps one colour for students.')}</p>
  <div class="list-box subjects">${app.data.subjects.map((s,i)=>`<div><span style="font-size:14px">${esc(s.name)}</span><input class="input" data-english="${i}" value="${esc(s.english)}" maxlength="100" aria-label="${esc(s.name)} · English"></div>`).join('')}</div>
  <div class="subject-add">${field(T('新增学科','New subject'),input('name','','maxlength="100"'))}${field(T('英文名称（可选）','English name (optional)'),input('english','','maxlength="100"'))}<button type="button" class="btn btn-secondary" data-add style="height:36px">${T('添加','Add')}</button></div>
  ${errorLine}<div class="dialog-actions"><button type="button" class="btn btn-primary" data-close>${T('完成','Done')}</button></div>`,{size:'medium'});
  $$('[data-english]',body).forEach(el=>el.onchange=()=>busy(body,async()=>{const s=app.data.subjects[Number(el.dataset.english)];app.data.subjects=await api('/admin/exam-subjects',{method:'PUT',body:JSON.stringify({name:s.name,english:el.value.trim()})});toast(T('学科已更新。','Subject updated.'));}));
  body.querySelector('[data-add]').onclick=()=>busy(body,async()=>{const v=values(body);if(!v.name)fail(T('请输入学科名称。','Enter a subject name.'));app.data.subjects=await api('/admin/exam-subjects',{method:'POST',body:JSON.stringify(v)});render();});
 };
 render();
}

function publishDialog(b,seating){
 const rows=sorted(b.sessions);
 const body=modal(seating?T('座位表发布预览','Seating publish preview'):T('考试安排发布预览','Schedule publish preview'),seating
  ?`<p style="font-size:14px">${T(`共 ${b.sessions.length} 场考试、${b.rooms.length} 间教室、${b.seats.length} 个座位。发布前请在“教室”页逐间核对。`,`${b.sessions.length} sessions across ${b.rooms.length} rooms, ${b.seats.length} seats. Check each room on the Rooms tab before publishing.`)}</p>
   <div class="list-box rooms">${b.rooms.map(r=>`<div><span style="font-weight:500">${esc(r.name)}</span><span class="muted">${r.rows} × ${r.columns} · ${count(b.sessions.filter(s=>s.rooms.includes(r.name)).length,'场','sessions')} · ${count(b.seats.filter(s=>s.room===r.name).length,'座','seats')}</span></div>`).join('')}</div>`
  :`<div class="list-box publish">${rows.map(s=>`<div><span class="num">${esc(md(s.date))} · ${s.start}–${s.end}</span><span class="${s.cancelled?'struck':''}">${esc(sName(s))} · ${esc(s.grades.join(' / '))}</span><span>${esc(s.rooms.join(' / '))}</span></div>`).join('')||`<div class="muted">${T('暂无考试','No sessions')}</div>`}</div>`
 +`<p class="callout">${seating?T('使用学校 Microsoft 账号登录的学生可查看全部已发布座位表。','Students signed in with a school Microsoft account can view all published seating.'):T('时间、教室或取消状态发生变化时，已发布座位表将撤下，需核对后重新发布。','If times, rooms or cancellations change later, published seating is withdrawn and must be re-published.')}</p>
 ${actions({saveLabel:seating?T('确认发布座位表','Publish seating'):T('确认发布考试安排','Publish schedule')})}`,{size:'wide'});
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  const saved=await api(`/admin/exams/${encodeURIComponent(b.id)}/${seating?'publish-seats':'publish'}`,{method:'POST',body:JSON.stringify({version:batch().version})});
  replace(saved);closeModal();rerender();toast(seating?T('座位表发布成功。','Seating published.'):T('考试安排发布成功。','Schedule published.'));
 });
}

function deleteDialog(b){
 const body=modal(T('删除考试批次？','Delete exam batch?'),`<p class="dialog-text">${esc(T(`确定删除考试批次“${bTitle(b)}”？该批次的全部考试、座位数据和学生个人勾选将一并删除，已发布内容立即下架。此操作不可撤销。`,`Delete “${bTitle(b)}”? All its exams, seating data and students' selections are removed, and published content is taken down immediately. This cannot be undone.`))}</p>${actions({saveLabel:T('确认删除','Delete batch')})}`);
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  await api('/admin/exams/'+encodeURIComponent(b.id),{method:'DELETE',body:JSON.stringify({version:batch().version})});
  app.data.batches=app.data.batches.filter(x=>x.id!==b.id);refreshNav();closeModal();go('exams');toast(T('考试批次已删除。','Exam batch deleted.'));
 });
}

function extractDialog(b){
 let file=null;
 const body=modal(T('LLM 提取考试场次','Extract sessions with LLM'),`<label class="dropzone tall" data-drop><span data-file>${T('拖入考试日程表 PDF，或点击选择','Drop the exam timetable PDF, or click to choose')}</span><input type="file" accept=".pdf,application/pdf" aria-label="PDF"></label>
 <p class="muted" style="font-size:13px;line-height:1.7">${T('支持普通及扫描版 PDF（最多 20 MB、10 页）。页面内容将发送到配置的 LLM Worker，提取后可核对修改，不会自动保存或发布。','Text or scanned PDFs (up to 20 MB, 10 pages). Pages go to the configured LLM Worker; you review results before adding. Nothing is saved or published automatically.')}</p>
 <p class="alert" data-progress hidden></p>${actions({saveLabel:T('开始提取','Extract')})}`,{size:'medium'});
 const zone=body.querySelector('[data-drop]'),choose=f=>{file=f||null;body.querySelector('[data-file]').textContent=file?file.name:T('拖入考试日程表 PDF，或点击选择','Drop the exam timetable PDF, or click to choose');};
 zone.querySelector('input').onchange=e=>choose(e.target.files[0]);
 zone.ondragover=e=>{e.preventDefault();zone.classList.add('over');};zone.ondragleave=()=>zone.classList.remove('over');
 zone.ondrop=e=>{e.preventDefault();zone.classList.remove('over');choose(e.dataTransfer.files[0]);};
 const progress=message=>{const el=body.querySelector('[data-progress]');el.textContent=message;el.hidden=!message;};
 api('/admin/exam-extract').then(status=>{if(!status.configured){const el=body.querySelector('[data-error]');el.textContent=T('尚未配置 LLM_WORKER_URL 和 LLM_WORKER_TOKEN，请配置后重启服务。','LLM_WORKER_URL and LLM_WORKER_TOKEN are not configured. Configure them and restart the service.');el.hidden=false;}}).catch(()=>{});
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  if(!file)fail(T('请选择 PDF 文件。','Choose a PDF file.'));
  try{
   const pages=await readExamPdf(file,progress);
   progress(T('正在提取考试场次…','Extracting sessions…'));
   const result=await api('/admin/exam-extract',{method:'POST',body:JSON.stringify({...pages,start:b.start,end:b.end})});
   if(!body.isConnected||!body.closest('dialog').open)return;
   reviewExtracted(b,result);
  }finally{progress('');}
 });
}
function reviewExtracted(b,result){
 const rows=result.sessions;
 const cell=(i,name,value,attrs='')=>`<input class="input" name="${name}" data-i="${i}" value="${esc(value??'')}" aria-label="${name} ${i+1}" ${attrs}>`;
 const body=modal(T('核对提取结果','Review extracted sessions'),`<p style="font-size:14px">${T(`提取到 ${rows.length} 场考试。请核对日期、时间、学部、年级及教室；取消勾选可跳过某行。`,`Found ${rows.length} sessions. Check dates, times, divisions, grades and rooms; untick a row to skip it.`)}</p>
 ${result.warnings?.length?`<p class="callout">${result.warnings.map(esc).join('<br>')}</p>`:''}
 <div style="overflow:auto;max-height:55vh"><table class="review-table"><thead><tr><th>${T('加入','Add')}</th><th>${T('考试名称','Exam')}</th><th>${T('学科 / Level','Subject / Level')}</th><th>${T('学部 / 年级','Division / grades')}</th><th>${T('日期','Date')}</th><th>${T('开始 / 结束','Start / end')}</th><th>${T('教室（逗号分隔）','Rooms (comma-separated)')}</th></tr></thead><tbody>
 ${rows.map((s,i)=>`<tr data-row="${i}"><td><input type="checkbox" name="include" checked aria-label="${T(`加入第 ${i+1} 场`,`Add row ${i+1}`)}"></td><td>${cell(i,'title',s.title)}</td><td>${cell(i,'subject',s.subject)}${cell(i,'level',s.level)}</td><td><select class="input" name="division" aria-label="division ${i+1}"><option value="">${T('请选择','Choose')}</option>${divisions.map(k=>`<option value="${k}"${s.division===k?' selected':''}>${tx(SCOPES[k])}</option>`).join('')}</select>${cell(i,'grades',s.grades.join(','))}</td><td>${cell(i,'date',s.date,'type="date"')}</td><td>${cell(i,'start',s.start,'type="time"')}${cell(i,'end',s.end,'type="time"')}</td><td>${cell(i,'rooms',s.rooms.join(','))}</td></tr>`).join('')}</tbody></table></div>
 <p class="muted" style="font-size:12px">${T('仅追加选中场次。新教室会以 5 排 × 5 列加入草稿，可在教室设置中调整；不会生成学生座位数据。','Only ticked rows are added. New rooms are added as 5 × 5 and can be adjusted later; no seats are created.')}</p>
 ${actions({saveLabel:T('确认加入草稿','Add to draft')})}`,{size:'wide'});
 body.querySelector('[data-save]').disabled=!rows.length;
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  const picked=$$('tr[data-row]',body).filter(tr=>tr.querySelector('[name=include]').checked).map(tr=>{
   const item={...rows[Number(tr.dataset.row)]},get=name=>tr.querySelector(`[name=${name}]`).value.trim();
   for(const name of ['title','subject','level','division','date','start','end'])item[name]=get(name);
   for(const name of ['grades','rooms'])item[name]=[...new Set(get(name).split(/[,，]/).map(x=>x.trim()).filter(Boolean))];
   return item;
  });
  if(!picked.length)fail(T('请至少选择一场考试。','Select at least one session.'));
  const current=batch(),rooms=[...current.rooms];
  for(const name of new Set(picked.flatMap(s=>s.rooms)))if(!rooms.some(r=>r.name===name))rooms.push({name,rows:5,columns:5});
  const next={...structuredClone(current),rooms,sessions:[...current.sessions,...picked]};
  await api('/admin/exam-extract/validate',{method:'POST',body:JSON.stringify(payload(next))});
  await commit(next,T(`已加入 ${picked.length} 场考试。`,`Added ${picked.length} sessions.`));closeModal();
 });
}

async function importSeats(file,llm){
 const b=batch();if(!file)return;
 if(!/\.xlsx$/i.test(file.name))return toast(T('仅支持 .xlsx 文件。','Only .xlsx files are supported.'),{bad:true});
 if(file.size>2*1024*1024)return toast(T('Excel 文件最大 2 MB。','Excel files must be at most 2 MB.'),{bad:true});
 if(llm)toast(T('正在提取座位表…','Extracting seats…'));
 try{
  const result=await api(`/admin/exams/${encodeURIComponent(b.id)}/${llm?'seat-extract':'import-preview'}`,{method:'POST',body:file,headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name),'X-Draft-Version':String(b.version)}});
  $('#toast').hidden=true;
  $('#close-preview').setAttribute('aria-label',T('关闭','Close'));
  importPreview(result,{title:llm?T('LLM 座位表提取预览','LLM seat extraction preview'):T('Excel 导入预览','Excel import preview'),batch:b,accept:seats=>{
   if(batch().version!==b.version)throw new Error(T('草稿已修改，请重新导入。','The draft changed; import again.'));
   $('#preview-dialog').close();
   update(next=>next.seats=seats,T(`已导入 ${seats.length} 个座位到草稿。`,`Imported ${seats.length} seats into the draft.`)).catch(error=>toast(error.message,{bad:true}));
  }});
 }catch(error){toast(error.message,{bad:true});}
}
