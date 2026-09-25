// Shared state and helpers for the admin console pages.
export const $=selector=>/** @type {any} */(document.querySelector(selector));
export const $$=(selector,root=document)=>/** @type {any[]} */([...root.querySelectorAll(selector)]);
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const corners='<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
export const icon={
 close:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
 plus:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
 search:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
 more:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
 prev:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
 next:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
};

export const app={
 lang:Number(localStorage.getItem('exam-language')||0),
 config:{timeZone:'Asia/Shanghai'},
 user:null,today:'',
 /** Set by a page that holds unsaved input; the router asks before leaving. */
 dirty:false,
 data:{events:null,plans:null,batches:null,subjects:null},
 rerender:()=>{},
 /** Incremented on every route change, so pages can drop state left from an earlier visit. */
 visit:0,
 setLanguage:lang=>{},
 signOut:()=>{},
};
/** Navigate programmatically without prompting (the caller has already saved). */
export function go(hash){app.dirty=false;location.hash=hash;}
/** Ask the sidebar to redraw its counts after data changes. */
export const refreshNav=()=>window.dispatchEvent(new Event('console-counts'));
export const T=(zh,en)=>app.lang?en:zh;
/** Pick the current language from a [zh, en] pair, falling back to the other. */
export const tx=pair=>(pair&&(pair[app.lang]||pair[1-app.lang]))||'';
export const TYPES={exam:['考试','Exam'],competition:['比赛','Competition'],activity:['活动','Activity'],deadline:['截止日','Deadline']};
export const SCOPES={schoolwide:['全校','School-wide'],primary:['小学部','Primary'],middle:['初中部','Middle school'],high:['高中部','High school']};
const WK=[['周一','Mon'],['周二','Tue'],['周三','Wed'],['周四','Thu'],['周五','Fri'],['周六','Sat'],['周日','Sun']];
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONL=['January','February','March','April','May','June','July','August','September','October','November','December'];
export const weekdays=()=>WK.map(w=>w[app.lang]);
const parts=iso=>iso.split('-').map(Number);
/** Monday-first weekday index, 0–6. */
export const dow=iso=>{const [y,m,d]=parts(iso);return (new Date(Date.UTC(y,m-1,d)).getUTCDay()+6)%7;};
export const addDays=(iso,n)=>{const [y,m,d]=parts(iso);return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10);};
export const md=iso=>{const [,m,d]=parts(iso);return app.lang?`${d} ${MON[m-1]}`:`${m}月${d}日`;};
export const mdw=iso=>`${md(iso)} ${WK[dow(iso)][app.lang]}`;
export const monthLabel=(y,m)=>app.lang?`${MONL[m-1]} ${y}`:`${y}年${m}月`;
export function dateRange(a,b){
 if(!b||a===b)return mdw(a);
 const [,m1,d1]=parts(a),[,m2,d2]=parts(b);
 if(m1===m2)return app.lang?`${d1}–${d2} ${MON[m1-1]}`:`${m1}月${d1}日–${d2}日`;
 return `${md(a)} – ${md(b)}`;
}
export function stamp(value){
 if(!value)return '';
 return new Intl.DateTimeFormat('sv-SE',{timeZone:app.config.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
}

export async function api(path,options={}){
 let response;
 const raw=options.body instanceof Blob;
 try{response=await fetch('/api'+path,{credentials:'same-origin',...options,headers:{...(raw?{}:{'Content-Type':'application/json'}),...options.headers}});}
 catch{throw new Error(T('无法连接服务器，已保留输入，请重试。','Unable to connect. Your input is preserved; please retry.'));}
 if(!response.ok){
  const body=await response.json().catch(()=>({}));
  const fallback={401:T('登录已失效，请重新登录。','Your session has expired. Please sign in again.'),403:T('当前账户没有操作权限。','You do not have permission for this action.'),404:T('内容不存在或已被删除。','This item no longer exists.'),409:T('内容已在其他窗口修改，请刷新后再试。','This changed in another window. Refresh and try again.'),413:T('文件过大。','File is too large.')};
  const error=new Error(body.error||fallback[response.status]||T('服务暂时不可用，请重试。','Service unavailable. Please retry.'));
  Object.assign(error,{status:response.status,fields:body.fields});throw error;
 }
 return response.status===204?null:response.json();
}

let toastTimer=0;
/** Show the status toast; `undo` adds an Undo button that runs once. */
export function toast(message,{undo=null,bad=false}={}){
 const el=$('#toast');clearTimeout(toastTimer);
 el.className='toast blueprint'+(bad?' bad':'');
 el.innerHTML=`${corners}<span>${esc(message)}</span>${undo?`<button type="button" class="btn" data-undo>${T('撤销','Undo')}</button>`:''}<button type="button" class="btn solid" data-dismiss>${T('知道了','OK')}</button>`;
 el.hidden=false;
 const hide=()=>{el.hidden=true;clearTimeout(toastTimer);};
 el.querySelector('[data-dismiss]').onclick=hide;
 if(undo)el.querySelector('[data-undo]').onclick=async()=>{hide();try{await undo();}catch(error){toast(error.message,{bad:true});}};
 toastTimer=window.setTimeout(hide,8000);
}

/** Open the shared modal; returns the dialog body for binding handlers. */
export function modal(title,html,{size=''}={}){
 const dialog=$('#console-dialog');
 dialog.className='dialog blueprint'+(size?' '+size:'');
 dialog.innerHTML=`${corners}<div class="dialog-body"><div class="dialog-top"><div class="dialog-title">${esc(title)}</div><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="${T('关闭','Close')}">${icon.close}</button></div>${html}</div>`;
 const body=dialog.querySelector('.dialog-body');
 $$('[data-close]',dialog).forEach(button=>button.onclick=()=>dialog.close());
 dialog.oncancel=event=>{if(dialog.dataset.busy)event.preventDefault();};
 if(!dialog.open)dialog.showModal();
 return body;
}
export const closeModal=()=>$('#console-dialog').close();
/** Run an async dialog action, disabling its controls and reporting errors inline. */
export async function busy(body,action){
 const dialog=body.closest('dialog');
 if(dialog.dataset.busy)return;
 dialog.dataset.busy='1';
 const controls=$$('button,input,select,textarea',body).filter(el=>!el.disabled);controls.forEach(el=>el.disabled=true);
 const error=body.querySelector('[data-error]');if(error){error.hidden=true;error.textContent='';}
 try{await action();}
 catch(e){if(error&&body.isConnected){error.textContent=e.message;error.hidden=false;}else toast(e.message,{bad:true});}
 finally{delete dialog.dataset.busy;controls.forEach(el=>el.disabled=false);}
}
export const errorLine='<p class="alert bad" role="alert" data-error hidden></p>';
export const fail=message=>{throw new Error(message);};

export const statusOf=event=>event.cancelled?'cancelled':event.status||'published';
export const statusTag=status=>status==='published'?'tag tag-accent':status==='draft'?'tag tag-outline':'tag tag-neutral';
export const statusLabel=status=>({published:T('已发布','Published'),draft:T('草稿','Draft'),cancelled:T('已取消','Cancelled')})[status];

export async function loadEvents(){app.data.events=await api('/admin/events');return app.data.events;}
export async function loadPlans(){app.data.plans=Object.fromEntries((await api('/day-plans')).map(plan=>[plan.date,plan]));return app.data.plans;}
export async function loadBatches(){app.data.batches=await api('/admin/exams');return app.data.batches;}
export async function loadSubjects(){app.data.subjects=await api('/exam-subjects');return app.data.subjects;}

/** Group configured day plans into runs of consecutive days with the same setting. */
export function planRanges(plans){
 const ranges=[];
 for(const date of Object.keys(plans).sort()){
  const plan=plans[date],last=ranges.at(-1);
  if(last&&last.kind===plan.kind&&JSON.stringify(last.title)===JSON.stringify(plan.title)&&addDays(last.end,1)===date)last.end=date;
  else ranges.push({start:date,end:date,kind:plan.kind,title:plan.title});
 }
 return ranges;
}
