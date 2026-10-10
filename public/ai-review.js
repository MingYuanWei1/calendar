// Full-screen review for AI extraction: the source material on the left, results growing on the right as
// the model streams them, and each result linked back to the text or cell it came from.
import {esc,corners,icon,T} from './console-core.js';

/** @typedef {{page?:number|null,quote?:string|null,sheet?:string|null,cell?:string|null}} Source */

/**
 * POSTs to an NDJSON endpoint and calls onMessage for every {type:'stage'|'item'|'source'|'text'|'done'|'error'} line.
 * Resolves with the `done` result; rejects with the server's message on `error` or a failed request.
 * The rejection's `partial` holds the results the server finished before failing, if any.
 * @param {string} path
 * @param {{body?:BodyInit,headers?:Record<string,string>,signal?:AbortSignal}} [options]
 * @param {(message:any)=>void} [onMessage]
 * @returns {Promise<any>}
 */
export async function streamApi(path,{body,headers={},signal}={},onMessage=()=>{}){
 let response;
 const raw=body instanceof Blob;
 try{response=await fetch('/api'+path,{method:'POST',credentials:'same-origin',body,signal,headers:{Accept:'application/x-ndjson',...(raw?{}:{'Content-Type':'application/json'}),...headers}});}
 catch(error){if(error.name==='AbortError')throw error;throw new Error(T('无法连接服务器，请重试。','Unable to connect. Please retry.'));}
 if(!response.ok){const detail=await response.json().catch(()=>({}));throw Object.assign(new Error(detail.error||T('请求失败，请重试。','Request failed. Please retry.')),{partial:detail.partial});}
 const reader=response.body.getReader(),decoder=new TextDecoder();
 let buffer='',result;
 const handle=line=>{
  if(!line.trim())return;
  const message=JSON.parse(line);
  if(message.type==='error')throw Object.assign(new Error(message.error),{partial:message.partial});
  if(message.type==='done')result=message;
  onMessage(message);
 };
 while(true){
  const {done,value}=await reader.read();
  if(done)break;
  buffer+=decoder.decode(value,{stream:true});
  let index;
  while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);handle(line);}
 }
 handle(buffer);
 if(!result)throw new Error(T('连接中断，请重试。','The connection was interrupted. Please retry.'));
 return result;
}

/* — locating a quote inside source text — */
const fold=c=>({'–':'-','—':'-','：':':','，':',','（':'(','）':')'}[c]||c).toLowerCase();
/** Finds `quote` in `text` ignoring whitespace, case and dash/colon variants; returns [start,end) in `text`. */
export function locate(text,quote){
 const keys=[],map=[];
 for(let i=0;i<text.length;i++)if(!/\s/.test(text[i])){keys.push(fold(text[i]));map.push(i);}
 const haystack=keys.join(''),needle=[...String(quote||'')].filter(c=>!/\s/.test(c)).map(fold).join('');
 if(needle.length<2)return null;
 let at=haystack.indexOf(needle),length=needle.length;
 // Models sometimes paraphrase the tail of a quote; fall back to its longest matching prefix.
 for(let n=needle.length-1;at<0&&n>=Math.min(6,needle.length);n--){at=haystack.indexOf(needle.slice(0,n));length=n;}
 return at<0?null:[map[at],map[at+length-1]+1];
}

/* — source panes: each returns {element, highlight(source) → boolean} — */

