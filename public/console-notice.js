// 通知转日程: paste a notice or add screenshots / PDFs, let the LLM propose new events, reschedules,
// cancellations and day plans, review them beside the source, then apply them through the usual APIs.
import {$$,esc,app,T,tx,TYPES,SCOPES,api,toast,modal,closeModal,busy,errorLine,fail,refreshNav,mdw,loadEvents,loadPlans} from './console-core.js';
import {readExamPdf} from './exam-pdf-input.js';
import {streamApi,reviewView,pagePane,textPane,stackPane} from './ai-review.js';
import {divisionOf,gradeLabel} from './grades.mjs';

const ACTIONS={create:['新增事件','New event'],reschedule:['改期','Reschedule'],cancel:['取消','Cancel'],dayPlan:['放假与调休','School day']};
const KINDS={off:['放假','Day off'],school:['调休上课','Make-up school day'],half:['半天','Half day']};
const WEEKDAYS=[['周一','Monday'],['周二','Tuesday'],['周三','Wednesday'],['周四','Thursday'],['周五','Friday']];

/** Mirrors the editor: deadline, multi-day, timed or all-day. */
const timeModeOf=({type,start,end,time,endTime})=>type==='deadline'?'deadline':end&&end!==start?'multi':time||endTime?'timed':'allDay';
const when=({start,end,time,endTime})=>`${start?mdw(start):'?'}${end&&end!==start?' – '+mdw(end):''}${time?' · '+time+(endTime?'–'+endTime:''):''}`;

/** Downscales an image file to a JPEG data URL (long side ≤ 1800 px), like the PDF page renders. */
async function imageData(file){
 const bitmap=await createImageBitmap(file),scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
 const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
 canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 return canvas.toDataURL('image/jpeg',.85);
}

export function noticeDialog(){
 let files=[];
 const body=modal(T('从通知生成日程','Turn a notice into calendar changes'),`<p class="muted" style="font-size:13px;line-height:1.7">${T('粘贴公众号文章或通知文字，也可以加入截图、照片或 PDF。AI 会识别新增活动、已有事件的改期或取消，以及放假与调休；核对后再保存，不会自动发布。','Paste a notice, or add screenshots, photos or PDFs. The AI finds new events, reschedules or cancellations of existing events, and school-day changes; you review everything before it is saved.')}</p>
 <textarea class="input" rows="8" data-text placeholder="${T('在此粘贴通知文字…','Paste the notice text here…')}" aria-label="${T('通知文字','Notice text')}"></textarea>
 <label class="dropzone" data-drop><span>${T('拖入通知截图、照片或 PDF（可多选），或点击选择','Drop screenshots, photos or PDFs (several allowed), or click to choose')}</span><input type="file" multiple accept="image/png,image/jpeg,image/webp,.pdf,application/pdf" aria-label="${T('通知文件','Notice files')}"></label>
 <div class="list-box" data-files hidden></div>
 <p class="alert" data-progress hidden></p>${errorLine}
 <div class="dialog-actions"><button type="button" class="btn btn-secondary" data-close>${T('返回','Go back')}</button><button type="button" class="btn btn-primary" data-save>${T('开始识别','Extract')}</button></div>`,{size:'medium'});
 const text=/** @type {HTMLTextAreaElement} */(body.querySelector('[data-text]')),zone=body.querySelector('[data-drop]'),list=body.querySelector('[data-files]');
 const progress=message=>{const el=body.querySelector('[data-progress]');el.textContent=message;el.hidden=!message;};
 const showFiles=()=>{list.hidden=!files.length;list.innerHTML=files.map((f,i)=>`<div><span>${esc(f.name)}</span><button type="button" class="btn btn-ghost" data-remove="${i}">${T('移除','Remove')}</button></div>`).join('');};
 const add=chosen=>{
  for(const file of chosen){
   if(!/^image\/(png|jpeg|webp)$/.test(file.type)&&!/\.pdf$/i.test(file.name)){toast(T(`不支持的文件：${file.name}`,`Unsupported file: ${file.name}`),{bad:true});continue;}
   if(file.size>20*1024*1024){toast(T(`${file.name} 超过 20 MB。`,`${file.name} is larger than 20 MB.`),{bad:true});continue;}
   files.push(file);
  }
  showFiles();
 };
 zone.querySelector('input').onchange=e=>{add([...e.target.files]);e.target.value='';};
 zone.ondragover=e=>{e.preventDefault();zone.classList.add('over');};zone.ondragleave=()=>zone.classList.remove('over');
 zone.ondrop=e=>{e.preventDefault();zone.classList.remove('over');add([...e.dataTransfer.files]);};
 list.onclick=e=>{const button=e.target.closest('[data-remove]');if(button){files.splice(Number(button.dataset.remove),1);showFiles();}};
 api('/admin/notice-extract').then(status=>{if(!status.configured){const el=body.querySelector('[data-error]');el.textContent=T('尚未配置 LLM_WORKER_URL 和 LLM_WORKER_TOKEN，请配置后重启服务。','LLM_WORKER_URL and LLM_WORKER_TOKEN are not configured. Configure them and restart the service.');el.hidden=false;}}).catch(()=>{});
 body.querySelector('[data-save]').onclick=()=>busy(body,async()=>{
  const pasted=text.value.trim();
  if(!pasted&&!files.length)fail(T('请粘贴通知文字或添加文件。','Paste the notice or add a file.'));
  // Every material gets a number; the model cites it as source.page and the left pane is keyed by it.
  const parts=[],panes=[];
  if(pasted){parts.push({kind:'text',text:pasted});panes.push(textPane(pasted,{page:1,label:T('材料 1 · 粘贴的文字','Material 1 · Pasted text')}));}
  try{
   for(const file of files){
    const first=parts.length+1;
    if(/\.pdf$/i.test(file.name)){
     const pdf=await readExamPdf(file,message=>progress(`${file.name} · ${message}`));
     pdf.pages.forEach(page=>parts.push({kind:'image',image:page.image,text:page.items.map(item=>item.str).join(' ').slice(0,20000)}));
     panes.push(pagePane(pdf.pages,{first,label:n=>T(`材料 ${n} · ${file.name} 第 ${n-first+1} 页`,`Material ${n} · ${file.name} p.${n-first+1}`)}));
    }else{
     progress(T(`正在读取 ${file.name}…`,`Reading ${file.name}…`));
     const image=await imageData(file);parts.push({kind:'image',image,text:''});
     panes.push(pagePane([{image,items:[]}],{first,label:n=>T(`材料 ${n} · ${file.name}`,`Material ${n} · ${file.name}`)}));
    }
    if(parts.length>12)fail(T('最多 12 份材料（PDF 每页算一份），请减少文件。','At most 12 materials (each PDF page counts); remove some files.'));
   }
  }finally{progress('');}
  closeModal();
  await extractNotice(parts,stackPane(panes));
 });
}

