import {$,$$,esc,corners,icon,app,T,tx,SCOPES,api,toast,modal,closeModal,busy,errorLine,fail,go,refreshNav,md,mdw,stamp,loadBatches,loadSubjects,loadJobs} from './console-core.js';
import {adaptRooms,chooseStudent,examMode,examsLabel,mergeSeats,moveSeat,placed,roomExamsAt,seatExamIds,seatViewTimes,withoutExam} from './exam-seats.mjs';
import {subjectName} from './exam-subjects.mjs';
import {defaultExamSlots,slotOf} from './exam-times.mjs';
import {importPreview,studentOptions,unresolved} from './exam-import-preview.js';
import {readExamPdf} from './exam-pdf-input.js';
import {DIVISION_GRADES,gradeLabel,parseGrade} from './grades.mjs';
import {followJob,reviewView,pagePane,sheetPane} from './ai-review.js';

const view={id:'',tab:'sessions',room:0,exam:'',time:''};
/** 批量删除: the seat indexes picked while bulk deleting, or null outside selection mode. */
let picking=null;
const divisions=['primary','middle','high'];
const batch=()=>app.data.batches.find(b=>b.id===view.id);
const bTitle=b=>app.lang?(b.titleEn||b.title):b.title;
const bDivision=b=>b.division?tx(SCOPES[b.division]):[...new Set(b.sessions.map(s=>s.division))].map(d=>tx(SCOPES[d])).join(' / ')||'—';
const sName=s=>{const name=app.lang?(s.titleEn||s.title):s.title;return name+(s.level&&!name.includes(s.level)?' '+s.level:'');};
/** A seat's exam, or its candidate exams joined ("Chinese B / Honor") when the sheet left it undecided. */
const seatExamName=(b,seat)=>examsLabel(seatExamIds(seat).map(id=>{const exam=b.sessions.find(s=>s.id===id);return exam?sName(exam):id;}));
const sorted=sessions=>[...sessions].sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start)||a.title.localeCompare(b.title));
const slotsOf=b=>b.timeSlots||defaultExamSlots;
const pubTag=on=>on?'tag tag-accent':'tag tag-outline';
const count=(n,zh,en)=>T(`${n} ${zh}`,`${n} ${en}`);
const segHtml=(attr,items,value)=>`<div class="seg full">${items.map(([k,label])=>`<button type="button" data-${attr}="${k}" aria-pressed="${value===k}">${label}</button>`).join('')}</div>`;
let rerender=()=>{};

async function ensureData(main){
 if(app.data.batches&&app.data.subjects)return;
 main.innerHTML=`<p class="loading">${T('正在加载考试…','Loading exams…')}</p>`;
 await Promise.all([app.data.batches||loadBatches(),app.data.subjects||loadSubjects(),app.data.jobs||loadJobs()]);
}