// The CSP allows blob: but not data: images, so page renders are shown through object URLs.
const objectUrl=dataUrl=>{
 const [head,data]=dataUrl.split(','),bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
 return URL.createObjectURL(new Blob([bytes],{type:/^data:([^;]+)/.exec(head)?.[1]||'image/jpeg'}));
};
/** Rendered PDF pages (or other page images) with their text runs; `first` numbers the first page. */
export function pagePane(pages,{first=1,label=n=>T(`第 ${n} 页`,`Page ${n}`)}={}){
 const element=document.createElement('div');element.className='src-pages';
 element.innerHTML=pages.map((page,i)=>`<figure class="src-page" data-page="${first+i}"><figcaption class="overline">${esc(label(first+i))}</figcaption><div class="src-sheet"><img src="${page.image.startsWith('data:')?objectUrl(page.image):esc(page.image)}" alt="${esc(label(first+i))}"><div class="src-marks"></div></div></figure>`).join('');
 return {element,/** @param {Source} source */highlight(source){const {page,quote}=source||{};
  element.querySelectorAll('.src-active').forEach(el=>el.classList.remove('src-active'));element.querySelectorAll('.src-marks').forEach(el=>el.innerHTML='');
  const figure=element.querySelector(`[data-page="${page}"]`);if(!figure)return false;
  const items=pages[page-first].items||[];
  if(!items.length){figure.classList.add('src-active');figure.scrollIntoView({block:'start',behavior:'smooth'});return 'page';}
  const text=items.map(item=>item.str).join(''),starts=[];let offset=0;for(const item of items){starts.push(offset);offset+=item.str.length;}
  const range=locate(text,quote);
  const hits=range?items.filter((item,i)=>starts[i]<range[1]&&starts[i]+item.str.length>range[0]):[];
  figure.querySelector('.src-marks').innerHTML=hits.map(({box:[x,y,w,h]})=>`<i class="src-mark" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%"></i>`).join('');
  figure.classList.add('src-active');
  (figure.querySelector('.src-mark')||figure).scrollIntoView({block:'center',behavior:'smooth'});
  return Boolean(hits.length);
 }};
}

/** A pasted text block whose quoted span can be marked. */
export function textPane(text,{page=1,label=T('粘贴的文字','Pasted text')}={}){
 const element=document.createElement('figure');element.className='src-page src-text';element.dataset.page=String(page);
 const plain=()=>`<figcaption class="overline">${esc(label)}</figcaption><div class="src-body">${esc(text)}</div>`;
 element.innerHTML=plain();
 return {element,/** @param {Source} source */highlight(source){const {quote}=source||{};
  const range=locate(text,quote);
  element.innerHTML=plain();
  if(range)element.querySelector('.src-body').innerHTML=`${esc(text.slice(0,range[0]))}<mark class="src-hit">${esc(text.slice(range[0],range[1]))}</mark>${esc(text.slice(range[1]))}`;
  element.classList.add('src-active');
  (element.querySelector('.src-hit')||element).scrollIntoView({block:'center',behavior:'smooth'});
  return Boolean(range);
 }};
}

const column=letters=>[...letters].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
const address=cell=>{const m=/^([A-Z]+)(\d+)$/.exec(String(cell||'').toUpperCase().replace(/\$/g,''));return m?{c:column(m[1]),r:Number(m[2])}:null;};
/** Worksheets drawn as grids from {name, merges, cells:[{address,text}]}. */
export function sheetPane(sheets){
 const element=document.createElement('div');element.className='src-pages';
 const owner=new Map();
 element.innerHTML=sheets.map((sheet,s)=>{
  const cells=new Map(sheet.cells.map(cell=>[cell.address,cell.text]));
  const spans=new Map(),hidden=new Set();
  for(const range of sheet.merges||[]){
   const [a,b]=range.split(':').map(address);if(!a||!b)continue;
   spans.set(`${a.r}:${a.c}`,{rows:b.r-a.r+1,cols:b.c-a.c+1});
   for(let r=a.r;r<=b.r;r++)for(let c=a.c;c<=b.c;c++){if(r!==a.r||c!==a.c)hidden.add(`${r}:${c}`);owner.set(`${s}:${r}:${c}`,`${a.r}:${a.c}`);}
  }
  const points=sheet.cells.map(cell=>address(cell.address)).filter(Boolean);
  const rows=Math.max(1,...points.map(p=>p.r)),cols=Math.max(1,...points.map(p=>p.c));
  let html='';
  for(let r=1;r<=rows;r++){
   html+='<tr>';
   for(let c=1;c<=cols;c++){
    if(hidden.has(`${r}:${c}`))continue;
    const span=spans.get(`${r}:${c}`),name=String.fromCharCode(64+c)+r;
    html+=`<td data-cell="${r}:${c}"${span?` rowspan="${span.rows}" colspan="${span.cols}"`:''}>${esc(cells.get(name)||'')}</td>`;
   }
   html+='</tr>';
  }
  return `<figure class="src-page" data-sheet="${s}"><figcaption class="overline">${esc(sheet.name)}</figcaption><div class="src-grid"><table>${html}</table></div></figure>`;
 }).join('');
 return {element,/** @param {Source} source */highlight(source){const {sheet,cell}=source||{};
  element.querySelectorAll('.src-hit').forEach(el=>el.classList.remove('src-hit'));
  const s=sheets.findIndex(item=>item.name===sheet),point=address(cell);
  const figure=element.querySelector(`[data-sheet="${s}"]`);if(!figure||!point)return false;
  const key=owner.get(`${s}:${point.r}:${point.c}`)||`${point.r}:${point.c}`,target=figure.querySelector(`[data-cell="${key}"]`);
  if(!target)return false;
  target.classList.add('src-hit');target.scrollIntoView({block:'center',inline:'center',behavior:'smooth'});
  return true;
 }};
}

