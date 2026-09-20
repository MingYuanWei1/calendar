import {moveSeat,roomSlotExams} from './exam-seats.mjs';
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
function payload(){const {id,publishedAt,seatingPublishedAt,updatedAt,...data}=draft;return data;}
async function start(){try{const session=await api('/session');if(!session.authenticated){login();return;}subjects=await api('/exam-subjects');$('#manage-subjects').hidden=false;$('#logout').hidden=false;$('#new-batch').hidden=false;batches=await api('/admin/exams');list();}catch(e){notice(e.message);}}
function login(){
 $('#admin-content').innerHTML=`<form id="login" class="admin-panel login-box"><h2>管理员登录</h2><p class="muted">使用现有校历管理员账号；学校 Microsoft 登录仅用于学生端。</p>${field('username','账号')}${field('password','密码','','password')}<button class="primary">登录</button></form>`;
 $('#login').onsubmit=async e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.target));try{await api('/login',{method:'POST',body:JSON.stringify(values)});await start();}catch(error){notice(error.message);}};
}
function list(){$('#delete-batch').hidden=true;draft=null;dirty=false;$('#admin-content').innerHTML=`<div class="batch-list">${batches.map(b=>`<button class="batch-item" data-batch="${b.id}"><strong>${esc(b.title)}</strong><small>${b.start} — ${b.end}</small><small>${b.sessions.length} 场考试 · ${b.publishedAt?'考试已发布':'草稿'} · ${b.seatingPublishedAt?'座位已发布':'座位未发布'}</small></button>`).join('')||'<p class="admin-panel">暂无批次，点击新建开始。</p>'}</div>`;document.querySelectorAll('[data-batch]').forEach(el=>el.addEventListener('click',()=>{draft=structuredClone(batches.find(b=>b.id===el.getAttribute('data-batch')));edit();}));}
function edit(){
 $('#delete-batch').hidden=false;
 draft.timeSlots??=structuredClone(defaultExamSlots);
 $('#admin-content').innerHTML=`<div class="actions"><button id="back">← 批次列表</button><button id="save-batch" class="primary">保存草稿</button><button id="preview-schedule">预览并发布考试安排</button><button id="preview-seats">预览并发布座位表</button><span id="dirty-warning">${dirty?'有未保存的修改':''}</span></div><section class="admin-panel"><h2>批次信息</h2><form id="batch-meta" class="form-grid">${field('title','名称',draft.title)}${field('titleEn','英文名称（可选）',draft.titleEn,'text',false)}${field('start','开始日期',draft.start,'date')}${field('end','结束日期',draft.end,'date')}</form><p class="muted">考试安排：${draft.publishedAt?esc(draft.publishedAt):'尚未发布'} · 座位表：${draft.seatingPublishedAt?esc(draft.seatingPublishedAt):'尚未发布'}。公开页面继续显示上次发布内容，直到再次发布。</p></section>
 <section class="admin-panel"><div class="section-heading"><h2>时间段</h2><button id="edit-slots">修改时间段</button></div><p>${draft.timeSlots.map(s=>`${s.start}–${s.end}`).join(' · ')}</p><p class="muted">按考试开始时间归入左侧时间段；卡片保留实际起止时间。修改分组不会更改已有考试时间。保存并发布后生效。</p></section>
 <section class="admin-panel"><div class="section-heading"><h2>教室与座位表</h2><button id="add-room">新增教室</button></div><p class="muted">展开教室，选择日期、时间段及考试查看座位。讲台在上，排从前向后，列从左到右。</p><div class="actions"><button id="template">下载 Excel 模板</button><label>导入 Excel（先保存教室和场次）<input id="import-file" type="file" accept=".xlsx"></label></div>${draft.rooms.map((r,i)=>`<div class="room-section"><div class="room-actions"><button data-room="${i}">编辑教室</button> ${deleteButton('data-remove-room',i,'删除教室 '+r.name)}</div><details data-room-expand="${i}" ${roomView(r.name).open?'open':''}><summary><strong>${esc(r.name)}</strong><span class="muted">${r.rows} 排 × ${r.columns} 列</span></summary><div id="room-seats-${i}" class="room-seats"></div></details></div>`).join('')||'<p class="muted">暂无教室，请先新增教室。</p>'}</section>
 <section class="admin-panel"><div class="section-heading"><h2>考试场次</h2><button id="add-exam">新增考试</button></div><div class="table-scroll"><table><thead><tr><th>日期 / 时间</th><th>考试</th><th>学部 / 年级</th><th>教室</th><th>操作</th></tr></thead><tbody>${sorted(draft.sessions).map(s=>`<tr><td>${s.date}<br>${s.start}–${s.end}</td><td>${esc(s.title)}${s.cancelled?' · 已取消':''}<br><small>${esc(s.id)}</small></td><td>${divisions[s.division][0]} · ${esc(s.grades.join(' / '))}</td><td>${esc(s.rooms.join(' / '))}</td><td><button data-exam="${s.id}">编辑</button> ${deleteButton('data-remove-exam',s.id,'删除考试 '+s.title)}</td></tr>`).join('')}</tbody></table></div></section>`;
 $('#edit-slots').onclick=slotEditor;
 $('#batch-meta').oninput=e=>{draft[e.target.name]=e.target.value;markDirty();};
 $('#back').onclick=()=>{if(dirty&&!confirm('放弃未保存修改并返回？'))return;list();};
 document.querySelectorAll('[data-remove-room]').forEach(el=>el.addEventListener('click',()=>removeRoom(Number(el.getAttribute('data-remove-room')))));
 document.querySelectorAll('[data-remove-exam]').forEach(el=>el.addEventListener('click',()=>removeExam(el.getAttribute('data-remove-exam'))));
 $('#save-batch').onclick=save;$('#add-room').onclick=()=>roomEditor(-1);$('#add-exam').onclick=()=>examEditor(null);
 document.querySelectorAll('[data-room]').forEach(el=>el.addEventListener('click',()=>roomEditor(Number(el.getAttribute('data-room')))));
 document.querySelectorAll('[data-exam]').forEach(el=>el.addEventListener('click',()=>examEditor(el.getAttribute('data-exam'))));
 $('#template').onclick=()=>{if(!draft.id||dirty){notice('请先保存草稿，再下载与当前场次对应的模板。');return;}location.href='/api/admin/exams/'+draft.id+'/template';};
 $('#import-file').onchange=importFile;$('#preview-schedule').onclick=()=>preview(false);$('#preview-seats').onclick=()=>preview(true);document.querySelectorAll('[data-room-expand]').forEach(el=>{const index=Number(el.getAttribute('data-room-expand'));el.addEventListener('toggle',()=>{roomView(draft.rooms[index].name).open=/** @type {HTMLDetailsElement} */(el).open;if(roomView(draft.rooms[index].name).open)renderRoomSeats(index);});if(roomView(draft.rooms[index].name).open)renderRoomSeats(index);});
}
function roomView(name){const key=JSON.stringify([draft.id||'new',name]);if(!roomViews.has(key))roomViews.set(key,{open:false,date:'',slot:'',exam:''});return roomViews.get(key);}
function renderRoomSeats(index){
 const room=draft.rooms[index],view=roomView(room.name),host=$('#room-seats-'+index),exams=sorted(draft.sessions.filter(s=>s.rooms.includes(room.name))),dates=[...new Set(exams.map(s=>s.date))];
 if(!dates.length){host.innerHTML='<p class="muted">此教室暂无考试。请先在考试场次中分配此教室。</p>';return;}
 if(!dates.includes(view.date)){view.date=dates[0];}
 const rows=examSlotRows(draft.timeSlots,exams.filter(s=>s.date===view.date)).filter(r=>r.sessions.length);
 if(!rows.some(r=>r.start===view.slot)){view.slot=rows[0].start;}
 const row=rows.find(r=>r.start===view.slot);
 if(!row.sessions.some(s=>s.id===view.exam)){view.exam=row.sessions[0].id;}
 const exam=row.sessions.find(s=>s.id===view.exam),examIds=row.sessions.map(s=>s.id),seats=draft.seats.map((seat,i)=>({seat,i})).filter(({seat})=>examIds.includes(seat.examId)&&seat.room===room.name);
 host.innerHTML=`<div class="room-tabs" aria-label="考试日期">${dates.map(d=>`<button data-room-date="${d}" aria-pressed="${view.date===d}">${d}</button>`).join('')}</div><div class="room-tabs" aria-label="考试时间段">${rows.map(r=>`<button data-room-slot="${esc(r.start)}" aria-pressed="${view.slot===r.start}">${esc(r.start)}–${esc(r.end)}</button>`).join('')}</div><div class="room-exams"><span class="muted">本时段考试</span><div class="room-tabs">${row.sessions.map(s=>`<span class="room-exam-tag">${esc(s.subject||s.title)}${s.level?' · '+esc(s.level):''} <small>${s.start}–${s.end}${s.cancelled?'（已取消）':''}</small></span>`).join('')}</div></div><div class="room-seat-map">${seatingMarkup({...draft,sessions:row.sessions.map(s=>({...s,cancelled:false}))},draft,exam,room.name,null,0,true)}</div><p class="muted">本时段 ${seats.length} 人 · 点击座位编辑，点击空位添加；拖到空位移动，拖到已有学生的座位交换。</p>`;
 host.querySelectorAll('[data-room-date]').forEach(el=>el.onclick=()=>{view.date=el.dataset.roomDate;renderRoomSeats(index);});
 host.querySelectorAll('[data-room-slot]').forEach(el=>el.onclick=()=>{view.slot=el.dataset.roomSlot;renderRoomSeats(index);});
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
function seatEditor(index,context=null){if(!draft.sessions.length){notice('请先添加考试和教室。');return;}const s=draft.seats[index]||{examId:context?.examId||draft.sessions[0].id,room:context?.room||draft.sessions[0].rooms[0],row:context?.row||1,column:context?.column||1,className:'',name:'',englishName:''};const eligible=draft.sessions.filter(e=>(context?.examIds||[s.examId]).includes(e.id)&&e.rooms.includes(s.room));dialog('编辑座位',`<div class="form-grid"><label>考试（本教室当前时段）<select name="examId">${options(eligible.map(e=>[e.id,(e.subject||e.title)+(e.level?' · '+e.level:'')+' '+e.start+'–'+e.end]),s.examId)}</select></label><div><span class="muted">教室</span><p>${esc(s.room)}</p></div><p class="muted wide">第 ${s.row} 排 · 第 ${s.column} 列（在座位图中拖动换位）</p>${field('className','班级',s.className)}${field('name','中文名',s.name,'text',false)}${field('englishName','英文名',s.englishName,'text',false)}</div>`,v=>{if(!v.name.trim()&&!v.englishName.trim())throw new Error('至少填写一种姓名');if(!eligible.some(e=>e.id===v.examId))throw new Error('请选择本教室当前时段的考试');const seat={...s,examId:v.examId,className:v.className,name:v.name,englishName:v.englishName};if(index<0)draft.seats.push(seat);else draft.seats[index]=seat;});
 if(index>=0){$('#edit-form .actions').insertAdjacentHTML('beforeend',deleteButton('id','delete-seat','删除座位'));$('#delete-seat').onclick=()=>{if(!confirm(`删除 ${s.name||s.englishName} 在 ${s.room} 第 ${s.row} 排、第 ${s.column} 列的座位数据？保存并发布后生效。`))return;draft.seats.splice(index,1);markDirty();$('#editor-dialog').close();edit();};}
}
async function save(){if(busy)return;if(!$('#batch-meta').reportValidity())return;busy=true;$('#save-batch').disabled=true;try{draft=await api('/admin/exams'+(draft.id?'/'+draft.id:''),{method:draft.id?'PUT':'POST',body:JSON.stringify(payload())});dirty=false;subjects=await api('/exam-subjects');await refreshList();notice('草稿已保存，公开版本尚未改变。',true);edit();}catch(e){notice(e.message);}finally{busy=false;if($('#save-batch'))$('#save-batch').disabled=false;}}
async function refreshList(){batches=await api('/admin/exams');}
async function importFile(){
 if(!draft.id||dirty){notice('请先保存当前草稿，然后重新选择 Excel 文件。');$('#import-file').value='';return;}
 const file=$('#import-file').files[0];if(!file)return;if(file.size>2*1024*1024){notice('Excel 文件最大 2 MB。');return;}
 try{const response=await fetch(`/api/admin/exams/${draft.id}/import-preview`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error);imported=result.seats;
 $('#preview-title').textContent='Excel 导入预览';$('#preview-content').innerHTML=`<p>读取 ${imported.length} 个座位；确认后替换本批次全部草稿座位，发布版本不变。</p><p class="import-errors">${esc(result.errors.join('\n'))}</p><div class="table-scroll"><table><thead><tr><th>考试</th><th>教室</th><th>排 / 列</th><th>学生</th></tr></thead><tbody>${imported.slice(0,100).map(s=>`<tr><td>${esc(draft.sessions.find(e=>e.id===s.examId)?.title||s.examId)}</td><td>${esc(s.room)}</td><td>${s.row} / ${s.column}</td><td>${esc(s.className)} ${esc(s.name)} ${esc(s.englishName)}</td></tr>`).join('')}</tbody></table></div><p class="muted">预览前 100 条；确认后导入全部有效记录。</p><button id="accept-import" class="primary" ${result.errors.length||!imported.length?'disabled':''}>确认替换草稿座位</button>`;$('#preview-dialog').showModal();$('#accept-import').onclick=()=>{draft.seats=imported;seatPage=0;markDirty();$('#preview-dialog').close();edit();notice('已导入到编辑器，请保存草稿，再预览发布。',true);};
 }catch(e){notice(e.message);}finally{$('#import-file').value='';}
}
function preview(seats){
 if(!draft.id||dirty){notice('请先保存草稿，再预览发布。');return;}
 $('#preview-title').textContent=seats?'座位表发布预览':'考试安排发布预览';
 $('#preview-content').innerHTML=seats?`<p class="muted">共 ${draft.seats.length} 个座位。选择场次及教室核对座位表。</p><label>场次<select id="preview-exam">${options(draft.sessions.map(s=>[s.id,s.date+' '+s.start+' '+s.title]),'')}</select></label><label>教室<select id="preview-room"></select></label><div id="preview-grid"></div>`:`<p>${esc(draft.title)} · ${draft.start} — ${draft.end}</p><div class="table-scroll"><table><thead><tr><th>日期 / 时间</th><th>考试</th><th>适用</th><th>教室</th></tr></thead><tbody>${sorted(draft.sessions).map(s=>`<tr><td>${s.date}<br>${s.start}–${s.end}</td><td>${esc(s.title)}${s.cancelled?'（已取消）':''}</td><td>${divisions[s.division][0]} ${esc(s.grades.join(' / '))}</td><td>${esc(s.rooms.join(' / '))}</td></tr>`).join('')}</tbody></table></div><p class="warning">时间、教室或取消状态发生变化时，已发布座位表将撤下，需核对后重新发布。</p>`;
 $('#preview-content').insertAdjacentHTML('beforeend',`<p id="publish-error" role="alert" class="import-errors"></p><div class="actions"><button id="publish" class="primary">确认发布${seats?'座位表':'考试安排'}</button></div>`);
 if(seats&&draft.sessions.length){
  const draw=()=>{const s=draft.sessions.find(s=>s.id===$('#preview-exam').value);$('#preview-grid').innerHTML=seatingMarkup({...draft,sessions:roomSlotExams(draft,s,$('#preview-room').value)},draft,s,$('#preview-room').value,null);};
  const rooms=()=>{const s=draft.sessions.find(s=>s.id===$('#preview-exam').value);$('#preview-room').innerHTML=options(s.rooms.map(r=>[r,r]),'');draw();};rooms();$('#preview-exam').onchange=rooms;$('#preview-room').onchange=draw;
 }
 $('#preview-dialog').showModal();$('#publish').onclick=async()=>{$('#publish').disabled=true;try{draft=await api(`/admin/exams/${draft.id}/${seats?'publish-seats':'publish'}`,{method:'POST',body:JSON.stringify({version:draft.version})});await refreshList();$('#preview-dialog').close();edit();notice('发布成功。',true);}catch(e){$('#publish-error').textContent=e.message;}finally{$('#publish').disabled=false;}};
}
$('#new-batch').onclick=()=>{if(dirty&&!confirm('放弃未保存修改？'))return;draft={title:'',titleEn:'',start:'',end:'',sessions:[],rooms:[],seats:[]};dirty=false;edit();};
$('#logout').onclick=async()=>{if(dirty&&!confirm('放弃未保存修改并退出？'))return;try{await api('/logout',{method:'POST'});dirty=false;location.reload();}catch(e){notice(e.message);}};
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
