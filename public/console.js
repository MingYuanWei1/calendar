import {$,$$,esc,app,T,api,toast,loadEvents,loadPlans,loadBatches,planRanges} from './console-core.js';
import {showEvents,showEditor} from './console-events.js';
import {showDays} from './console-days.js';
import {showExams,showBatch} from './console-exams.js';
import {showSettings} from './console-settings.js';
import {showAccounts,accountCount,loadAccounts} from './console-accounts.js';

const navIcons={
 events:'<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
 days:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
 exams:'<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
 accounts:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
 settings:'<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
};
let route=['events'],current='';

function renderNav(){
 const {events,plans,batches}=app.data;
 const counts={events:events?.length,days:plans&&planRanges(plans).length,exams:batches?.length,accounts:accountCount()};
 const labels={events:T('事件','Events'),days:T('放假与调休','School days'),exams:T('考试','Exams'),...(app.user?.role===3?{accounts:T('账户','Accounts')}:{}),settings:T('设置','Settings')};
 $('#console-nav').innerHTML=`<a class="brand" href="/"><img src="/logo.png" alt=""><span><strong>${T('日历','Calendar')}</strong><span class="overline">${T('管理后台','Admin console')}</span></span></a>
 <nav class="nav-links">${Object.keys(labels).map(key=>`<a href="#${key}"${route[0]===key?' aria-current="page"':''}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${navIcons[key]}</svg><span>${labels[key]}</span>${counts[key]!==undefined?`<span class="count">${counts[key]}</span>`:''}</a>`).join('')}</nav>
 <div class="nav-foot"><div class="seg" role="group" aria-label="${T('界面语言','Language')}"><button type="button" data-lang="0" aria-pressed="${!app.lang}">中文</button><button type="button" data-lang="1" aria-pressed="${!!app.lang}">EN</button></div><a href="/">← ${T('公共校历','Public calendar')}</a><div class="nav-user"><span title="${esc(app.user?.name)}">${esc(app.user?.name)}</span><button type="button" class="btn btn-ghost" data-sign-out style="font-size:13px">${T('退出登录','Sign out')}</button></div></div>`;
 $$('[data-lang]').forEach(button=>button.onclick=()=>setLanguage(Number(button.dataset.lang)));
 $('[data-sign-out]').onclick=signOut;
}
function setLanguage(lang){
 app.lang=lang;localStorage.setItem('exam-language',String(lang));
 document.documentElement.lang=lang?'en':'zh-CN';
 document.title=T('管理后台 · 日历','Admin console · Calendar');
 renderNav();app.rerender();
}
async function signOut(){
 if(app.dirty&&!confirm(T('尚有未保存的内容，确定退出？','You have unsaved changes. Sign out anyway?')))return;
 try{await api('/logout',{method:'POST'});app.dirty=false;location.href='/';}catch(error){toast(error.message,{bad:true});}
}

async function navigate(){
 const hash=location.hash.slice(1)||'events';
 if(hash===current)return;
 if(app.dirty&&!confirm(T('尚有未保存的内容，确定离开？','You have unsaved changes. Leave this page?'))){history.replaceState(null,'','#'+current);return;}
 app.dirty=false;current=hash;app.visit++;
 route=hash.split('/').map(decodeURIComponent);
 if(!['events','days','exams','settings',...(app.user.role===3?['accounts']:[])].includes(route[0]))route=['events'];
 $('#console-dialog').open&&$('#console-dialog').close();
 renderNav();
 const main=$('#console-main');main.scrollTop=0;
 const show={events:()=>route[1]?showEditor(main,route[1]):showEvents(main),days:()=>showDays(main),exams:()=>route[1]?showBatch(main,route[1]):showExams(main),accounts:()=>showAccounts(main),settings:()=>showSettings(main)}[route[0]];
 app.rerender=()=>show();
 try{await show();}catch(error){main.innerHTML=`<p class="load-error">${esc(error.message)}</p>`;}
 renderNav();
}
window.addEventListener('console-counts',renderNav);
window.addEventListener('hashchange',navigate);
window.addEventListener('beforeunload',event=>{if(app.dirty){event.preventDefault();event.returnValue='';}});
document.addEventListener('click',event=>{if(!/** @type {Element} */(event.target).closest('#preview-dialog'))return;if(/** @type {Element} */(event.target).closest('#close-preview'))$('#preview-dialog').close();});

async function start(){
 app.setLanguage=setLanguage;app.signOut=signOut;
 const session=await api('/session');
 if(!(session.user?.role>=2)){document.body.hidden=true;location.replace('/');return;}
 app.user=session.user;
 app.config=await api('/config');
 app.today=new Intl.DateTimeFormat('en-CA',{timeZone:app.config.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 setLanguage(app.lang);
 await navigate();
 // Sidebar counts for sections not yet visited.
 await Promise.allSettled([app.data.events||loadEvents(),app.data.plans||loadPlans(),app.data.batches||loadBatches(),app.user.role===3&&accountCount()===undefined?loadAccounts():null]);
 renderNav();
}
start().catch(error=>{$('#console-main').innerHTML=`<p class="load-error">${esc(error.message)}</p>`;});