/* — batch list — */
export async function showExams(main){
 await ensureData(main);
 rerender=()=>showExams(main);
 const batches=[...app.data.batches].sort((a,b)=>b.start.localeCompare(a.start));
 main.innerHTML=`<div class="page">
 <header class="page-head"><div><div class="kicker">${T('管理后台','Admin console')}</div><h1>${T('考试','Exams')}</h1><p class="sub">${T('按批次管理场次、教室与座位；考试安排与座位表分别发布。','Manage sessions, rooms and seats by batch; schedule and seating publish separately.')}</p></div>
 <div class="page-actions">${app.user.role===3?`<a class="btn btn-secondary" href="#students">${T('学生管理','Students')}</a>`:''}<button type="button" class="btn btn-secondary" data-act="subjects">${T('管理学科','Subjects')}</button><button type="button" class="btn btn-primary blueprint" data-act="new">${corners}${icon.plus}${T('新建考试批次','New batch')}</button></div></header>
 <div class="grid-scroll"><div class="batches-grid"><div class="grid-head"><span>${T('批次','Batch')}</span><span>${T('日期','Date')}</span><span>${T('场次','Sessions')}</span><span>${T('考试安排','Schedule')}</span><span>${T('座位表','Seating')}</span></div>
 ${batches.map(b=>`<button type="button" class="grid-row" data-open="${esc(b.id)}"><div class="clip"><div class="cell-main clip">${esc(bTitle(b))}</div><div class="cell-sub">${esc(bDivision(b))}${jobTag(jobOf(b))}</div></div><span class="num" style="font-size:13px">${b.start.slice(0,4)} · ${esc(md(b.start))} – ${esc(md(b.end))}</span><span class="num" style="font-size:13px">${b.sessions.length}</span>
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
${jobStrip(jobOf(b))}
 <div class="tabs" role="tablist">${tabs.map(([k,label,n])=>`<button type="button" role="tab" data-tab="${k}" aria-selected="${view.tab===k}">${label}<span class="count">${n}</span></button>`).join('')}</div>
 <div id="batch-tab">${view.tab==='sessions'?sessionsTab(b):view.tab==='rooms'?roomsTab(b):slotsTab(b)}</div></div>`;
 const page=main.querySelector('.page');
 page.onclick=e=>onBatchClick(e,b);
 if(view.tab==='rooms')bindSeats(b);
 $$('[data-import]').forEach(input=>input.onchange=()=>{importSeats(input.files[0]);input.value='';});
 watchJob(b);
}

function sessionsTab(b){
 const rows=sorted(b.sessions);
 return `<div class="tab-actions"><button type="button" class="btn btn-secondary" data-act="extract">${T('从 PDF 提取','Extract from PDF')}</button><button type="button" class="btn btn-secondary" data-act="add-exam">+ ${T('新增考试','Add exam')}</button></div>
 ${rows.length?`<div class="grid-scroll"><div class="sessions-grid"><div class="grid-head"><span>${T('日期','Date')}</span><span>${T('考试','Exam')}</span><span>${T('学部 / 年级','Division / grade')}</span><span>${T('教室','Rooms')}</span><span>${T('状态','Status')}</span><span></span></div>
 ${rows.map(s=>`<div class="grid-row"><div class="num"><div class="cell-main">${esc(mdw(s.date))}</div><div class="cell-sub">${s.start}–${s.end}</div></div><div class="cell-main${s.cancelled?' struck':''}">${esc(sName(s))}</div><span style="font-size:13px">${esc(tx(SCOPES[s.division]))} · ${esc(s.grades.map(g=>gradeLabel(g,app.lang)).join(' / '))}${s.gradesUnverified?` <span class="tag tag-outline small">${T('年级待核实','Check grades')}</span>`:''}</span><span style="font-size:13px">${esc(s.rooms.join(' / '))}</span><span>${s.cancelled?`<span class="tag tag-outline">${T('已取消','Cancelled')}</span>`:''}</span><button type="button" class="btn btn-ghost" style="justify-self:end" data-exam="${esc(s.id)}">${T('编辑','Edit')}</button></div>`).join('')}</div></div>`
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
 // Exams sharing the room at this moment share one mode; 不排序座位 lists the room's students instead of a grid.
 const unordered=active.some(s=>examMode(b.seats,s.id)==='unordered');
 return {room,exams,exam,times,time,active,ids:active.map(s=>s.id),unordered};
}
const sizeTag=()=>`<span class="tag tag-outline small">${T('尺寸待确认','Check size')}</span>`;
const roomChangeNotes=changes=>(changes||[]).map(c=>T(`教室 ${c.name} 已从 ${c.from.rows}×${c.from.columns} 调整为 ${c.to.rows}×${c.to.columns}，导入后需在教室设置中人工确认。`,`Room ${c.name} grows from ${c.from.rows}×${c.from.columns} to ${c.to.rows}×${c.to.columns}; confirm its size in the room settings after importing.`));
function roomsTab(b){
 const ctx=seatContext(b);
 if(!ctx)return `<div class="empty"><p style="font-size:14px">${T('暂无教室，请先新增教室。','No rooms yet. Add a room first.')}</p><button type="button" class="btn btn-secondary" data-act="add-room">+ ${T('新增教室','Add room')}</button></div>`;
 const {room,exams,exam,times,time,active,ids,unordered}=ctx;
 let seats='',filled=0;
 for(let r=1;r<=room.rows;r++)for(let c=1;c<=room.columns;c++){
  const index=b.seats.findIndex(s=>s.room===room.name&&s.row===r&&s.column===c&&seatExamIds(s).some(id=>ids.includes(id))),seat=b.seats[index];
  if(seat)filled++;
  const label=seat?(tx([seat.name,seat.englishName])||'—'):T('空位','Empty');
  const examNote=seat&&(active.length>1||seat.examIds)?' · '+seatExamName(b,seat):'';
  seats+=`<button type="button" class="seat${seat?' taken':''}${seat?.candidates?.length&&!seat.studentId?' unidentified':''}${seat&&picking?.has(index)?' picked':''}" data-row="${r}" data-column="${c}"${seat?` data-index="${index}"`:''} title="${esc(`${T(`第 ${r} 排 · 第 ${c} 列`,`Row ${r}, column ${c}`)}${examNote}`)}"><strong>${esc(label)}</strong><span>${esc(seat?seat.className:`${r}-${c}`)}</span></button>`;
 }
 return `<div class="rooms-layout"><div class="room-list">${b.rooms.map((r,i)=>`<button type="button" data-room="${i}" aria-pressed="${r===room}"><strong>${esc(r.name)}</strong><small>${r.rows} × ${r.columns} · ${count(b.sessions.filter(s=>s.rooms.includes(r.name)).length,'场','sessions')}</small>${r.sizeReview?sizeTag():''}</button>`).join('')}<button type="button" class="btn btn-ghost" data-act="add-room" style="align-self:flex-start;margin-top:8px">+ ${T('新增教室','Add room')}</button></div>
 <div class="room-detail"><div class="head"><h4>${esc(room.name)}</h4><span class="muted" style="font-size:13px">${T(`${room.rows} 排 × ${room.columns} 列`,`${room.rows} rows × ${room.columns} columns`)}</span>${room.sizeReview?`${sizeTag()}<button type="button" class="btn btn-secondary" data-act="confirm-room" style="font-size:13px" title="${T('尺寸由座位表自动扩大，请核对排数和列数与实际教室一致','The size was grown to fit the seating sheet; check the rows and columns match the real room')}">${T('确认尺寸','Confirm size')}</button>`:''}<button type="button" class="btn btn-ghost" data-act="edit-room" style="margin-left:auto;font-size:13px">${T('编辑教室','Edit room')}</button></div>
 ${exams.length?`<div class="chips">${exams.map(s=>`<button type="button" class="chip plain" data-room-exam="${esc(s.id)}" aria-pressed="${s===exam}">${esc(md(s.date))} ${s.start} · ${esc(sName(s))}${b.sessions.find(x=>x.id===s.id).cancelled?T('（已取消）',' (cancelled)'):''}</button>`).join('')}</div>
 ${times.length>1?`<div class="chips" aria-label="${T('查看时刻','View time')}"><span class="muted" style="font-size:12px;align-self:center">${T('查看时刻','View at')}</span>${times.map(t=>`<button type="button" class="chip plain" data-time="${t}" aria-pressed="${t===time}">${t}</button>`).join('')}</div>`:''}
 ${unordered?rosterList(b,ctx):`<div class="seat-scroll"><div class="seat-map"><div class="podium">${T('讲 台','FRONT')}</div><div class="seat-grid${picking?' picking':''}" id="seat-grid" style="grid-template-columns:repeat(${room.columns},92px)">${seats}</div></div></div>`}`
 :`<p class="muted" style="font-size:13px">${T('此教室暂无考试。请先在场次中分配此教室。','No sessions use this room yet. Assign it to a session first.')}</p>`}
 <div class="seat-foot">${picking
  ?`<span class="muted">${T(`已选 ${picking.size} 人 · 点击${unordered?'行':'座位'}选择或取消`,`${picking.size} selected · click ${unordered?'a row':'a seat'} to select or unselect`)}</span><button type="button" class="btn btn-secondary" data-act="pick-cancel">${T('取消','Cancel')}</button><button type="button" class="btn btn-primary" data-act="pick-delete"${picking.size?'':' disabled'}>${T(`删除所选（${picking.size}）`,`Delete selected (${picking.size})`)}</button>`
  :`<span class="muted">${!exam?'':unordered?T(`该时刻 ${roster(b,ctx).length} 人 · 不排序座位 · 点击学生编辑`,`${roster(b,ctx).length} students · unordered seating · click a student to edit`):T(`该时刻 ${filled} 人 · 点击座位编辑，拖动可换位 · 排从讲台向后，列从左到右`,`${filled} students · click a seat to edit, drag to move · rows run front to back, columns left to right`)}</span>
 ${exam&&unordered?`<button type="button" class="btn btn-secondary" data-act="add-student">+ ${T('添加学生','Add student')}</button>`:''}${exam?`<button type="button" class="btn btn-secondary" data-act="pick">${T('批量删除','Bulk delete')}</button><button type="button" class="btn btn-ghost btn-danger" data-act="clear-exam">${T('清空本场座位','Clear this exam\'s seats')}</button>`:''}
 <a class="btn btn-secondary" href="/api/admin/exams/${encodeURIComponent(b.id)}/template" download>${T('下载 Excel 模板','Excel template')}</a><label class="btn btn-secondary file-btn">${T('导入 Excel','Import Excel')}<input type="file" accept=".xlsx" data-import="xlsx"></label><button type="button" class="btn btn-secondary" data-act="extract-seats" title="${T('将工作簿文字与布局发送到配置的 LLM Worker','Sends the workbook text and layout to the configured LLM Worker')}">${T('LLM 提取座位表','Extract seats with LLM')}</button>`}</div></div></div>`;
}
/** The indexes of the seats listed in the room at this moment, in seating-sheet order (不排序座位). */
const roster=(b,ctx)=>b.seats.flatMap((s,i)=>s.room===ctx.room.name&&seatExamIds(s).some(id=>ctx.ids.includes(id))?[i]:[]);
function rosterList(b,ctx){
 const list=roster(b,ctx),several=ctx.active.length>1,all=picking&&list.length&&list.every(i=>picking.has(i));
 const check=(on,attr)=>`<button type="button" class="checkbox" ${attr} aria-pressed="${!!on}" aria-label="${T('选择','Select')}"></button>`;
 return `<div class="roster-list${picking?' picking':''}"><div class="roster-head">${picking?check(all,'data-pick-all'):''}<span>${T('班级','Class')}</span><span>${T('中文名','Chinese name')}</span><span>${T('英文名','English name')}</span>${several?`<span>${T('考试','Exam')}</span>`:''}</div>
 ${list.map(i=>{const s=b.seats[i];return `<button type="button" class="roster-row${s.candidates?.length&&!s.studentId?' unidentified':''}${picking?.has(i)?' picked':''}" data-student="${i}">${picking?`<span class="checkbox" aria-hidden="true" aria-pressed="${picking.has(i)}"></span>`:''}<span>${esc(s.className)}</span><span>${esc(s.name)}</span><span>${esc(s.englishName)}</span>${several?`<span class="muted">${esc(seatExamName(b,s))}</span>`:''}</button>`;}).join('')||`<p class="muted" style="font-size:13px;padding:10px 0">${T('本考场暂无学生。','No students in this room yet.')}</p>`}</div>`;
}

function slotsTab(b){
 return `<div class="slot-list">${slotsOf(b).map((s,i)=>`<div class="row"><span class="cell-main">${s.start}–${s.end}</span><span class="muted" style="font-size:13px">${count(b.sessions.filter(x=>slotOf(slotsOf(b),x)?.index===i).length,'场','sessions')}</span></div>`).join('')}
 <p class="note">${T('按考试开始时间归入时间段；提前开考的考试归入与之重叠的时间段，时间标红。卡片保留实际起止时间，修改分组不会更改已有考试时间。','Sessions group by start time; a session that starts early joins the slot it runs into, with its time in red. Cards keep their actual times, and changing slots never changes session times.')}</p><button type="button" class="btn btn-secondary" data-act="slots">${T('修改时间段','Edit time slots')}</button></div>`;
}

function onBatchClick(e,b){
 const t=e.target.closest('button');if(!t)return;
 const d=t.dataset;
 if(d.jobAct)jobAction(jobOf(b),d.jobAct);
 else if(d.tab){view.tab=d.tab;picking=null;rerender();$(`[data-tab=${d.tab}]`)?.focus();}
 else if(d.exam)examDialog(b.sessions.find(s=>s.id===d.exam));
 else if(d.room){view.room=Number(d.room);view.exam='';view.time='';picking=null;rerender();}
 else if(d.roomExam){view.exam=d.roomExam;view.time='';picking=null;rerender();}
 else if(d.time){view.time=d.time;picking=null;rerender();}
 else if(picking&&(d.index!==undefined||d.student!==undefined)){const i=Number(d.index??d.student);if(!picking.delete(i))picking.add(i);rerender();}
 else if(picking&&t.hasAttribute('data-pick-all')){const list=roster(b,seatContext(b)),all=list.every(i=>picking.has(i));list.forEach(i=>all?picking.delete(i):picking.add(i));rerender();}
 else if(picking&&d.row){}
 else if(d.student!==undefined)seatDialog(b,null,null,Number(d.student));
 else if(d.row&&!t.dataset.dragged)seatDialog(b,Number(d.row),Number(d.column),d.index===undefined?-1:Number(d.index));
 else ({meta:()=>batchMetaDialog(b),delete:()=>deleteDialog(b),'pub-schedule':()=>publishDialog(b,false),'pub-seating':()=>publishDialog(b,true),extract:()=>extractDialog(b),'extract-seats':()=>seatExtractDialog(b),'add-student':()=>seatDialog(b,null,null,-1),pick:()=>{picking=new Set();rerender();},'pick-cancel':()=>{picking=null;rerender();},'pick-delete':()=>pickDeleteDialog(b),'clear-exam':()=>clearExamDialog(b),'add-exam':()=>examDialog(null),'add-room':()=>roomDialog(-1),'edit-room':()=>roomDialog(b.rooms.indexOf(seatContext(b).room)),'confirm-room':()=>{const name=seatContext(b).room.name;update(next=>{const room=next.rooms.find(r=>r.name===name);if(room)delete room.sizeReview;},T(`已确认教室 ${name} 的尺寸。`,`Confirmed the size of room ${name}.`)).catch(error=>toast(error.message,{bad:true}));},slots:()=>slotsDialog(b)})[d.act]?.();
}

/* Drag a taken seat onto another seat to move or swap it. */
function bindSeats(b){
 const grid=$('#seat-grid');if(!grid||picking)return;
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
 // A new session covers the whole division until grades are unticked.
 d.grades=s?.grades?.length&&!s.gradesUnverified?[...s.grades]:[...DIVISION_GRADES[d.division]];
 const gradeChips=()=>DIVISION_GRADES[d.division].map(g=>`<button type="button" class="chip plain" data-grade-pick="${g}" aria-pressed="${d.grades.includes(g)}">${gradeLabel(g,app.lang)}</button>`).join('');
 const slot0=slotsOf(b)[0];
 const body=modal(s?T('编辑考试场次','Edit exam session'):T('新增考试场次','New exam session'),`<div class="dialog-grid">
 ${field(T('考试名称','Exam name'),input('title',s?.title,'maxlength="180"'),'span2')}${field(T('Level（可选）','Level (optional)'),input('level',s?.level,'maxlength="40" placeholder="HL / SL"'))}
 ${field(T('英文名称（可选）','English name (optional)'),input('titleEn',s?.titleEn,'maxlength="180"'),'all')}
 <div class="field all"><span class="label">${T('学科','Subject')}</span><div class="chips">${options.map(([name,english])=>`<button type="button" class="chip" data-subject="${esc(name)}" data-en="${esc(english)}" aria-pressed="${d.subject===name}">${esc(tx([name,english]))}</button>`).join('')}</div></div>
 <div class="field"><span class="label">${T('学部','Division')}</span>${segHtml('division',divisions.map(k=>[k,tx(SCOPES[k])]),d.division)}</div>
 <div class="field"><span class="label">${T('适用年级 *','Grades *')}${s?.gradesUnverified?` <span class="tag tag-outline small">${T('原年级无法识别，请核实','Check: original grades unreadable')}</span>`:''}</span><div class="chips" id="grade-picks">${gradeChips()}</div></div>${field(T('日期 *','Date *'),input('date',s?.date||b.start,`type="date" min="${b.start}" max="${b.end}"`))}
 <div class="field all"><span class="label">${T('时间 · 可套用时间段 *','Time · apply a slot *')}</span><div class="inline">${input('start',s?.start||slot0?.start,'type="time" style="width:120px"')}<span>–</span>${input('end',s?.end||slot0?.end,'type="time" style="width:120px"')}<span style="width:6px"></span>${slotsOf(b).map(x=>`<button type="button" class="btn btn-ghost" style="font-size:13px" data-slot="${x.start}-${x.end}">${x.start}–${x.end}</button>`).join('')}</div></div>
 <div class="field all"><span class="label">${T('教室（可多选）*','Rooms (select any) *')}</span>${b.rooms.length?`<div class="chips">${b.rooms.map(r=>`<button type="button" class="chip" data-room-pick="${esc(r.name)}" aria-pressed="${d.rooms.includes(r.name)}">${esc(r.name)}</button>`).join('')}</div>`:`<span class="muted" style="font-size:12px">${T('暂无教室，请先在“教室”页新增。','No rooms yet. Add one on the Rooms tab first.')}</span>`}</div>
 <div class="field all"><label>${T('说明','Description')}</label><textarea class="input" name="note" maxlength="1000" style="min-height:60px">${esc(s?.note)}</textarea></div>
 <button type="button" class="checkbox all" data-cancelled aria-pressed="${d.cancelled}" style="justify-self:start">${T('标记为已取消','Mark as cancelled')}</button></div>
 <p class="muted" style="font-size:12px">${s?T(`编号 ${s.id}。如需保留记录和个人勾选，可标记取消而非删除。`,`ID ${s.id}. To keep the record and students' selections, mark it cancelled instead of deleting.`):T('保存后分配编号。同学部、同年级、同科目、同一天及同时间段自动合并显示，各 Level 独立勾选。','An ID is assigned on save. Sessions with the same division, grade, subject, date and slot are shown merged; each Level is selected separately.')}</p>
 ${actions({left:s?`<button type="button" class="btn btn-ghost btn-danger left" data-del>${T('删除考试','Delete exam')}</button>`:''})}`,{size:'wide'});
 $$('[data-subject]',body).forEach(el=>el.onclick=()=>{const on=d.subject!==el.dataset.subject;d.subject=on?el.dataset.subject:'';d.subjectEn=on?el.dataset.en:'';$$('[data-subject]',body).forEach(x=>x.setAttribute('aria-pressed',String(on&&x===el)));});
 const bindGrades=()=>$$('[data-grade-pick]',body).forEach(el=>el.onclick=()=>{const g=Number(el.dataset.gradePick),on=!d.grades.includes(g);d.grades=on?[...d.grades,g].sort((a,z)=>a-z):d.grades.filter(x=>x!==g);el.setAttribute('aria-pressed',String(on));});
 bindGrades();
 pickOne(body,'division',k=>{d.division=k;d.grades=[...DIVISION_GRADES[k]];body.querySelector('#grade-picks').innerHTML=gradeChips();bindGrades();});
 $$('[data-slot]',body).forEach(el=>el.onclick=()=>{const [a,z]=el.dataset.slot.split('-');body.querySelector('[name=start]').value=a;body.querySelector('[name=end]').value=z;});
 $$('[data-room-pick]',body).forEach(el=>el.onclick=()=>{const name=el.dataset.roomPick,on=!d.rooms.includes(name);d.rooms=on?[...d.rooms,name]:d.rooms.filter(x=>x!==name);el.setAttribute('aria-pressed',String(on));});
 body.querySelector('[data-cancelled]').onclick=e=>{d.cancelled=!d.cancelled;e.currentTarget.setAttribute('aria-pressed',String(d.cancelled));};
 confirmButton(body,'[data-del]',T('删除考试','Delete exam'),async()=>{await update(next=>{next.sessions=next.sessions.filter(x=>x.id!==s.id);next.seats=next.seats.map(x=>withoutExam(x,s.id)).filter(Boolean);},T('已从草稿删除考试及其座位。','Exam and its seats removed from draft.'));closeModal();});
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  const v=values(body),grades=d.grades.filter(g=>DIVISION_GRADES[d.division].includes(g));
  const title=v.title||[d.subject,v.level].filter(Boolean).join(' ');
  if(!title)fail(T('请填写考试名称或选择学科。','Enter an exam name or choose a subject.'));
  if(v.level&&!d.subject)fail(T('填写 Level 时请选择学科。','Choose a subject when setting a Level.'));
  if(!grades.length)fail(T('请至少勾选一个年级。','Select at least one grade.'));
  if(!v.date||v.date<b.start||v.date>b.end)fail(T('日期须在批次日期范围内。','The date must fall within the batch dates.'));
  if(!v.start||!v.end||v.end<=v.start)fail(T('结束时间必须晚于开始。','End must be later than start.'));
  if(!d.rooms.length)fail(T('请至少勾选一个教室。','Select at least one room.'));
  const session={id:s?.id||crypto.randomUUID(),title,titleEn:v.titleEn,subject:d.subject,subjectEn:d.subjectEn,level:v.level,division:d.division,grades,date:v.date,start:v.start,end:v.end,rooms:d.rooms,note:v.note,cancelled:d.cancelled};
  await update(next=>{
   if(s){next.sessions=next.sessions.map(x=>x.id===s.id?session:x);next.seats=next.seats.map(x=>session.rooms.includes(x.room)?x:withoutExam(x,s.id)).filter(Boolean);}
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

/** Edits or adds a seat; a null row and column is a student of 不排序座位, listed in the room without a position. */
function seatDialog(b,row,column,index){
 const ctx=seatContext(b),seat=b.seats[index],unordered=row==null,noun=unordered?T('学生','student'):T('座位','seat');
 // "Undecided" keeps the seat under all the exams it may belong to (the sheet's own candidates, else every exam here now).
 const undecided=seat?.examIds||ctx.active.map(s=>s.id),undecidedName=seatExamName(b,{examId:undecided[0],examIds:undecided});
 const body=modal(unordered?(seat?T('编辑学生','Edit student'):T('添加学生','Add student')):seat?T('编辑座位','Edit seat'):T('添加座位','Add seat'),`<p class="muted" style="font-size:13px">${esc(ctx.room.name)}${unordered?T(' · 不排序座位',' · unordered seating'):' · '+T(`第 ${row} 排 · 第 ${column} 列`,`Row ${row}, column ${column}`)}</p>
 ${ctx.active.length>1?field(T('考试（本教室当前时段）','Exam (this room, this time)'),`<select class="input" name="examId" style="width:100%">${ctx.active.map(s=>`<option value="${esc(s.id)}"${!seat?.examIds&&(seat?.examId||ctx.exam.id)===s.id?' selected':''}>${esc(sName(s))} ${s.start}–${s.end}</option>`).join('')}<option value="*"${seat?.examIds?' selected':''}>${esc(T(`待定：${undecidedName}`,`Undecided: ${undecidedName}`))}</option></select>`):''}
 <div class="two">${field(T('班级 *','Class *'),input('className',seat?.className,'maxlength="60" placeholder="11-1"'))}${field(T('年级（可留空推算）','Grade (optional)'),input('grade',seat?.grade,'type="number" min="1" max="12"'))}</div>
 <div class="two">${field(T('中文名','Chinese name'),input('name',seat?.name,'maxlength="80"'))}${field(T('英文名','English name'),input('englishName',seat?.englishName,'maxlength="120"'))}</div>
 ${seat?.candidates?.length?field(T('学生（同名，请选择）','Student (namesakes, choose one)'),`<select class="input" name="student" style="width:100%">${studentOptions(seat,T)}</select>`):''}
 ${actions({left:seat?`<button type="button" class="btn btn-ghost btn-danger left" data-del>${unordered?T('移除学生','Remove student'):T('清空座位','Clear seat')}</button>`:''})}`);
 confirmButton(body,'[data-del]',unordered?T('移除学生','Remove student'):T('清空座位','Clear seat'),async()=>{await update(next=>next.seats.splice(index,1),T(`已在草稿中移除${noun}。`,`The ${noun} was removed in the draft.`));closeModal();});
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  const v=values(body);
  if(!v.className)fail(T('请填写班级。','Class is required.'));
  if(!v.name&&!v.englishName)fail(T('至少填写一种姓名。','Enter at least one name.'));
  const examIds=v.examId==='*'?undecided:null,examId=examIds?examIds[0]:v.examId||seat?.examId||ctx.exam.id;
  const same=seat&&seat.name===v.name&&seat.className===v.className;
  const {examIds:_,row:_row,column:_column,...kept}=seat||{};
  const value={...kept,...(examIds?{examIds}:{}),examId,room:ctx.room.name,...(unordered?{}:{row,column}),className:v.className,name:v.name,englishName:v.englishName,grade:v.grade?Number(v.grade):null,studentId:same?seat.studentId:undefined};
  // The choice only applies to the person it was offered for; a changed name or class is matched again.
  const chosen=seat?.candidates?.length&&same&&seat.englishName===v.englishName;
  await update(next=>{if(seat){next.seats[index]=value;if(chosen)next.seats=chooseStudent(next.seats,index,v.student);}else next.seats.push(value);},draftMsg());
  closeModal();
 });
}

/** 批量删除: removes the picked seats of this room and moment. */
function pickDeleteDialog(b){
 const ctx=seatContext(b),chosen=[...picking].filter(i=>b.seats[i]),unordered=ctx.unordered;
 const names=chosen.map(i=>b.seats[i]).map(s=>[s.className,s.name,s.englishName].filter(Boolean).join(' '));
 const body=modal(T('删除所选？','Delete the selected?'),`<p class="dialog-text">${T(`将从草稿删除 ${ctx.room.name} 的 ${chosen.length} 个${unordered?'学生':'座位'}：`,`This removes ${chosen.length} ${unordered?'students':'seats'} of ${ctx.room.name} from the draft:`)}</p><p class="muted" style="font-size:13px">${esc(names.slice(0,30).join('、'))}${names.length>30?T(` 等 ${names.length} 人`,` and ${names.length-30} more`):''}</p>${actions({saveLabel:T(`删除 ${chosen.length} 个`,`Delete ${chosen.length}`)})}`);
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  const drop=new Set(chosen),kept=picking;picking=null;
  try{await update(next=>{next.seats=next.seats.filter((_,i)=>!drop.has(i));},T(`已在草稿中删除 ${chosen.length} 个${unordered?'学生':'座位'}。`,`Deleted ${chosen.length} in the draft.`));}
  catch(error){picking=kept;throw error;}
  closeModal();
 });
}
/** 清空本场座位: removes the selected exam from every seat in every room; undecided seats keep their other exams. */
function clearExamDialog(b){
 const exam=seatContext(b).exam,n=b.seats.filter(s=>seatExamIds(s).includes(exam.id)).length;
 const body=modal(T('清空本场座位？','Clear this exam\'s seats?'),`<p class="dialog-text">${T(`将从草稿清空「${sName(exam)}」在所有教室的 ${n} 个座位。待定座位只移除本场考试，保留其他候选考试。`,`This clears all ${n} seats of “${sName(exam)}” in every room from the draft. Undecided seats only drop this exam and keep their other candidates.`)}</p>${actions({saveLabel:T('清空','Clear')})}`);
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  await update(next=>{next.seats=next.seats.map(s=>seatExamIds(s).includes(exam.id)?withoutExam(s,exam.id):s).filter(Boolean);},T(`已在草稿中清空「${sName(exam)}」的座位。`,`Cleared the seats of “${sName(exam)}” in the draft.`));
  closeModal();
 });
}

function slotsDialog(b){
 const body=modal(T('修改时间段','Edit time slots'),`${field(T('每行一个时间段（最多 20 个），例如 08:10-09:40','One slot per line (up to 20), e.g. 08:10-09:40'),`<textarea class="input" name="slots" style="min-height:140px;font-family:ui-monospace,Menlo,monospace;font-size:13px">${esc(slotsOf(b).map(s=>s.start+'-'+s.end).join('\n'))}</textarea>`)}
 <p class="muted" style="font-size:12px">${T('按考试开始时间归入时间段；提前开考的考试归入与之重叠的时间段，时间标红。卡片保留实际起止时间，修改分组不会更改已有考试时间。','Sessions group by start time; a session that starts early joins the slot it runs into, with its time in red. Cards keep their actual times, and changing slots never changes session times.')}</p>${actions()}`);
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
 const body=modal(seating?T('座位表发布预览','Seating publish preview'):T('考试安排发布预览','Schedule publish preview'),(seating
  ?`<p style="font-size:14px">${T(`共 ${b.sessions.length} 场考试、${b.rooms.length} 间教室、${b.seats.length} 个座位。发布前请在“教室”页逐间核对。`,`${b.sessions.length} sessions across ${b.rooms.length} rooms, ${b.seats.length} seats. Check each room on the Rooms tab before publishing.`)}</p>
   ${unresolved(b.seats)?`<p class="callout">${T(`${unresolved(b.seats)} 个座位的学生身份不明确（同名学生），发布后这些座位不会关联学生账号。可在“教室”页点击左侧带标记的座位选择学生。`,`${unresolved(b.seats)} seats have namesakes not yet identified; once published they will not be linked to student accounts. On the Rooms tab, click a seat marked on its left edge to choose the student.`)}</p>`:''}
   ${b.rooms.some(r=>r.sizeReview)?`<p class="callout">${T('标记“尺寸待确认”的教室由座位表自动扩大，请先在“教室”页确认尺寸再发布。','Rooms marked “Check size” were grown to fit the seating sheet; confirm them on the Rooms tab before publishing.')}</p>`:''}
   <div class="list-box rooms">${b.rooms.map(r=>`<div><span style="font-weight:500">${esc(r.name)}</span><span class="muted">${r.rows} × ${r.columns} · ${count(b.sessions.filter(s=>s.rooms.includes(r.name)).length,'场','sessions')} · ${count(b.seats.filter(s=>s.room===r.name).length,'座','seats')}</span>${r.sizeReview?sizeTag():''}</div>`).join('')}</div>`
  :`<div class="list-box publish">${rows.map(s=>`<div><span class="num">${esc(md(s.date))} · ${s.start}–${s.end}</span><span class="${s.cancelled?'struck':''}">${esc(sName(s))} · ${esc(s.grades.map(g=>gradeLabel(g,app.lang)).join(' / '))}</span><span>${esc(s.rooms.join(' / '))}</span></div>`).join('')||`<div class="muted">${T('暂无考试','No sessions')}</div>`}</div>`)
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
 <p class="muted" data-rules style="font-size:12px" hidden></p>
 <p class="alert" data-progress hidden></p>${actions({saveLabel:T('开始提取','Extract')})}`,{size:'medium'});
 const zone=body.querySelector('[data-drop]'),choose=f=>{file=f||null;body.querySelector('[data-file]').textContent=file?file.name:T('拖入考试日程表 PDF，或点击选择','Drop the exam timetable PDF, or click to choose');};
 zone.querySelector('input').onchange=e=>choose(e.target.files[0]);
 zone.ondragover=e=>{e.preventDefault();zone.classList.add('over');};zone.ondragleave=()=>zone.classList.remove('over');
 zone.ondrop=e=>{e.preventDefault();zone.classList.remove('over');choose(e.dataTransfer.files[0]);};
 // Course naming follows the school rules chosen in Settings.
 api('/admin/school-rules').then(rules=>{
  const el=body.querySelector('[data-rules]');
  el.innerHTML=`${T('课程命名按学校规则：','Course names follow the school rules: ')}<strong>${esc(tx(rules.templates[rules.template].name))}</strong> <button type="button" class="btn btn-ghost" style="font-size:12px;padding:2px 4px" data-rules-edit>${T('修改','Change')}</button>`;
  el.hidden=false;el.querySelector('[data-rules-edit]').onclick=()=>{closeModal();go('settings');};
 }).catch(()=>{});
 const progress=message=>{const el=body.querySelector('[data-progress]');el.textContent=message;el.hidden=!message;};
 api('/admin/exam-extract').then(status=>{if(!status.configured){const el=body.querySelector('[data-error]');el.textContent=T('尚未配置 LLM_WORKER_URL 和 LLM_WORKER_TOKEN，请配置后重启服务。','LLM_WORKER_URL and LLM_WORKER_TOKEN are not configured. Configure them and restart the service.');el.hidden=false;}}).catch(()=>{});
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  if(!file)fail(T('请选择 PDF 文件。','Choose a PDF file.'));
  const pages=await readExamPdf(file,progress).finally(()=>progress(''));
  const job=await startJob(b,'sessions',JSON.stringify({images:pages.images,text:pages.text,start:b.start,end:b.end,fileName:file.name,items:pages.pages.map(page=>page.items||[])}));
  closeModal();
  openJob(job,{pages:pages.pages});
 });
}

