import {importPreview} from './exam-import-preview.js';
import {readExamPdf} from './exam-pdf-input.js';
import {moveSeat,roomExamsAt,seatViewTimes} from './exam-seats.mjs';
import {subjectName} from './exam-subjects.mjs';
import {defaultExamSlots,examSlotRows} from './exam-times.mjs';
import {$,esc,api,divisions,sorted,seatingMarkup} from './exam-common.js';
let subjects=[],batches=[],draft=null,dirty=false,busy=false,imported=null;
const roomViews=new Map();
const notice=(message,ok=false)=>{$('#notice').textContent=message;$('#notice').classList.toggle('success',ok);};
function markDirty(){dirty=true;if($('#dirty-warning'))$('#dirty-warning').textContent='有未保存的修改';}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
const field=(name,label,value='',type='text',required=true)=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''}></label>`;
const options=(items,current)=>items.map(([id,label])=>`<option value="${esc(id)}" ${id===current?'selected':''}>${esc(label)}</option>`).join('');
const deleteButton=(attribute,value,label)=>`<button type="button" class="delete-icon" ${attribute}="${esc(value)}" aria-label="${esc(label)}" title="${esc(label)}"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button>`;
function removeRoom(index){
 const room=draft.rooms[index],affected=draft.sessions.filter(s=>s.rooms.includes(room.name));
 if(affected.some(s=>s.rooms.length===1)){alert('该教室是部分考试的唯一教室，请先为这些考试选择其他教室或删除场次。');return;}
 const seats=draft.seats.filter(s=>s.room===room.name).length;
 if(!confirm(`删除教室“${room.name}”？将从 ${affected.length} 场考试中移除该教室，并删除 ${seats} 条关联座位数据。保存并发布后对学生生效。`))return;
 draft.rooms.splice(index,1);for(const exam of affected)exam.rooms=exam.rooms.filter(r=>r!==room.name);draft.seats=draft.seats.filter(s=>s.room!==room.name);markDirty();edit();
}
function removeExam(id){
 const exam=draft.sessions.find(s=>s.id===id),seats=draft.seats.filter(s=>s.examId===id).length;
 if(!confirm(`删除考试“${exam.title}”？同时删除 ${seats} 条关联座位数据。保存并发布后，学生端将移除该考试及其个人勾选。`))return;
 draft.sessions=draft.sessions.filter(s=>s.id!==id);draft.seats=draft.seats.filter(s=>s.examId!==id);markDirty();edit();
}
function payload(){const {id,publishedAt,seatingPublishedAt,updatedAt,...data}=draft;return {...data,academicYear:data.academicYear?Number(data.academicYear):undefined};}
async function start(){try{const session=await api('/session');if(!(session.user?.role>=2)){document.body.hidden=true;location.reload();return;}subjects=await api('/exam-subjects');$('#manage-subjects').hidden=false;$('#new-batch').hidden=false;batches=await api('/admin/exams');list();}catch(e){notice(e.message);}}
window.addEventListener('account-changed',()=>{dirty=false;start();});
window.addEventListener('account-before-logout',event=>{if(dirty&&!confirm('放弃未保存修改并退出？'))event.preventDefault();});
function list(){$('#delete-batch').hidden=true;draft=null;dirty=false;$('#admin-content').innerHTML=`<div class="batch-list">${batches.map(b=>`<button class="batch-item" data-batch="${b.id}"><strong>${esc(b.title)}</strong><small>${b.start} — ${b.end}</small><small>${b.sessions.length} 场考试 · ${b.publishedAt?'考试已发布':'草稿'} · ${b.seatingPublishedAt?'座位已发布':'座位未发布'}</small></button>`).join('')||'<p class="admin-panel">暂无批次，点击新建开始。</p>'}</div>`;document.querySelectorAll('[data-batch]').forEach(el=>el.addEventListener('click',()=>{draft=structuredClone(batches.find(b=>b.id===el.getAttribute('data-batch')));edit();}));}
function edit(){
 $('#delete-batch').hidden=false;
 draft.timeSlots??=structuredClone(defaultExamSlots);
 $('#admin-content').innerHTML=`<div class="actions"><button id="back">← 批次列表</button><button id="save-batch" class="primary">保存草稿</button><button id="preview-schedule">预览并发布考试安排</button><button id="preview-seats">预览并发布座位表</button><span id="dirty-warning">${dirty?'有未保存的修改':''}</span></div><section class="admin-panel"><h2>批次信息</h2><form id="batch-meta" class="form-grid">${field('title','名称',draft.title)}${field('titleEn','英文名称（可选）',draft.titleEn,'text',false)}${field('start','开始日期',draft.start,'date')}${field('end','结束日期',draft.end,'date')}${field('academicYear','学年起始年份（例如 2026 = 2026–2027）',draft.academicYear||'','number',false)}</form><p class="muted">考试安排：${draft.publishedAt?esc(draft.publishedAt):'尚未发布'} · 座位表：${draft.seatingPublishedAt?esc(draft.seatingPublishedAt):'尚未发布'}。公开页面继续显示上次发布内容，直到再次发布。</p></section>
 <section class="admin-panel"><div class="section-heading"><h2>时间段</h2><button id="edit-slots">修改时间段</button></div><p>${draft.timeSlots.map(s=>`${s.start}–${s.end}`).join(' · ')}</p><p class="muted">按考试开始时间归入左侧时间段；卡片保留实际起止时间。修改分组不会更改已有考试时间。保存并发布后生效。</p></section>
 <section class="admin-panel"><div class="section-heading"><h2>考试场次</h2><div class="actions"><button id="extract-exams">LLM 提取</button><button id="add-exam">新增考试</button></div></div><div class="table-scroll"><table><thead><tr><th>日期 / 时间</th><th>考试</th><th>学部 / 年级</th><th>教室</th><th>操作</th></tr></thead><tbody>${sorted(draft.sessions).map(s=>`<tr><td>${s.date}<br>${s.start}–${s.end}</td><td>${esc(s.title)}${s.cancelled?' · 已取消':''}<br><small>${esc(s.id)}</small></td><td>${divisions[s.division][0]} · ${esc(s.grades.join(' / '))}</td><td>${esc(s.rooms.join(' / '))}</td><td><button data-exam="${s.id}">编辑</button> ${deleteButton('data-remove-exam',s.id,'删除考试 '+s.title)}</td></tr>`).join('')}</tbody></table></div></section>
 <section class="admin-panel"><div class="section-heading"><h2>教室与座位表</h2><button id="add-room">新增教室</button></div><p class="muted">展开教室，选择日期、时间段及考试查看座位。讲台在上，排从前向后，列从左到右。</p><div class="actions"><button id="template">下载 Excel 模板</button><label>导入 Excel（先保存教室和场次）<input id="import-file" type="file" accept=".xlsx"></label><label>LLM 提取座位表（仅 XLSX）<input id="extract-seats-file" type="file" accept=".xlsx"></label></div><p class="muted">LLM 提取会将工作簿文字与布局发送到配置的 LLM Worker；先保存教室和场次，提取后核对并确认替换本批次座位。</p>${draft.rooms.map((r,i)=>`<div class="room-section"><div class="room-actions"><button data-room="${i}">编辑教室</button> ${deleteButton('data-remove-room',i,'删除教室 '+r.name)}</div><details data-room-expand="${i}" ${roomView(r.name).open?'open':''}><summary><strong>${esc(r.name)}</strong><span class="muted">${r.rows} 排 × ${r.columns} 列</span></summary><div id="room-seats-${i}" class="room-seats"></div></details></div>`).join('')||'<p class="muted">暂无教室，请先新增教室。</p>'}</section>`;
 $('#extract-exams').onclick=extractExams;
 $('#edit-slots').onclick=slotEditor;
 $('#batch-meta').oninput=e=>{draft[e.target.name]=e.target.value;markDirty();};
 $('#back').onclick=()=>{if(dirty&&!confirm('放弃未保存修改并返回？'))return;list();};
 document.querySelectorAll('[data-remove-room]').forEach(el=>el.addEventListener('click',()=>removeRoom(Number(el.getAttribute('data-remove-room')))));
 document.querySelectorAll('[data-remove-exam]').forEach(el=>el.addEventListener('click',()=>removeExam(el.getAttribute('data-remove-exam'))));
 $('#save-batch').onclick=save;$('#add-room').onclick=()=>roomEditor(-1);$('#add-exam').onclick=()=>examEditor(null);
 document.querySelectorAll('[data-room]').forEach(el=>el.addEventListener('click',()=>roomEditor(Number(el.getAttribute('data-room')))));
 document.querySelectorAll('[data-exam]').forEach(el=>el.addEventListener('click',()=>examEditor(el.getAttribute('data-exam'))));
 $('#template').onclick=()=>{if(!draft.id||dirty){notice('请先保存草稿，再下载与当前场次对应的模板。');return;}location.href='/api/admin/exams/'+draft.id+'/template';};
 $('#import-file').onchange=()=>importFile(false);$('#extract-seats-file').onchange=()=>importFile(true);$('#preview-schedule').onclick=()=>preview(false);$('#preview-seats').onclick=()=>preview(true);document.querySelectorAll('[data-room-expand]').forEach(el=>{const index=Number(el.getAttribute('data-room-expand'));el.addEventListener('toggle',()=>{roomView(draft.rooms[index].name).open=/** @type {HTMLDetailsElement} */(el).open;if(roomView(draft.rooms[index].name).open)renderRoomSeats(index);});if(roomView(draft.rooms[index].name).open)renderRoomSeats(index);});
}
function roomView(name){const key=JSON.stringify([draft.id||'new',name]);if(!roomViews.has(key))roomViews.set(key,{open:false,date:'',slot:'',exam:'',time:''});return roomViews.get(key);}
function renderRoomSeats(index){
 const room=draft.rooms[index],view=roomView(room.name),host=$('#room-seats-'+index),exams=sorted(draft.sessions.filter(s=>s.rooms.includes(room.name))),dates=[...new Set(exams.map(s=>s.date))];
 if(!dates.length){host.innerHTML='<p class="muted">此教室暂无考试。请先在考试场次中分配此教室。</p>';return;}
 if(!dates.includes(view.date)){view.date=dates[0];}
 const rows=examSlotRows(draft.timeSlots,exams.filter(s=>s.date===view.date)).filter(r=>r.sessions.length);
 if(!rows.some(r=>r.start===view.slot)){view.slot=rows[0].start;}
 const row=rows.find(r=>r.start===view.slot);
 if(!row.sessions.some(s=>s.id===view.exam)){view.exam=row.sessions[0].id;view.time='';}
 const exam=row.sessions.find(s=>s.id===view.exam),editBatch={...draft,sessions:draft.sessions.map(s=>({...s,cancelled:false}))};
 const times=seatViewTimes(editBatch,exam,room.name);if(!times.includes(view.time))view.time=exam.start;
 const examIds=roomExamsAt(editBatch,exam,room.name,view.time).map(s=>s.id);
 const seats=draft.seats.map((seat,i)=>({seat,i})).filter(({seat})=>examIds.includes(seat.examId)&&seat.room===room.name);
 host.innerHTML=`<div class="room-tabs" aria-label="考试日期">${dates.map(d=>`<button data-room-date="${d}" aria-pressed="${view.date===d}">${d}</button>`).join('')}</div><div class="room-tabs" aria-label="时间段">${rows.map(r=>`<button data-room-slot="${esc(r.start)}" aria-pressed="${view.slot===r.start}">${esc(r.start)}–${esc(r.end)}</button>`).join('')}</div><div class="room-exams"><span class="muted">本时段考试</span><div class="room-tabs">${row.sessions.map(s=>`<button data-room-exam="${esc(s.id)}" class="room-exam-tag" aria-pressed="${view.exam===s.id}">${esc(s.subject||s.title)}${s.level?' · '+esc(s.level):''} <small>${s.start}–${s.end}${s.cancelled?'（已取消）':''}</small></button>`).join('')}</div></div><label class="time-select">查看时刻<select id="room-seat-time">${times.map(time=>`<option value="${esc(time)}" ${time===view.time?'selected':''}>${esc(time)}</option>`).join('')}</select></label><div class="room-seat-map">${seatingMarkup(editBatch,draft,exam,room.name,view.time,0,true)}</div><p class="muted">该时刻 ${seats.length} 人 · 点击座位编辑，点击空位添加；拖到空位移动，拖到已有学生的座位交换。</p>`;
 host.querySelectorAll('[data-room-date]').forEach(el=>el.onclick=()=>{view.date=el.dataset.roomDate;view.time='';renderRoomSeats(index);});
 host.querySelectorAll('[data-room-slot]').forEach(el=>el.onclick=()=>{view.slot=el.dataset.roomSlot;view.time='';renderRoomSeats(index);});
 host.querySelectorAll('[data-room-exam]').forEach(el=>el.onclick=()=>{view.exam=el.dataset.roomExam;view.time='';renderRoomSeats(index);});
 host.querySelector('#room-seat-time').onchange=e=>{view.time=e.target.value;renderRoomSeats(index);};
 host.querySelectorAll('[data-seat-row]').forEach(el=>{
  const row=Number(el.dataset.seatRow),column=Number(el.dataset.seatColumn),seatIndex=draft.seats.findIndex(s=>examIds.includes(s.examId)&&s.room===room.name&&s.row===row&&s.column===column);
  el.onclick=()=>seatEditor(seatIndex,{examId:exam.id,room:room.name,row,column,examIds});
  if(seatIndex<0)return;
  el.classList.add('movable-seat');
  el.onpointerdown=event=>{
   if(event.button!==0)return;
   const startX=event.clientX,startY=event.clientY;let dragging=false,target=null;
   const clean=()=>{el.classList.remove('dragging-seat');target?.classList.remove('seat-drop-target');el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',cancel);};
   const move=e=>{
    if(!dragging&&Math.hypot(e.clientX-startX,e.clientY-startY)<6)return;
    dragging=true;el.classList.add('dragging-seat');
    target?.classList.remove('seat-drop-target');target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-seat-row]');
    if(target&&!host.contains(target))target=null;
    if(target!==el)target?.classList.add('seat-drop-target');
   };
   const up=()=>{clean();if(!dragging)return;el.onclick=e=>{e.preventDefault();e.stopPropagation();};
    try{if(target&&moveSeat(draft,seatIndex,Number(target.dataset.seatRow),Number(target.dataset.seatColumn),examIds))markDirty();}catch(error){notice(error.message);}
    renderRoomSeats(index);
   };
   const cancel=()=>{clean();renderRoomSeats(index);};
   el.setPointerCapture(event.pointerId);el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',cancel);
  };
 });
}
function dialog(title,html,onSubmit){$('#editor-title').textContent=title;$('#editor-content').innerHTML=`<form id="edit-form">${html}<p id="form-error" class="import-errors" role="alert"></p><div class="actions"><button class="primary">保存到草稿</button></div></form>`;$('#edit-form').onsubmit=e=>{e.preventDefault();try{onSubmit(Object.fromEntries(new FormData(e.target)));markDirty();$('#editor-dialog').close();edit();}catch(error){$('#form-error').textContent=error.message;}};$('#editor-dialog').showModal();}
function roomEditor(index){const room=draft.rooms[index]||{name:'',rows:5,columns:5};dialog('教室设置',`<div class="form-grid">${field('name','教室名称',room.name)}${field('rows','排数（1–40）',room.rows,'number')}${field('columns','列数（1–40）',room.columns,'number')}</div>`,values=>{const r={name:values.name.trim(),rows:Number(values.rows),columns:Number(values.columns)};if(!r.name||![r.rows,r.columns].every(n=>Number.isInteger(n)&&n>=1&&n<=40))throw new Error('请输入有效名称和 1–40 的整数');if(draft.rooms.some((x,i)=>x.name===r.name&&i!==index))throw new Error('教室名称重复');if(index<0)draft.rooms.push(r);else{draft.rooms[index]=r;for(const s of draft.sessions)s.rooms=s.rooms.map(name=>name===room.name?r.name:name);for(const s of draft.seats)if(s.room===room.name)s.room=r.name;}});}
function slotEditor(){
 dialog('修改时间段',`<label>每行一个时间段（最多 20 个）<textarea name="slots" rows="7" required>${draft.timeSlots.map(s=>s.start+'-'+s.end).join('\n')}</textarea></label><p class="muted">例如 08:10-09:40；时间段不能重叠。</p>`,v=>{
  const slots=v.slots.trim().split(/\n+/).map(line=>{
   const match=line.trim().replace(/：/g,':').match(/^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})$/);
   if(!match)throw new Error('每行请输入 开始时间-结束时间');
   return {start:match[1].padStart(5,'0'),end:match[2].padStart(5,'0')};
  }).sort((a,b)=>a.start.localeCompare(b.start));
  if(slots.length>20||slots.some((s,i)=>![s.start,s.end].every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t))||s.end<=s.start||(i>0&&s.start<slots[i-1].end)))throw new Error('请输入最多 20 个有效、不重叠的时间段');
  draft.timeSlots=slots;
 });
}
function examEditor(id){
 const s=draft.sessions.find(s=>s.id===id)||{id:crypto.randomUUID(),title:'',titleEn:'',division:'high',grades:[],date:draft.start,start:draft.timeSlots[0].start,end:draft.timeSlots[0].end,rooms:[],note:'',cancelled:false};
 const canonicalSubject=s.subject?subjectName(s,subjects):'',selectedSubject=subjects.some(x=>x.name===canonicalSubject)?canonicalSubject:(s.subject?'__custom__':'');
 dialog('考试场次',`<div class="form-grid">${field('title','考试名称',s.title)}${field('titleEn','英文名称（可选）',s.titleEn,'text',false)}<label>学科<select name="subject"><option value="">请选择学科</option>${options(subjects.map(s=>[s.name,s.name]),selectedSubject)}<option value="__custom__" ${selectedSubject==='__custom__'?'selected':''}>自定义</option></select></label><label id="custom-subject-field" ${selectedSubject!=='__custom__'?'hidden':''}>自定义学科名称<input name="customSubject" maxlength="100" value="${esc(selectedSubject==='__custom__'?s.subject:'')}" ${selectedSubject==='__custom__'?'required':'disabled'}></label>${field('subjectEn','科目英文名称（可选）',s.subjectEn||'','text',false)}${field('level','Level（例如 HL / SL）',s.level||'','text',false)}<p class="muted wide">需要合并显示时，填写科目和 Level。同学部、同年级、同科目、同一天及同时间段自动合并，各 Level 独立勾选。</p><label>学部<select name="division">${options(Object.entries(divisions).map(([k,v])=>[k,v[0]]),s.division)}</select></label>${field('grades','适用年级（逗号分隔）',s.grades.join(','))}${field('date','日期',s.date,'date')}<label>套用时间段<select id="exam-slot"><option value="">自定义时间</option>${draft.timeSlots.map((slot,i)=>`<option value="${i}">${slot.start}–${slot.end}</option>`).join('')}</select></label>${field('start','开始',s.start,'time')}${field('end','结束',s.end,'time')}<fieldset class="wide room-picker"><legend>教室（可多选）</legend><div id="exam-rooms" class="room-options">${draft.rooms.map(r=>`<label class="room-option"><input type="checkbox" name="rooms" value="${esc(r.name)}" ${s.rooms.includes(r.name)?'checked':''}><span>${esc(r.name)}</span></label>`).join('')||'<p class="muted">请先在批次中添加教室。</p>'}</div></fieldset><label class="wide">说明<textarea name="note">${esc(s.note)}</textarea></label><label class="wide checkbox-row"><input name="cancelled" type="checkbox" ${s.cancelled?'checked':''}><span>已取消</span></label></div><p class="muted">编号 ${esc(s.id)}。如需保留记录和个人勾选，可标记取消而非删除。</p>`,v=>{
  const next={...s,title:v.title,titleEn:v.titleEn,subject:(v.subject==='__custom__'?v.customSubject:v.subject).trim(),subjectEn:v.subjectEn.trim(),level:v.level.trim(),division:v.division,grades:[...new Set(v.grades.split(/[,，]/).map(v=>v.trim()).filter(Boolean))],date:v.date,start:v.start,end:v.end,rooms:[...document.querySelectorAll('#exam-rooms input:checked')].map(o=>/** @type {HTMLInputElement} */(o).value),note:v.note,cancelled:!!v.cancelled};
  if(v.subject==='__custom__'&&!next.subject)throw new Error('请输入自定义学科名称');
  if(!next.rooms.length)throw new Error('请至少勾选一个教室');
  if(next.level&&!next.subject)throw new Error('填写 Level 时请选择学科');
  if(next.end<=next.start)throw new Error('结束时间必须晚于开始');if(id)draft.sessions[draft.sessions.findIndex(s=>s.id===id)]=next;else draft.sessions.push(next);
 });
 $('#edit-form [name=subject]').onchange=e=>{const custom=e.target.value==='__custom__';$('#custom-subject-field').hidden=!custom;const input=$('#edit-form [name=customSubject]');input.disabled=!custom;input.required=custom;const match=subjects.find(s=>s.name===e.target.value);$('#edit-form [name=subjectEn]').value=match?.english||'';};
 $('#exam-slot').onchange=e=>{const slot=draft.timeSlots[e.target.value];if(slot){$('#edit-form [name=start]').value=slot.start;$('#edit-form [name=end]').value=slot.end;}};
}
function seatEditor(index,context=null){if(!draft.sessions.length){notice('请先添加考试和教室。');return;}const s=draft.seats[index]||{examId:context?.examId||draft.sessions[0].id,room:context?.room||draft.sessions[0].rooms[0],row:context?.row||1,column:context?.column||1,className:'',name:'',englishName:''};const eligible=draft.sessions.filter(e=>(context?.examIds||[s.examId]).includes(e.id)&&e.rooms.includes(s.room));dialog('编辑座位',`<div class="form-grid"><label>考试（本教室当前时段）<select name="examId">${options(eligible.map(e=>[e.id,(e.subject||e.title)+(e.level?' · '+e.level:'')+' '+e.start+'–'+e.end]),s.examId)}</select></label><div><span class="muted">教室</span><p>${esc(s.room)}</p></div><p class="muted wide">第 ${s.row} 排 · 第 ${s.column} 列（在座位图中拖动换位）</p>${field('className','班级',s.className)}${field('grade','年级 1–12（可留空推算）',s.grade||'','number',false)}${field('name','中文名',s.name,'text',false)}${field('englishName','英文名',s.englishName,'text',false)}</div>`,v=>{if(!v.name.trim()&&!v.englishName.trim())throw new Error('至少填写一种姓名');if(!eligible.some(e=>e.id===v.examId))throw new Error('请选择本教室当前时段的考试');const seat={...s,examId:v.examId,className:v.className,name:v.name,englishName:v.englishName,grade:v.grade?Number(v.grade):null,studentId:v.name!==s.name||v.className!==s.className?undefined:s.studentId};if(index<0)draft.seats.push(seat);else draft.seats[index]=seat;});
 if(index>=0){$('#edit-form .actions').insertAdjacentHTML('beforeend',deleteButton('id','delete-seat','删除座位'));$('#delete-seat').onclick=()=>{if(!confirm(`删除 ${s.name||s.englishName} 在 ${s.room} 第 ${s.row} 排、第 ${s.column} 列的座位数据？保存并发布后生效。`))return;draft.seats.splice(index,1);markDirty();$('#editor-dialog').close();edit();};}
}
async function save(){if(busy)return;if(!$('#batch-meta').reportValidity())return;busy=true;$('#save-batch').disabled=true;try{draft=await api('/admin/exams'+(draft.id?'/'+draft.id:''),{method:draft.id?'PUT':'POST',body:JSON.stringify(payload())});dirty=false;subjects=await api('/exam-subjects');await refreshList();notice('草稿已保存，公开版本尚未改变。',true);edit();}catch(e){notice(e.message);}finally{busy=false;if($('#save-batch'))$('#save-batch').disabled=false;}}
async function refreshList(){batches=await api('/admin/exams');}
async function importFile(llm=false){
 const input=$('#'+(llm?'extract-seats-file':'import-file')),target=draft,version=draft.version;
 if(busy)return;
 if(!draft.id||dirty){notice('请先保存当前草稿，然后重新选择 Excel 文件。');input.value='';return;}
 const file=input.files[0];if(!file)return;if(!/\.xlsx$/i.test(file.name)){notice('仅支持 .xlsx 文件。');input.value='';return;}if(file.size>2*1024*1024){notice('Excel 文件最大 2 MB。');return;}
 busy=true;input.disabled=true;if(llm)notice('正在提取座位表…');
 try{const response=await fetch(`/api/admin/exams/${draft.id}/${llm?'seat-extract':'import-preview'}`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name),'X-Draft-Version':String(version)},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error);if(draft!==target||draft.version!==version||dirty)throw new Error('草稿已修改，请重新提取。');imported=result.seats;
 importPreview(result,{title:llm?'LLM 座位表提取预览':'Excel 导入预览',batch:target,accept:seats=>{if(draft!==target||draft.version!==version||dirty)throw new Error('草稿已修改，请重新提取。');draft.seats=seats;markDirty();$('#preview-dialog').close();edit();notice('已导入到编辑器，请保存草稿，再预览发布。',true);}});
 }catch(e){notice(e.message);}finally{busy=false;input.disabled=false;input.value='';}
}
function preview(seats){
 if(!draft.id||dirty){notice('请先保存草稿，再预览发布。');return;}
 $('#preview-title').textContent=seats?'座位表发布预览':'考试安排发布预览';
 $('#preview-content').innerHTML=seats?`<p class="muted">共 ${draft.seats.length} 个座位。选择场次、教室和时刻核对座位表。</p><label>场次<select id="preview-exam">${options(draft.sessions.map(s=>[s.id,s.date+' '+s.start+' '+s.title]),'')}</select></label><label>教室<select id="preview-room"></select></label><label>查看时刻<select id="preview-time"></select></label><div id="preview-grid"></div>`:`<p>${esc(draft.title)} · ${draft.start} — ${draft.end}</p><div class="table-scroll"><table><thead><tr><th>日期 / 时间</th><th>考试</th><th>适用</th><th>教室</th></tr></thead><tbody>${sorted(draft.sessions).map(s=>`<tr><td>${s.date}<br>${s.start}–${s.end}</td><td>${esc(s.title)}${s.cancelled?'（已取消）':''}</td><td>${divisions[s.division][0]} ${esc(s.grades.join(' / '))}</td><td>${esc(s.rooms.join(' / '))}</td></tr>`).join('')}</tbody></table></div><p class="warning">时间、教室或取消状态发生变化时，已发布座位表将撤下，需核对后重新发布。</p>`;
 $('#preview-content').insertAdjacentHTML('beforeend',`<p id="publish-error" role="alert" class="import-errors"></p><div class="actions"><button id="publish" class="primary">确认发布${seats?'座位表':'考试安排'}</button></div>`);
 if(seats&&draft.sessions.length){
  const draw=()=>{const s=draft.sessions.find(s=>s.id===$('#preview-exam').value);$('#preview-grid').innerHTML=seatingMarkup(draft,draft,s,$('#preview-room').value,$('#preview-time').value);};
  const times=()=>{const s=draft.sessions.find(s=>s.id===$('#preview-exam').value);$('#preview-time').innerHTML=options(seatViewTimes(draft,s,$('#preview-room').value).map(time=>[time,time]),s.start);draw();};
  const rooms=()=>{const s=draft.sessions.find(s=>s.id===$('#preview-exam').value);$('#preview-room').innerHTML=options(s.rooms.map(r=>[r,r]),'');times();};rooms();$('#preview-exam').onchange=rooms;$('#preview-room').onchange=times;$('#preview-time').onchange=draw;
 }
 $('#preview-dialog').showModal();$('#publish').onclick=async()=>{$('#publish').disabled=true;try{draft=await api(`/admin/exams/${draft.id}/${seats?'publish-seats':'publish'}`,{method:'POST',body:JSON.stringify({version:draft.version})});await refreshList();$('#preview-dialog').close();edit();notice('发布成功。',true);}catch(e){$('#publish-error').textContent=e.message;}finally{$('#publish').disabled=false;}};
}
$('#new-batch').onclick=()=>{if(dirty&&!confirm('放弃未保存修改？'))return;draft={title:'',titleEn:'',start:'',end:'',sessions:[],rooms:[],seats:[]};dirty=false;edit();};

$('#close-editor').onclick=()=>$('#editor-dialog').close();$('#close-preview').onclick=()=>$('#preview-dialog').close();start();

$('#manage-subjects').onclick=manageSubjects;
function manageSubjects(){
 $('#editor-title').textContent='管理学科';
 $('#editor-content').innerHTML=`<p class="muted">同一学科在所有批次使用同一颜色。新学科自动分配未使用的颜色；考试编辑器也可直接输入新学科，保存草稿后加入此列表。</p><div class="subject-list">${subjects.map((s,i)=>`<div class="subject-row"><span class="subject-swatch" style="background:hsl(${s.hue} 55% 95%);border-color:hsl(${s.hue} 27% 50%)"></span><strong>${esc(s.name)}</strong><input data-subject-english="${i}" aria-label="${esc(s.name)}英文名称" value="${esc(s.english)}" maxlength="100"><button type="button" data-save-subject="${i}">保存</button></div>`).join('')}</div><form id="new-subject" class="form-grid">${field('name','新增学科')}${field('english','英文名称（可选）','','text',false)}<button class="primary">添加学科</button></form><p id="subject-error" role="status"></p>`;
 const update=async(body,method)=>{try{subjects=await api('/admin/exam-subjects',{method,body:JSON.stringify(body)});manageSubjects();}catch(e){$('#subject-error').textContent=e.message;}};
 document.querySelectorAll('[data-save-subject]').forEach(el=>el.addEventListener('click',()=>{const index=Number(el.getAttribute('data-save-subject'));update({name:subjects[index].name,english:/** @type {HTMLInputElement} */(document.querySelector(`[data-subject-english="${index}"]`)).value},'PUT');}));
 $('#new-subject').onsubmit=e=>{e.preventDefault();update(Object.fromEntries(new FormData(e.target)),'POST');};
 if(!$('#editor-dialog').open)$('#editor-dialog').showModal();
}

$('#delete-batch').onclick=async()=>{
 if(busy||!draft)return;
 if(!confirm(`确定删除考试批次“${draft.title||'未命名批次'}”？该批次的全部考试、座位数据和学生个人勾选将一并删除，已发布内容立即下架。此操作不可撤销。`))return;
 busy=true;$('#delete-batch').disabled=true;
 try{
  if(draft.id)await api('/admin/exams/'+draft.id,{method:'DELETE',body:JSON.stringify({version:draft.version})});
  dirty=false;draft=null;$('#delete-batch').hidden=true;await refreshList();list();notice('考试批次已删除。',true);
 }catch(e){notice(e.message);}finally{busy=false;$('#delete-batch').disabled=false;}
};

async function extractExams(){
 if(!draft.start||!draft.end){notice('请先填写批次开始、结束日期。');return;}
 const target=draft;
 $('#preview-title').textContent='LLM 提取考试场次';
 $('#preview-content').innerHTML=`<form id="extract-form"><label>考试日程表 PDF（最多 20 MB、10 页）<input name="pdf" type="file" accept=".pdf,application/pdf" required></label><p class="muted">支持普通及扫描版 PDF。页面内容将发送到配置的 LLM Worker，提取后可核对修改，不会自动保存或发布。</p><p id="extract-error" role="status"></p><button class="primary" id="run-extract">开始提取</button></form>`;
 $('#preview-dialog').showModal();
 try{const status=await api('/admin/exam-extract');if(!status.configured&&$('#extract-error'))$('#extract-error').textContent='尚未配置 LLM_WORKER_URL 和 LLM_WORKER_TOKEN，请配置后重启服务。';}catch(e){if($('#extract-error'))$('#extract-error').textContent=e.message;}
 if(!$('#extract-form'))return;
 const form=$('#extract-form');form.onsubmit=async e=>{
  e.preventDefault();const button=$('#run-extract');button.disabled=true;$('#extract-error').textContent='正在提取…';
  try{
   const pages=await readExamPdf(form.elements.pdf.files[0],message=>{if($('#extract-error'))$('#extract-error').textContent=message;});
   if(!$('#preview-dialog').open||$('#extract-form')!==form)return;
   $('#extract-error').textContent='正在提取考试场次…';
   const result=await api('/admin/exam-extract',{method:'POST',body:JSON.stringify({...pages,start:target.start,end:target.end})});
   if(!$('#preview-dialog').open||$('#extract-form')!==form||draft!==target)return;
   extractedPreview(result,target);
  }catch(error){if($('#extract-error'))$('#extract-error').textContent=error.message;}finally{button.disabled=false;}
 };
}
function extractedPreview(result,target){
 const rows=result.sessions;
 $('#preview-content').innerHTML=`<form id="extracted-form"><p>提取到 ${rows.length} 场考试。请核对日期、时间、学部、年级及教室；取消勾选可跳过某行。</p>${result.warnings.length?`<p class="warning">${result.warnings.map(esc).join('<br>')}</p>`:''}<div class="table-scroll"><table class="extract-table"><thead><tr><th>加入</th><th>考试名称</th><th>学科 / Level</th><th>学部 / 年级</th><th>日期</th><th>开始 / 结束</th><th>教室（逗号分隔）</th></tr></thead><tbody>${rows.map((s,i)=>`<tr data-extracted="${i}"><td><input type="checkbox" name="include" checked aria-label="加入第 ${i+1} 场"></td><td><input name="title" aria-label="考试名称 ${i+1}" value="${esc(s.title)}"></td><td><input name="subject" aria-label="学科 ${i+1}" value="${esc(s.subject)}"><input name="level" aria-label="Level ${i+1}" value="${esc(s.level)}"></td><td><select name="division" aria-label="学部 ${i+1}"><option value="">请选择</option>${options(Object.entries(divisions).map(([k,v])=>[k,v[0]]),s.division)}</select><input name="grades" aria-label="年级 ${i+1}" value="${esc(s.grades.join(','))}"></td><td><input type="date" name="date" aria-label="日期 ${i+1}" value="${esc(s.date)}"></td><td><input type="time" name="start" aria-label="开始 ${i+1}" value="${esc(s.start)}"><input type="time" name="end" aria-label="结束 ${i+1}" value="${esc(s.end)}"></td><td><input name="rooms" aria-label="教室 ${i+1}" value="${esc(s.rooms.join(','))}"></td></tr>`).join('')}</tbody></table></div><p class="muted">仅追加选中场次。新教室会以 5 排 × 5 列加入草稿，可在教室设置中调整；不会生成学生座位数据。</p><p id="extract-error" role="alert"></p><button class="primary" ${rows.length?'':'disabled'}>确认加入草稿</button></form>`;
 $('#extracted-form').onsubmit=async e=>{
  e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
  try{
   const sessions=[...document.querySelectorAll('[data-extracted]')].filter(el=>/** @type {HTMLInputElement} */(el.querySelector('[name=include]')).checked).map(node=>{const el=/** @type {any} */(node);const item={...rows[Number(el.getAttribute('data-extracted'))]};for(const name of ['title','subject','level','division','date','start','end'])item[name]=el.querySelector(`[name=${name}]`).value.trim();for(const name of ['grades','rooms'])item[name]=[...new Set(el.querySelector(`[name=${name}]`).value.split(/[,，]/).map(s=>s.trim()).filter(Boolean))];return item;});
   if(!sessions.length)throw new Error('请至少选择一场考试');
   const rooms=[...target.rooms];for(const name of new Set(sessions.flatMap(s=>s.rooms)))if(!rooms.some(r=>r.name===name))rooms.push({name,rows:5,columns:5});
   const candidate={...target,rooms,sessions:[...target.sessions,...sessions]};
   await api('/admin/exam-extract/validate',{method:'POST',body:JSON.stringify(candidate)});
   if(draft!==target)return;
   draft.rooms=rooms;draft.sessions=candidate.sessions;markDirty();$('#preview-dialog').close();edit();notice(`已加入 ${sessions.length} 场考试，请保存草稿后再预览发布。`,true);
  }catch(error){$('#extract-error').textContent=error.message;}finally{button.disabled=false;}
 };
}

$('#language').hidden=true;
