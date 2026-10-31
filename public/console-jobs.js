// 提取任务 in the console: AI readings run in the background, the page they belong to shows each job as a strip, and
// any administrator can reopen it. Each kind registers how its items look while streaming and how its results are
// reviewed (`registerJobKind`); the strip, the review's progress and the failure handling are shared.
import {$,esc,app,T,tx,api,toast,refreshNav,stamp,loadJobs} from './console-core.js';
import {followJob,reviewView,pagePane} from './ai-review.js';
import {materialPanes,sourcePane} from './material-input.js';

/**
 * @typedef {{name:[string,string],itemKey:string,card:(item:any,index:number)=>string,
 *  show:(result:any,review:any,options:{elapsed?:number|null,job:any})=>void}} JobKind
 */
/** @type {Record<string,JobKind>} */
const kinds={};
/** @param {string} kind @param {JobKind} spec */
export function registerJobKind(kind,spec){kinds[kind]=spec;}
export const jobName=job=>tx(kinds[job.kind]?.name||['提取','Extraction']);

/** The jobs of `kinds` that belong to `scope`. */
export const jobsOf=(scope,...of)=>(app.data.jobs||[]).filter(j=>j.scope===scope&&of.includes(j.kind));
export function putJob(job){const list=app.data.jobs||(app.data.jobs=[]),i=list.findIndex(j=>j.id===job.id);if(i<0)list.unshift(job);else list[i]=job;refreshNav();}
export async function discardJob(job){await api('/admin/extract-jobs/'+encodeURIComponent(job.id),{method:'DELETE'});app.data.jobs=(app.data.jobs||[]).filter(j=>j.id!==job.id);refreshNav();app.rerender();}
/** Starts a job of `kind` (`query` names its scope, e.g. "batch=…"); it replaces the scope's earlier job of that kind. */
export async function startJob(kind,body,query=''){
 const job=await api(`/admin/extract-jobs/${kind}${query?'?'+query:''}`,{method:'POST',body});
 app.data.jobs=(app.data.jobs||[]).filter(j=>j.scope!==job.scope||j.kind!==kind);putJob(job);app.rerender();
 return job;
}

export const jobTag=job=>` <span class="tag ${job.status==='running'?'tag-outline':'tag-accent'} small">${{running:T('提取中','Extracting'),done:T('提取完成 · 待核对','Extracted · review'),failed:T('提取失败','Extraction failed'),interrupted:T('提取中断','Extraction stopped'),cancelled:T('提取已取消','Extraction cancelled')}[job.status]}</span>`;
export function jobStrip(job){
 const by=job.createdBy?T(` · ${job.createdBy} 发起`,` · started by ${job.createdBy}`):'';
 const text={
  running:T(`${jobName(job)}进行中 · 已识别 ${job.items} 条`,`${jobName(job)} running · ${job.items} found`),
  done:T(`${jobName(job)}完成 · ${job.items} 条待核对导入`,`${jobName(job)} finished · ${job.items} to review and import`),
  failed:T(`${jobName(job)}失败：${job.error||''}`,`${jobName(job)} failed: ${job.error||''}`),
  interrupted:T(`${jobName(job)}已中断（服务重启或连接丢失）`,`${jobName(job)} stopped (a restart or a lost connection)`),
  cancelled:T(`${jobName(job)}已取消`,`${jobName(job)} cancelled`)
 }[job.status];
 const button=(act,label,cls='btn-secondary')=>`<button type="button" class="btn ${cls}" data-job="${esc(job.id)}" data-job-act="${act}">${label}</button>`;
 const buttons={
  running:button('open',T('查看进度','View progress'))+button('cancel',T('取消提取','Cancel'),'btn-ghost btn-danger'),
  done:button('discard',T('丢弃','Discard'),'btn-ghost')+button('open',T('查看结果','View results'),'btn-primary'),
 }[job.status]||button('discard',T('丢弃','Discard'),'btn-ghost')+button('open',T('查看','View'))+button('retry',T('重试','Retry'),'btn-primary');
 return `<div class="job-strip ${job.status}" data-job-strip="${esc(job.id)}" role="status"><i class="ai-pulse" aria-hidden="true"></i><div class="clip"><div class="cell-main clip">${esc(text)}</div><div class="cell-sub clip">${esc(job.fileName)} · ${esc(stamp(job.createdAt))}${esc(by)}</div></div><div class="row-actions">${buttons}</div></div>`;
}
/** The strips of `jobs`, stacked; empty when there are none. */
export const jobStrips=jobs=>jobs.length?`<div class="job-strips">${jobs.map(jobStrip).join('')}</div>`:'';