const sessionCard=(s,i)=>`<div class="ai-card" data-pick="${i}" tabindex="0"><span class="ai-card-title">${esc(s.title||s.subject||'—')}${s.level&&!String(s.title||'').includes(s.level)?' · '+esc(s.level):''}</span><span class="muted num">${esc(s.date||'?')} · ${esc(s.start||'?')}–${esc(s.end||'?')} · ${esc((s.grades||[]).join(' / '))} · ${esc((s.rooms||[]).join(' / '))}</span></div>`;
const interrupted=n=>T(`提取中断：以下仅为中断前识别的 ${n} 条，其余内容请稍后重试提取或手动补充。`,`Extraction was interrupted: only the ${n} results found before then are shown. Retry later or add the rest by hand.`);
function reviewExtracted(b,result,review,{preset=false,elapsed=null,job=null}={}){
 const rows=result.sessions;
 const cell=(i,name,value,attrs='')=>`<input class="input" name="${name}" data-i="${i}" value="${esc(value??'')}" aria-label="${name} ${i+1}" ${attrs}>`;
 review.results(`<p style="font-size:14px">${T(`提取到 ${rows.length} 场考试。请核对日期、时间、学部、年级及教室；取消勾选可跳过某行。`,`Found ${rows.length} sessions. Check dates, times, divisions, grades and rooms; untick a row to skip it.`)}</p>
 <div style="overflow:auto"><table class="review-table"><thead><tr><th>${T('加入','Add')}</th><th>${T('考试名称','Exam')}</th><th>${T('学科 / Level','Subject / Level')}</th><th>${T('学部 / 年级','Division / grades')}</th><th>${T('日期','Date')}</th><th>${T('开始 / 结束','Start / end')}</th><th>${T('教室（逗号分隔）','Rooms (comma-separated)')}</th></tr></thead><tbody>
 ${rows.map((s,i)=>`<tr data-row="${i}" data-pick="${i}"><td><input type="checkbox" name="include" checked aria-label="${T(`加入第 ${i+1} 场`,`Add row ${i+1}`)}"></td><td>${cell(i,'title',s.title)}</td><td>${cell(i,'subject',s.subject)}${cell(i,'level',s.level)}</td><td><select class="input" name="division" aria-label="division ${i+1}"><option value="">${T('请选择','Choose')}</option>${divisions.map(k=>`<option value="${k}"${s.division===k?' selected':''}>${tx(SCOPES[k])}</option>`).join('')}</select>${cell(i,'grades',s.grades.join(', '))}</td><td>${cell(i,'date',s.date,'type="date"')}</td><td>${cell(i,'start',s.start,'type="time"')}${cell(i,'end',s.end,'type="time"')}</td><td>${cell(i,'rooms',s.rooms.join(','))}</td></tr>`).join('')}</tbody></table></div>
 <p class="muted" style="font-size:12px">${T('仅追加选中场次。新教室会以 5 排 × 5 列加入草稿，导入座位表时若座位超出会自动扩大（需人工确认），也可在教室设置中调整；不会生成学生座位数据。','Only ticked rows are added. New rooms are added as 5 × 5; importing seating grows a room that is too small (to be confirmed by hand), and sizes can be adjusted later. No seats are created.')}</p>`,{notes:result.warnings||[],elapsed,preset,total:rows.length,invalid:result.invalid||[]});
 const bar=review.actions(`${discardButton(job)}<button type="button" class="btn btn-secondary" data-dismiss>${T('返回','Go back')}</button><button type="button" class="btn btn-primary" data-save${rows.length?'':' disabled'}>${T('确认加入草稿','Add to draft')}</button>`);
 bar.querySelector('[data-dismiss]').onclick=review.close;
 bindDiscard(bar,job,review);
 const save=bar.querySelector('[data-save]');
 save.onclick=async()=>{
  save.disabled=true;review.alert('');
  try{
   const picked=$$('tr[data-row]',review.body).filter(tr=>tr.querySelector('[name=include]').checked).map(tr=>{
    const {source,...item}=rows[Number(tr.dataset.row)],get=name=>tr.querySelector(`[name=${name}]`).value.trim();
    for(const name of ['title','subject','level','division','date','start','end'])item[name]=get(name);
    for(const name of ['grades','rooms'])item[name]=[...new Set(get(name).split(/[,，]/).map(x=>x.trim()).filter(Boolean))];
    // Grades are typed as numbers (10) or the school's labels (G10, 高一); unreadable ones are dropped.
    item.grades=[...new Set(item.grades.map(parseGrade).filter(Boolean))].sort((a,z)=>a-z);
    return item;
   });
   if(!picked.length)fail(T('请至少选择一场考试。','Select at least one session.'));
   const current=batch(),rooms=[...current.rooms];
   for(const name of new Set(picked.flatMap(s=>s.rooms)))if(!rooms.some(r=>r.name===name))rooms.push({name,rows:5,columns:5});
   const next={...structuredClone(current),rooms,sessions:[...current.sessions,...picked]};
   await api('/admin/exam-extract/validate',{method:'POST',body:JSON.stringify(payload(next))});
   await commit(next,T(`已加入 ${picked.length} 场考试。`,`Added ${picked.length} sessions.`));review.close();
   if(job)discardJob(job).catch(()=>{});
  }catch(error){review.alert(error.message);save.disabled=false;}
 };
}