/** Several panes shown together, routed by `page` (the material number). */
export function stackPane(panes){
 const element=document.createElement('div');element.className='src-stack';
 for(const pane of panes)element.append(pane.element);
 return {element,/** @param {Source} source @returns {boolean|'page'} */highlight(source={}){
  element.querySelectorAll('.src-active').forEach(el=>el.classList.remove('src-active'));
  element.querySelectorAll('.src-marks').forEach(el=>el.innerHTML='');
  for(const pane of panes)if(pane.element.querySelector?.(`[data-page="${source.page}"]`)||pane.element.dataset?.page===String(source.page))return pane.highlight(source);
  return false;
 }};
}

/* — the review view — */
const stageText=(stage,detail,count)=>({
 preparing:T('正在读取材料…','Reading the material…'),
 connecting:T('正在连接模型…','Connecting to the model…'),
 reading:T(`模型正在阅读材料${detail.pages?`（${detail.pages} 页）`:detail.sheets?`（${detail.sheets} 个工作表）`:''}…`,`The model is reading${detail.pages?` ${detail.pages} page(s)`:detail.sheets?` ${detail.sheets} sheet(s)`:''}…`),
 generating:count?T(`正在识别… 已识别 ${count} 条`,`Extracting… ${count} found`):T('正在识别…','Extracting…'),
 validating:T('正在校验结果…','Checking the results…'),
 retrying:T('模型返回的格式有误，正在自动重试…','The model’s answer was malformed; retrying…'),
 reconnecting:T(`LLM Worker 暂时不可用（${detail.status||'网络错误'}），正在第 ${detail.attempt}/${detail.of} 次重试…`,`The LLM Worker is unavailable (${detail.status||'network error'}); retry ${detail.attempt} of ${detail.of}…`)
})[stage]||stage;

/** A model output item that was not valid, shown instead of being silently dropped. */
const invalidReason=({reason,detail})=>reason==='cut'?T('回答在此处中断','The answer broke off here'):reason==='json'?T('JSON 格式错误','Malformed JSON'):T(`字段不符合要求：${detail||''}`,`Invalid fields: ${detail||''}`);
const invalidCard=entry=>`<div class="ai-card ai-invalid"><span class="ai-card-title">${T('格式不正确 · 未导入','Malformed · not imported')}</span><span class="muted">${esc(invalidReason(entry))}</span><pre>${esc(entry.text)}</pre></div>`;

/**
 * Opens the review view. `sourceOf(index)` returns the source of result `index`, used when a
 * [data-pick] element is clicked. Returns controls for streaming progress and final results.
 * @param {{title:string,sourceOf?:(index:number)=>Source|null|undefined,onClose?:()=>void}} options
 */