/** While any of `list()` runs and the page is still `here()`, refresh its strip every few seconds. */
export function watchJobs(list,here){
 const running=list().filter(j=>j.status==='running');if(!running.length)return;
 const visit=app.visit;
 setTimeout(async()=>{
  if(app.visit!==visit||!here())return;
  try{await loadJobs();}catch{}
  if(app.visit!==visit||!here())return;
  const jobs=list();
  for(const job of running){
   const next=jobs.find(j=>j.id===job.id);
   if(!next||next.status!==job.status)return app.rerender();
   const strip=$(`[data-job-strip="${CSS.escape(job.id)}"]`);if(strip)strip.outerHTML=jobStrip(next);
  }
  watchJobs(list,here);
 },5000);
}
/** Handles a strip button (`data-job-act` on an element with `data-job`). */
export async function jobAction(target){
 const job=(app.data.jobs||[]).find(j=>j.id===target.dataset.job),act=target.dataset.jobAct;
 if(!job)return;
 try{
  if(act==='open')openJob(job);
  else if(act==='cancel'){putJob(await api(`/admin/extract-jobs/${encodeURIComponent(job.id)}/cancel`,{method:'POST'}));app.rerender();toast(T('已取消提取。','Extraction cancelled.'));}
  else if(act==='discard'){await discardJob(job);toast(T('已丢弃提取结果。','Extraction discarded.'));}
  else if(act==='retry')retryJob(job);
 }catch(error){toast(error.message,{bad:true});}
}
async function retryJob(job,review=null){
 // The open review dialog is reused: closing it first would fire its close event on the new review.
 try{const next=await api(`/admin/extract-jobs/${encodeURIComponent(job.id)}/retry`,{method:'POST'});putJob(next);app.rerender();openJob(next);}
 catch(error){if(review)review.alert(error.message);else toast(error.message,{bad:true});}
}
export const discardButton=job=>job?`<button type="button" class="btn btn-ghost btn-danger left" data-discard>${T('丢弃结果','Discard results')}</button>`:'';
export function bindDiscard(bar,job,review){const button=bar.querySelector('[data-discard]');if(button)button.onclick=async()=>{try{await discardJob(job);review.close();}catch(error){review.alert(error.message);}};}
export const interrupted=n=>T(`提取中断：以下仅为中断前识别的 ${n} 条，其余内容请稍后重试提取或手动补充。`,`Extraction was interrupted: only the ${n} results found before then are shown. Retry later or add the rest by hand.`);

/**
 * Opens the review of a job: replays its progress, then follows it until it ends. Closing only stops watching;
 * the job keeps running on the server. `panes` are the materials' source panes when this page just read them.
 */
export async function openJob(job,{panes=null}={}){
 const kind=kinds[job.kind],key=kind.itemKey,streamed=[];let final=null;
 const review=reviewView({title:`${jobName(job)} · ${job.fileName}`,startedAt:job.startedAt,sourceOf:i=>(final||{[key]:streamed})[key][i]?.source,onClose:()=>app.rerender()});
 const bar=/** @type {any} */(review.actions(`<button type="button" class="btn btn-ghost btn-danger left" data-cancel>${T('取消提取','Cancel extraction')}</button><button type="button" class="btn btn-secondary" data-dismiss>${T('关闭（后台继续）','Close (keeps running)')}</button>`));
 bar.querySelector('[data-dismiss]').onclick=review.close;
 bar.querySelector('[data-cancel]').onclick=async()=>{try{putJob(await api(`/admin/extract-jobs/${encodeURIComponent(job.id)}/cancel`,{method:'POST'}));}catch(error){review.alert(error.message);}};
 // Pasted materials are fetched back to show beside the results; workbooks send their sheets as the job starts.
 // Jobs started before materials could be pasted kept PDF pages as {images, items}.
 if(!panes)try{const input=await api(`/admin/extract-jobs/${encodeURIComponent(job.id)}/input`);panes=input.parts?materialPanes(input.parts):[pagePane(input.images.map((image,i)=>({image,items:input.items?.[i]||[]})))];}catch{}
 panes||=[];
 if(panes.length)review.source(sourcePane(panes));
 try{
  const done=await followJob(job.id,{signal:review.signal,onJob:putJob},message=>{
   review.message(message);
   if(message.type==='source')review.source(sourcePane(panes,message));
   if(message.type==='reset')streamed.length=0;
   if(message.type==='item'&&message.key===key){streamed.push(message.item);review.append(kind.card(message.item,streamed.length-1));}
  });
  final=done.result;
  kind.show(final,review,{elapsed:done.elapsed,job});
 }catch(error){
  if(error.name==='AbortError')return;
  if(error.job)putJob(error.job);
  const partial=error.partial;
  const failed=/** @type {any} */(review.actions(`${discardButton(job)}<button type="button" class="btn btn-secondary" data-dismiss>${T('关闭','Close')}</button>`));
  failed.querySelector('[data-dismiss]').onclick=review.close;bindDiscard(failed,job,review);
  review.error(error.message,{retry:()=>retryJob(job,review),partial:partial&&{count:partial[key].length,use:()=>{final=partial;kind.show({...partial,warnings:[interrupted(partial[key].length),...(partial.warnings||[])]},review,{job});}}});
 }
}