const provisional=(item,i)=>{
 const title=item.action==='dayPlan'?(item.dayPlan?.title?.zh||tx(KINDS[item.dayPlan?.kind]||KINDS.off)):(item.event?.title?.zh||item.event?.title?.en||item.source?.quote||'');
 const dates=item.action==='dayPlan'?item.dayPlan||{}:item.event||{};
 return `<div class="ai-card" data-pick="${i}" tabindex="0"><span class="ai-card-title"><span class="tag tag-outline small">${esc(tx(ACTIONS[item.action]||ACTIONS.create))}</span> ${esc(title)}</span><span class="muted num">${esc(dates.start?when(dates):'')}</span></div>`;
};

async function extractNotice(parts,pane){
 const streamed=[];let final=null;
 const review=reviewView({title:T('从通知生成日程','Turn a notice into calendar changes'),sourceOf:i=>(final||{items:streamed}).items[i]?.source});
 review.source(pane);
 const close=/** @type {HTMLElement} */(review.actions(`<button type="button" class="btn btn-secondary" data-dismiss>${T('关闭','Close')}</button>`).querySelector('[data-dismiss]'));close.onclick=review.close;
 try{
  const done=await streamApi('/admin/notice-extract',{body:JSON.stringify({parts}),signal:review.signal},message=>{
   review.message(message);
   if(message.type==='reset')streamed.length=0;
   if(message.type==='item'&&message.key==='items'){streamed.push(message.item);review.append(provisional(message.item,streamed.length-1));}
  });
  final=done.result;
  showResults(final,review,{elapsed:done.elapsed});
 }catch(error){if(error.name!=='AbortError')review.error(error.message);}
}