export function reviewView({title,sourceOf=()=>null,onClose=()=>{}}){
 let dialog=/** @type {HTMLDialogElement} */(document.getElementById('ai-review'));
 if(!dialog){dialog=document.createElement('dialog');dialog.id='ai-review';document.body.append(dialog);}
 dialog.className='ai-review blueprint';
 dialog.innerHTML=`${corners}<header class="ai-head"><div class="ai-title"><span class="overline">${T('AI 提取 · 核对','AI extraction · Review')}</span><div class="dialog-title">${esc(title)}</div></div>
 <div class="ai-status" role="status" aria-live="polite"><i class="ai-pulse"></i><span data-stage>${esc(stageText('preparing',{},0))}</span><span class="num" data-timer>0.0 s</span></div>
 <button type="button" class="btn btn-ghost btn-icon" data-close aria-label="${T('关闭','Close')}">${icon.close}</button></header>
 <div class="ai-panes"><section class="ai-source" aria-label="${T('原始材料','Source material')}"><div class="ai-pane-head overline">${T('原始材料 · 点击右侧结果可定位','Source · click a result to locate it')}</div><div class="ai-source-body" data-source><p class="muted">${T('正在准备原文…','Preparing the source…')}</p></div></section>
 <section class="ai-results" aria-label="${T('提取结果','Extracted results')}"><div class="ai-pane-head overline" data-count></div><div class="ai-notes" data-notes></div><div class="ai-list" data-list></div></section></div>
 <footer class="ai-foot"><p class="alert bad" role="alert" data-error hidden></p><div class="dialog-actions" data-actions></div></footer>`;
 const q=selector=>/** @type {HTMLElement} */(dialog.querySelector(selector));
 const controller=new AbortController();
 const started=performance.now();let stage='preparing',detail={},count=0,finished=false,pane=null,pickedIndex=-1;
 const timer=window.setInterval(()=>{q('[data-timer]').textContent=((performance.now()-started)/1000).toFixed(1)+' s';},100);
 const close=()=>{window.clearInterval(timer);controller.abort();if(dialog.open)dialog.close();};
 dialog.onclose=()=>{window.clearInterval(timer);controller.abort();onClose();};
 q('[data-close]').onclick=close;
 const updateStage=()=>{q('[data-stage]').textContent=stageText(stage,detail,count);};
 const pick=index=>{
  pickedIndex=index;
  dialog.querySelectorAll('[data-pick].picked').forEach(el=>el.classList.remove('picked'));
  dialog.querySelectorAll(`[data-pick="${index}"]`).forEach(el=>el.classList.add('picked'));
  const source=sourceOf(index);
  const found=source&&pane?pane.highlight(source):false;
  q('[data-source]').dataset.miss=found===true||!source?'':found==='page'?T('图片没有文字层，已定位到所在图片。','Images have no text layer; showing the image it came from.'):T('未能在原文中精确定位，已显示所在页面。','The exact text was not found; showing its page.');
 };
 const choose=event=>{
  const target=/** @type {HTMLElement|null} */(/** @type {HTMLElement} */(event.target).closest('[data-pick]'));
  if(target&&Number(target.dataset.pick)!==pickedIndex)pick(Number(target.dataset.pick));
 };
 q('[data-list]').addEventListener('click',choose);q('[data-list]').addEventListener('focusin',choose);
 if(!dialog.open)dialog.showModal();
 return {
  dialog,signal:controller.signal,close,
  /** Shows the source pane; `next` is a pane from pagePane/textPane/sheetPane/stackPane. */
  source(next){pane=next;q('[data-source]').replaceChildren(next.element);},
  /** Applies one streamed message. */
  message(message){
   if(message.type==='stage'){stage=message.stage;detail=message;updateStage();}
   if(message.type==='item'){count++;stage='generating';updateStage();this.count(T(`已识别 ${count} 条`,`${count} found`));}
   if(message.type==='reset'){count=0;q('[data-list]').innerHTML='';this.count('');}
   if(message.type==='invalid')this.append(invalidCard(message));
  },
  /** Appends a provisional result card while streaming. */
  append(html){q('[data-list]').insertAdjacentHTML('beforeend',html);const last=q('[data-list]').lastElementChild;last?.classList.add('ai-new');last?.scrollIntoView({block:'nearest'});},
  count(text){q('[data-count]').textContent=text;},
  /**
   * Replaces the results with their final, editable form and stops the timer. `invalid` lists the model's
   * malformed items ({text, reason, detail}), shown after the results so they can be added by hand.
   */
  results(html,{notes=[],elapsed=null,preset=false,total=null,invalid=[]}={}){
   finished=true;window.clearInterval(timer);this.alert('');
   dialog.classList.remove('ai-failed');
   const seconds=((elapsed??(performance.now()-started))/1000).toFixed(1);
   dialog.classList.add('ai-done');
   q('[data-stage]').textContent=preset?T('预设结果 · 未调用 LLM','Preset results · the LLM was not called'):T(`完成 · 用时 ${seconds} 秒`,`Done in ${seconds} s`);
   q('[data-timer]').hidden=true;
   if(total!=null)this.count(T(`共 ${total} 条 · 点击任意一条查看原文位置`,`${total} results · click one to see where it came from`));
   q('[data-notes]').innerHTML=(preset?[`<p class="callout">${T('以下为预设结果，未调用 LLM。','These are preset results; the LLM was not called.')}</p>`]:[]).concat(notes.length?[`<div class="callout ai-warnings"><strong>${T('AI 提示','AI notes')}</strong><ul>${notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul></div>`]:[]).join('');
   q('[data-list]').innerHTML=html+(invalid.length?`<section class="ai-invalid-list"><p class="callout">${T(`以下 ${invalid.length} 段模型输出格式不正确，未导入；其余结果不受影响。请对照原文手动补充。`,`${invalid.length} part(s) of the model’s answer were malformed and were not imported; the other results are unaffected. Add them by hand from the source.`)}</p>${invalid.map(invalidCard).join('')}</section>`:'');
  },
  actions(html){q('[data-actions]').innerHTML=html;return q('[data-actions]');},
  /** Shows an inline problem (e.g. a failed save) without ending the review. */
  alert(message){const el=q('[data-error]');el.textContent=message;el.hidden=!message;},
  /**
   * Ends the review with an error. `fallback` offers the preset sample results instead, `partial`
   * ({count, use}) offers the results finished before the failure, and `retry` runs the extraction again.
   */
  error(message,{fallback=null,partial=null,retry=null}={}){
   window.clearInterval(timer);dialog.classList.add('ai-failed');
   q('[data-stage]').textContent=T('提取未完成','Extraction stopped');
   const el=q('[data-error]');el.textContent=message;el.hidden=!message;
   if(partial?.count){
    q('[data-actions]').insertAdjacentHTML('beforeend',`<button type="button" class="btn btn-secondary" data-partial>${T(`先使用已提取的 ${partial.count} 条`,`Use the ${partial.count} found so far`)}</button>`);
    /** @type {HTMLElement} */(q('[data-partial]')).onclick=partial.use;
   }
   if(retry){
    q('[data-actions]').insertAdjacentHTML('beforeend',`<button type="button" class="btn btn-primary" data-retry>${T('重试','Retry')}</button>`);
    /** @type {HTMLElement} */(q('[data-retry]')).onclick=retry;
   }
   if(fallback){
    q('[data-actions]').insertAdjacentHTML('beforeend',`<button type="button" class="btn btn-primary" data-fallback>${T('改用示例的预设结果','Use the sample’s preset results')}</button>`);
    /** @type {HTMLElement} */(q('[data-fallback]')).onclick=()=>{close();fallback();};
   }
  },
  get finished(){return finished;},
  body:dialog
 };
}