const xlsxProblem=file=>!/\.xlsx$/i.test(file.name)?T('仅支持 .xlsx 文件。','Only .xlsx files are supported.'):file.size>10*1024*1024?T('Excel 文件最大 10 MB。','Excel files must be at most 10 MB.'):'';
/** LLM 提取座位表: choose the seating workbook and the mode, then extract in the background. */
function seatExtractDialog(b){
 let file=null,mode='ordered';
 const hint=T('拖入座位表 Excel（.xlsx），或点击选择','Drop the seating workbook (.xlsx), or click to choose');
 const body=modal(T('LLM 提取座位表','Extract seats with LLM'),`<label class="dropzone tall" data-drop><span data-file>${hint}</span><input type="file" accept=".xlsx" aria-label="Excel"></label>
 <div class="field"><span class="label">${T('提取模式','Extraction mode')}</span>${segHtml('mode',[['ordered',T('按座位排序','By seat')],['unordered',T('不排序座位','Unordered')]],mode)}</div>
 <p class="muted" data-mode-note style="font-size:13px;line-height:1.7"></p>
 <p class="muted" style="font-size:13px;line-height:1.7">${T('最大 10 MB。工作簿文字与布局将发送到配置的 LLM Worker，提取后可核对修改，不会自动保存或发布。同一场考试的座位须全部按座位排序或全部不排序，与已有座位模式不同时无法导入。','Up to 10 MB. The workbook text and layout go to the configured LLM Worker; you review results before importing. Nothing is saved or published automatically. All seats of one exam are either by seat or unordered; an import that differs from the existing seats cannot be imported.')}</p>
 ${actions({saveLabel:T('开始提取','Extract')})}`,{size:'medium'});
 const notes={ordered:T('返回每位学生所在的教室、排和列。','Returns each student\'s room, row and column.'),unordered:T('仅返回每个教室的学生名单，不返回具体座位。','Returns only the student list of each room, without seats.')};
 const showMode=()=>{body.querySelector('[data-mode-note]').textContent=notes[mode];};showMode();
 pickOne(body,'mode',value=>{mode=value;showMode();});
 const zone=body.querySelector('[data-drop]'),choose=f=>{file=f||null;body.querySelector('[data-file]').textContent=file?file.name:hint;};
 zone.querySelector('input').onchange=e=>choose(e.target.files[0]);
 zone.ondragover=e=>{e.preventDefault();zone.classList.add('over');};zone.ondragleave=()=>zone.classList.remove('over');
 zone.ondrop=e=>{e.preventDefault();zone.classList.remove('over');choose(e.dataTransfer.files[0]);};
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  if(!file)fail(T('请选择座位表 Excel。','Choose the seating workbook.'));
  const problem=xlsxProblem(file);if(problem)fail(problem);
  const job=await startJob(b,'seats',file,{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name),'X-Seat-Mode':mode});
  closeModal();openJob(job);
 });
}
async function importSeats(file){
 const b=batch();if(!file)return;
 const problem=xlsxProblem(file);if(problem)return toast(problem,{bad:true});
 try{
  const result=await api(`/admin/exams/${encodeURIComponent(b.id)}/import-preview`,{method:'POST',body:file,headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name),'X-Draft-Version':String(b.version)}});
  $('#toast').hidden=true;
  seatPreview(b,result,T('Excel 导入预览','Excel import preview'));
 }catch(error){toast(error.message,{bad:true});}
}
/** Where a seat is: its room, plus row and column unless it is 不排序座位. */
const place=s=>placed(s)?`${s.room} · ${T(`第 ${s.row} 排 ${s.column} 列`,`Row ${s.row} · Col ${s.column}`)}`:s.room;
const seatLine=(b,s,i)=>`<div class="seat-line" data-pick="${i}" tabindex="0"><span class="num">${esc(place(s))}</span><span>${esc([s.className,s.name,s.englishName].filter(Boolean).join(' '))}</span><span class="muted">${esc(seatExamName(b,s))}</span></div>`;
function seatResults(b,result,review,{elapsed=null,preset=false,job=null}={}){
 const groups=new Map();
 result.seats.forEach((seat,i)=>{const key=`${seatExamIds(seat).join()}\u0000${seat.room}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);});
 review.results([...groups.values()].map(indexes=>{const first=result.seats[indexes[0]];return `<div class="seat-group"><h4>${esc(seatExamName(b,first))} · ${esc(first.room)} <span class="muted num" style="font-size:13px">${T(`${indexes.length} 座`,`${indexes.length} seats`)}</span></h4>${indexes.map(i=>seatLine(b,result.seats[i],i)).join('')}</div>`;}).join('')||`<p class="muted">${T('未识别到座位。','No seats found.')}</p>`,
  {notes:[...roomChangeNotes(result.roomChanges),...(result.warnings||[]),...(result.errors||[])],elapsed,preset,total:result.seats.length,invalid:result.invalid||[]});
 const bar=review.actions(`${discardButton(job)}<button type="button" class="btn btn-secondary" data-dismiss>${T('返回','Go back')}</button><button type="button" class="btn btn-primary" data-next${result.seats.length?'':' disabled'}>${T('下一步：核对身份并导入','Next: check identities and import')}</button>`);
 bar.querySelector('[data-dismiss]').onclick=review.close;
 bindDiscard(bar,job,review);
 // The draft may have changed while the job ran: identities are checked again against the current draft.
 bar.querySelector('[data-next]').onclick=()=>{review.close();recheckSeats(batch(),result).then(checked=>seatPreview(batch(),checked,T('LLM 座位表提取预览','LLM seat extraction preview'),()=>{if(job)discardJob(job).catch(()=>{});})).catch(error=>toast(error.message,{bad:true}));};
}
async function recheckSeats(b,result){
 const checked=await api('/admin/exams/'+encodeURIComponent(b.id)+'/student-preview',{method:'POST',body:JSON.stringify({version:b.version,seats:result.seats.map(({source,student,identityIssues,...seat})=>seat)})});
 return {...result,...checked,warnings:result.warnings};
}
function seatPreview(b,result,title,onImported=()=>{}){
 $('#close-preview').setAttribute('aria-label',T('关闭','Close'));
 importPreview(result,{title,batch:b,roomNotes:roomChangeNotes,accept:seats=>{
  if(batch().version!==b.version)throw new Error(T('草稿已修改，请重新导入。','The draft changed; import again.'));
  if(!b.seats.length){
   $('#preview-dialog').close();
   update(next=>{next.seats=seats;next.rooms=adaptRooms(next,seats).rooms;},T(`已导入 ${seats.length} 个座位到草稿。`,`Imported ${seats.length} seats into the draft.`)).then(onImported,error=>toast(error.message,{bad:true}));
  }else mergeDialog(b,seats,onImported);
 }});
}
const seatText=s=>`${place(s)} · ${[s.className,s.name,s.englishName].filter(Boolean).join(' ')}`;
/** The draft already has seats: show what the import adds and corrects, then merge it in or replace the draft. */
function mergeDialog(b,seats,onImported){
 const merge=mergeSeats(b.seats,seats);
 const corrections=merge.changed.map(({before,after})=>`<div class="merge-change"><span class="muted">${esc(seatExamName(b,after))}</span>${before.map(s=>`<del>${esc(seatText(s))}</del>`).join('')}<ins>→ ${esc(seatText(after))}</ins></div>`).join('');
 const body=modal(T('合并到草稿座位？','Merge into draft seats?'),`<p class="dialog-text">${T(`草稿已有 ${b.seats.length} 个座位。本次导入：新增 ${merge.added.length} 个，修正 ${merge.changed.length} 个，与草稿相同 ${merge.unchanged} 个。合并后未在本次导入中出现的草稿座位保持不变。`,`The draft already has ${b.seats.length} seats. This import adds ${merge.added.length}, corrects ${merge.changed.length} and repeats ${merge.unchanged} unchanged. Merging keeps draft seats this import does not mention.`)}</p>
 ${corrections?`<h4 style="margin:12px 0 4px">${T('修正（修正前 → 修正后）','Corrections (before → after)')}</h4><div class="merge-changes">${corrections}</div>`:''}
 ${actions({left:`<button type="button" class="btn btn-ghost btn-danger left" data-replace>${T('替换全部草稿座位','Replace all draft seats')}</button>`,saveLabel:T('合并到草稿','Merge into draft')})}`,{size:'wide'});
 const save=async(list,message)=>{
  if(batch().version!==b.version)fail(T('草稿已修改，请重新导入。','The draft changed; import again.'));
  await update(next=>{next.seats=list;next.rooms=adaptRooms(next,list).rooms;},message);
  closeModal();$('#preview-dialog').close();onImported();
 };
 body.querySelector('[data-save]').onclick=()=>busy(body,()=>save(merge.seats,T(`已合并：新增 ${merge.added.length} 个，修正 ${merge.changed.length} 个座位。`,`Merged: ${merge.added.length} seats added, ${merge.changed.length} corrected.`)));
 confirmButton(body,'[data-replace]',T('替换全部草稿座位','Replace all draft seats'),()=>save(seats,T(`已用 ${seats.length} 个座位替换草稿座位。`,`Replaced the draft with ${seats.length} seats.`)));
}

/* — 提取任务: AI extractions run in the background; the batch page shows the job and reopens it — */
const jobOf=b=>(app.data.jobs||[]).find(j=>j.batchId===b.id)||null;
const jobName=job=>job.kind==='seats'?T('座位表提取','Seat extraction'):T('考试场次提取','Session extraction');
function putJob(job){const list=app.data.jobs||(app.data.jobs=[]),i=list.findIndex(j=>j.id===job.id);if(i<0)list.unshift(job);else list[i]=job;refreshNav();}
async function discardJob(job){await api('/admin/extract-jobs/'+encodeURIComponent(job.id),{method:'DELETE'});app.data.jobs=(app.data.jobs||[]).filter(j=>j.id!==job.id);refreshNav();rerender();}
async function startJob(b,kind,body,headers={}){
 const job=await api(`/admin/extract-jobs/${kind}?batch=${encodeURIComponent(b.id)}`,{method:'POST',body,headers});
 app.data.jobs=(app.data.jobs||[]).filter(j=>j.batchId!==b.id);putJob(job);rerender();
 return job;
}
const jobTag=job=>!job?'':` <span class="tag ${job.status==='running'?'tag-outline':'tag-accent'} small">${{running:T('提取中','Extracting'),done:T('提取完成 · 待核对','Extracted · review'),failed:T('提取失败','Extraction failed'),interrupted:T('提取中断','Extraction stopped'),cancelled:T('提取已取消','Extraction cancelled')}[job.status]}</span>`;
function jobStrip(job){
 if(!job)return '';
 const by=job.createdBy?T(` · ${job.createdBy} 发起`,` · started by ${job.createdBy}`):'';
 const text={
  running:T(`${jobName(job)}进行中 · 已识别 ${job.items} 条`,`${jobName(job)} running · ${job.items} found`),
  done:T(`${jobName(job)}完成 · ${job.items} 条待核对导入`,`${jobName(job)} finished · ${job.items} to review and import`),
  failed:T(`${jobName(job)}失败：${job.error||''}`,`${jobName(job)} failed: ${job.error||''}`),
  interrupted:T(`${jobName(job)}已中断（服务重启或连接丢失）`,`${jobName(job)} stopped (a restart or a lost connection)`),
  cancelled:T(`${jobName(job)}已取消`,`${jobName(job)} cancelled`)
 }[job.status];
 const button=(act,label,cls='btn-secondary')=>`<button type="button" class="btn ${cls}" data-job-act="${act}">${label}</button>`;
 const buttons={
  running:button('open',T('查看进度','View progress'))+button('cancel',T('取消提取','Cancel'),'btn-ghost btn-danger'),
  done:button('discard',T('丢弃','Discard'),'btn-ghost')+button('open',T('查看结果','View results'),'btn-primary'),
 }[job.status]||button('discard',T('丢弃','Discard'),'btn-ghost')+button('open',T('查看','View'))+button('retry',T('重试','Retry'),'btn-primary');
 return `<div class="job-strip ${job.status}" data-job-strip role="status"><i class="ai-pulse" aria-hidden="true"></i><div class="clip"><div class="cell-main clip">${esc(text)}</div><div class="cell-sub clip">${esc(job.fileName)} · ${esc(stamp(job.createdAt))}${esc(by)}</div></div><div class="row-actions">${buttons}</div></div>`;
}
/** While a job of the open batch runs, refresh its strip every few seconds. */
function watchJob(b){
 const job=jobOf(b);if(job?.status!=='running')return;
 const visit=app.visit;
 setTimeout(async()=>{
  if(app.visit!==visit||view.id!==b.id)return;
  try{await loadJobs();}catch{}
  if(app.visit!==visit||view.id!==b.id)return;
  const next=jobOf(b),strip=$('[data-job-strip]');
  if(!next||next.status!==job.status)return rerender();
  if(strip)strip.outerHTML=jobStrip(next);
  watchJob(b);
 },5000);
}
async function jobAction(job,act){
 if(!job)return;
 try{
  if(act==='open')openJob(job);
  else if(act==='cancel'){putJob(await api(`/admin/extract-jobs/${encodeURIComponent(job.id)}/cancel`,{method:'POST'}));rerender();toast(T('已取消提取。','Extraction cancelled.'));}
  else if(act==='discard'){await discardJob(job);toast(T('已丢弃提取结果。','Extraction discarded.'));}
  else if(act==='retry')retryJob(job);
 }catch(error){toast(error.message,{bad:true});}
}
async function retryJob(job,review=null){
 // The open review dialog is reused: closing it first would fire its close event on the new review.
 try{const next=await api(`/admin/extract-jobs/${encodeURIComponent(job.id)}/retry`,{method:'POST'});putJob(next);rerender();openJob(next);}
 catch(error){if(review)review.alert(error.message);else toast(error.message,{bad:true});}
}
const discardButton=job=>job?`<button type="button" class="btn btn-ghost btn-danger left" data-discard>${T('丢弃结果','Discard results')}</button>`:'';
function bindDiscard(bar,job,review){const button=bar.querySelector('[data-discard]');if(button)button.onclick=async()=>{try{await discardJob(job);review.close();}catch(error){review.alert(error.message);}};}
/**
 * Opens the review of a job: replays its progress, then follows it until it ends. Closing only stops watching;
 * the job keeps running on the server.
 */
async function openJob(job,{pages=null}={}){
 const seats=job.kind==='seats',key=seats?'seats':'sessions',streamed=[];let final=null;
 const review=reviewView({title:`${jobName(job)} · ${job.fileName}`,startedAt:job.startedAt,sourceOf:i=>(final||{[key]:streamed})[key][i]?.source,onClose:()=>{if(view.id===job.batchId)rerender();}});
 const runningBar=()=>{
  const bar=/** @type {any} */(review.actions(`<button type="button" class="btn btn-ghost btn-danger left" data-cancel>${T('取消提取','Cancel extraction')}</button><button type="button" class="btn btn-secondary" data-dismiss>${T('关闭（后台继续）','Close (keeps running)')}</button>`));
  bar.querySelector('[data-dismiss]').onclick=review.close;
  bar.querySelector('[data-cancel]').onclick=async()=>{try{putJob(await api(`/admin/extract-jobs/${encodeURIComponent(job.id)}/cancel`,{method:'POST'}));}catch(error){review.alert(error.message);}};
 };
 runningBar();
 if(!seats){
  if(!pages)try{const input=await api(`/admin/extract-jobs/${encodeURIComponent(job.id)}/input`);pages=input.images.map((image,i)=>({image,items:input.items?.[i]||[]}));}catch{}
  if(pages)review.source(pagePane(pages));
 }
 try{
  const done=await followJob(job.id,{signal:review.signal,onJob:putJob},message=>{
   review.message(message);
   if(message.type==='source'&&message.sheets)review.source(sheetPane(message.sheets));
   if(message.type==='reset')streamed.length=0;
   if(message.type==='item'&&message.key===key){streamed.push(message.item);review.append(seats?seatLine(batch(),message.item,streamed.length-1):sessionCard(message.item,streamed.length-1));}
  });
  final=done.result;
  (seats?seatResults:reviewExtracted)(batch(),final,review,{elapsed:done.elapsed,job});
 }catch(error){
  if(error.name==='AbortError')return;
  if(error.job)putJob(error.job);
  const partial=error.partial;
  const bar=/** @type {any} */(review.actions(`${discardButton(job)}<button type="button" class="btn btn-secondary" data-dismiss>${T('关闭','Close')}</button>`));
  bar.querySelector('[data-dismiss]').onclick=review.close;bindDiscard(bar,job,review);
  review.error(error.message,{retry:()=>retryJob(job,review),partial:partial&&{count:partial[key].length,use:()=>{final=partial;(seats?seatResults:reviewExtracted)(batch(),{...partial,warnings:[interrupted(partial[key].length),...(partial.warnings||[])]},review,{job});}}});
 }
}