/* — review cards — */
const input=(name,value,attrs='',label='')=>`<label class="notice-field"><span>${esc(label)}</span><input class="input" name="${name}" value="${esc(value??'')}" ${attrs}></label>`;
const select=(name,options,value,label)=>`<label class="notice-field"><span>${esc(label)}</span><select class="input" name="${name}">${options.map(([v,text])=>`<option value="${esc(v)}"${String(v)===String(value??'')?' selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
function card(item,i){
 const head=`<div class="notice-head"><input type="checkbox" name="include" checked aria-label="${T('应用此项','Apply this item')}"><span class="tag ${item.action==='cancel'?'tag-neutral':'tag-accent'}">${esc(tx(ACTIONS[item.action]))}</span>`;
 const problems=item.problems?.length?`<p class="alert bad notice-problem">${T('需要补充：','Needs attention: ')}${esc(item.problems.join('；'))}</p>`:'';
 const note=item.note?`<p class="muted notice-note">${esc(item.note)}</p>`:'';
 let fields='';
 if(item.action==='create'){
  const e=item.event;
  fields=`${head}<strong>${esc(e.title[0]||e.title[1])}</strong></div><div class="notice-grid">
  ${input('titleZh',e.title[0],'',T('中文名称','Chinese title'))}${input('titleEn',e.title[1],'',T('英文名称','English title'))}
  ${select('type',Object.keys(TYPES).map(k=>[k,tx(TYPES[k])]),e.type,T('类型','Type'))}
  ${input('start',e.start,'type="date"',T('日期','Date'))}${input('end',e.end||'','type="date"',T('结束日期（跨日）','End date (multi-day)'))}
  ${input('time',e.time||'','type="time"',e.type==='deadline'?T('截止时间','Due time'):T('开始时间','Start'))}${input('endTime',e.endTime||'','type="time"',T('结束时间','End'))}
  ${input('locationZh',e.location[0],'',T('地点','Place'))}${input('locationEn',e.location[1],'',T('英文地点','Place (English)'))}
  <fieldset class="notice-scope"><legend>${T('适用范围','Audience')}</legend>${Object.keys(SCOPES).map(k=>`<label><input type="checkbox" name="scope" value="${k}"${e.scope.includes(k)?' checked':''}> ${esc(tx(SCOPES[k]))}</label>`).join('')}</fieldset>
  <fieldset class="notice-scope"><legend>${T('年级（不选即整个学部）','Grades (none = whole division)')}</legend>${Array.from({length:12},(_,i)=>i+1).map(g=>`<label><input type="checkbox" name="grade" value="${g}"${(e.grades||[]).includes(g)?' checked':''}> ${gradeLabel(g,app.lang)}</label>`).join('')}</fieldset></div>
  ${e.description[0]||e.description[1]?`<p class="muted notice-note">${esc(tx(e.description))}</p>`:''}`;
 }else if(item.action==='reschedule'){
  const t=item.target,c=item.change;
  fields=`${head}<strong>${esc(tx(t.title))}</strong></div><p class="notice-diff"><span class="struck">${esc(when(t))}</span> → <span>${esc(when(c))}</span></p><div class="notice-grid">
  ${input('start',c.start,'type="date"',T('新日期','New date'))}${input('end',c.end,'type="date"',T('新结束日期（跨日）','New end date'))}${input('time',c.time,'type="time"',T('开始时间','Start'))}${t.type==='deadline'?'':input('endTime',c.endTime,'type="time"',T('结束时间','End'))}</div>
  <p class="muted notice-note">${T('保存后学生会看到“改期”标记和原时间。','Students will see it marked as rescheduled, with the original time.')}</p>`;
 }else if(item.action==='cancel'){
  const t=item.target;
  fields=`${head}<strong>${esc(tx(t.title))}</strong></div><p class="notice-diff">${esc(when(t))}</p><div class="notice-grid">${input('reason',item.cancelReason,'maxlength="2000" style="grid-column:1/-1"',T('取消原因（学生可见）','Reason shown to students'))}</div>`;
 }else{
  const p=item.dayPlan;
  fields=`${head}<strong>${esc(p.title[0]||tx(KINDS[p.kind]))}</strong></div><div class="notice-grid">
  ${select('kind',Object.keys(KINDS).map(k=>[k,tx(KINDS[k])]),p.kind,T('安排','Setting'))}${select('follows',[['',T('不指定','Not set')],...WEEKDAYS.map((w,n)=>[n+1,T(`按${w[0]}课表`,`${w[1]} timetable`)])],p.follows||'',T('执行课表','Timetable'))}
  ${input('start',p.start,'type="date"',T('开始日期','From'))}${input('end',p.end,'type="date"',T('结束日期','To'))}
  ${input('titleZh',p.title[0],'maxlength="60"',T('名称','Label'))}${input('titleEn',p.title[1],'maxlength="60"',T('英文名称','Label (English)'))}</div>`;
 }
 return `<div class="ai-card notice-card" data-pick="${i}" data-item="${i}">${fields}${note}${problems}<p class="alert bad" data-item-error hidden></p></div>`;
}

function showResults(result,review,{elapsed=null}={}){
 const items=result.items;
 review.results(items.length?items.map(card).join(''):`<p class="muted">${T('通知中没有识别到日程变化。','No calendar changes were found in this notice.')}</p>`,{notes:result.warnings||[],elapsed,total:items.length});
 const bar=review.actions(`<button type="button" class="btn btn-secondary" data-dismiss>${T('返回','Go back')}</button><button type="button" class="btn btn-secondary" data-apply="draft"${items.length?'':' disabled'}>${T('应用，新事件存为草稿','Apply, new events as drafts')}</button><button type="button" class="btn btn-primary" data-apply="publish"${items.length?'':' disabled'}>${T('核对无误，应用并发布','Apply and publish')}</button>`);
 bar.querySelector('[data-dismiss]').onclick=review.close;
 bar.querySelectorAll('[data-apply]').forEach(button=>button.onclick=()=>apply(items,review,button.dataset.apply==='publish'));
}

async function apply(items,review,publish){
 const buttons=$$('[data-apply],[data-dismiss]',review.body);buttons.forEach(b=>b.disabled=true);review.alert('');
 const cards=$$('[data-item]',review.body).filter(c=>c.querySelector('[name=include]').checked&&!c.dataset.applied);
 let applied=0,failed=0;
 try{
  if(!cards.length)fail(T('请至少勾选一项。','Tick at least one item.'));
  const events=await loadEvents();
  for(const el of cards){
   const item=items[Number(el.dataset.item)],get=name=>el.querySelector(`[name=${name}]`)?.value.trim()??'';
   const error=el.querySelector('[data-item-error]');error.hidden=true;
   try{
    if(item.action==='create'){
     const scope=$$('[name=scope]:checked',el).map(box=>box.value),type=get('type'),start=get('start'),end=get('end'),time=get('time'),endTime=type==='deadline'?'':get('endTime');
     const event={title:[get('titleZh'),get('titleEn')],type,start,end:end&&end!==start?end:undefined,time:time||undefined,endTime:endTime||undefined,scope:scope.includes('schoolwide')||!scope.length?['schoolwide']:scope,grades:$$('[name=grade]:checked',el).map(box=>Number(box.value)).filter(g=>scope.includes(divisionOf(g))),location:[get('locationZh'),get('locationEn')],host:['',''],description:item.event.description,status:publish?'published':'draft'};
     await api('/admin/events',{method:'POST',body:JSON.stringify({...event,timeMode:timeModeOf(event)})});
    }else if(item.action==='dayPlan'){
     const kind=get('kind');
     await api('/admin/day-plans',{method:'PUT',body:JSON.stringify({start:get('start'),end:get('end')||get('start'),kind,title:[get('titleZh'),get('titleEn')],follows:kind!=='off'&&get('follows')?Number(get('follows')):null})});
    }else{
     const existing=events.find(e=>e.id===item.target.id);
     if(!existing)fail(T('该事件已被删除。','This event no longer exists.'));
     if(item.action==='cancel')await api(`/admin/events/${encodeURIComponent(existing.id)}/cancel`,{method:'POST',body:JSON.stringify({version:existing.version,reason:get('reason')})});
     else{
      const start=get('start'),end=get('end'),time=get('time'),endTime=existing.type==='deadline'?'':get('endTime');
      const next={...existing,start,end:end&&end!==start?end:undefined,time:time||undefined,endTime:endTime||undefined};
      await api(`/admin/events/${encodeURIComponent(existing.id)}`,{method:'PUT',body:JSON.stringify({...next,timeMode:timeModeOf(next)})});
     }
    }
    el.dataset.applied='1';el.classList.add('notice-done');el.querySelector('[name=include]').disabled=true;applied++;
   }catch(e){
    failed++;
    error.textContent=e.fields?.length?e.fields.map(f=>`${f.field}: ${f.message}`).join('；'):e.message;error.hidden=false;
   }
  }
  await Promise.all([loadEvents(),loadPlans()]);refreshNav();app.rerender();
  if(!failed){review.close();toast(publish?T(`已应用 ${applied} 项变更，新事件已发布。`,`Applied ${applied} changes; new events are published.`):T(`已应用 ${applied} 项变更，新事件已存为草稿。`,`Applied ${applied} changes; new events are saved as drafts.`));}
  else review.alert(T(`已应用 ${applied} 项，${failed} 项未能保存，请修改后重试。`,`${applied} applied, ${failed} could not be saved. Fix them and try again.`));
 }catch(e){review.alert(e.message);}
 finally{buttons.forEach(b=>b.disabled=false);}
}
