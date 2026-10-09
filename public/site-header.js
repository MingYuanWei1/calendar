// Both student-facing pages use this header; page scripts bind the existing control IDs.
(() => {
 const header=document.getElementById('site-header');
 if(!header)return;
 const exams=header.dataset.page==='exams';
 const management=header.dataset.page==='management';
 const link=(href,key,zh,en,active)=>`<a href="${href}" data-i18n="${key}" data-zh="${zh}" data-en="${en}"${active?' class="active" aria-current="page"':''}>${zh}</a>`;
 const dateControls=exams
  ? '<div class="date-nav"><button id="previous" aria-label="上一周">‹</button><button id="current">本批次首周</button><button id="next" aria-label="下一周">›</button></div>'
  : '<div class="month-heading"><h1 id="month-title"></h1></div><div class="date-nav"><button id="previous" aria-label="上个月">‹</button><button id="today" data-i18n="today">今天</button><button id="next" aria-label="下个月">›</button></div>';
 const pageActions=exams
  ? '<button id="download" class="primary" disabled>下载 PDF</button>'
  : '<div class="view-switch" aria-label="日历视图"><button id="month-view" aria-pressed="true" data-i18n="monthView">月历</button><button id="week-view" aria-pressed="false" data-i18n="weekView">周历</button><button id="list-view" aria-pressed="false" data-i18n="listView">日程</button></div>';
 header.innerHTML=`<a class="brand" href="/"><img src="/logo.png" alt=""><span data-i18n="brand" data-zh="日历" data-en="Calendar">日历</span></a><nav class="section-nav" aria-label="主要导航">${link('/','calendarNav','校历','Calendar',!exams)}${link('exams.html','examsNav','考试安排','Exams',exams)}</nav><div class="calendar-toolbar"><div class="date-controls">${management?'':dateControls}</div><div class="calendar-actions">${management?'':pageActions}</div></div><div class="header-actions">${management?'':`<div class="subscribe">${exams?'<button id="subscribe-exams" type="button" class="subscribe-button" aria-haspopup="menu" aria-expanded="false" aria-controls="subscribe-menu"></button><div id="subscribe-menu" class="account-menu subscribe-menu" role="menu" hidden><button type="button" role="menuitem" data-feed="exams"></button><button type="button" role="menuitem" data-feed="mine"></button></div>':'<button id="subscribe-calendar" type="button" class="subscribe-button"></button>'}</div>`}${management?'':'<button id="assistant-open" type="button" class="assistant-trigger"></button>'}<button id="language" class="language" aria-label="Switch to English">EN</button><div class="user-menu"><button id="school-account" type="button" disabled aria-expanded="false" aria-controls="account-menu">登录</button><div id="account-menu" class="account-menu" hidden><strong id="account-name"></strong><small id="account-role"></small><a id="account-console" href="/console.html" hidden>管理后台</a><button id="account-logout" type="button">退出登录</button><p id="account-error" role="alert"></p></div></div></div>`;
 const accountButton=/** @type {HTMLButtonElement} */(document.getElementById('school-account'));
 const menu=document.getElementById('account-menu');
 const dialog=document.createElement('dialog');
 dialog.id='account-login-dialog';dialog.className='account-login-dialog';dialog.setAttribute('aria-labelledby','account-login-title');
 dialog.innerHTML=`<div class="account-dialog-top"><h2 id="account-login-title">登录</h2><button id="account-close" type="button" aria-label="关闭 / Close">×</button></div><button id="account-microsoft" type="button" class="microsoft-login">使用 Microsoft 登录</button><p id="account-divider" class="account-divider">或使用账号密码</p><form id="account-login-form"><label><span id="account-username-label">账号</span><input name="username" autocomplete="username" required maxlength="64"></label><label><span id="account-password-label">密码</span><input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><p id="account-login-error" role="alert"></p><button id="account-submit" type="submit" class="primary">登录</button></form>`;
 document.body.append(dialog);
 let session=null;
 const english=()=>document.documentElement.lang.startsWith('en');
 const label=(zh,en)=>english()?en:zh;
 const set=(id,zh,en)=>document.getElementById(id).textContent=label(zh,en);
 function closeMenu(){menu.hidden=true;accountButton.setAttribute('aria-expanded','false');}
 function renderAccount(){
  const user=session?.user;
  if(user&&dialog.open)dialog.close();
  accountButton.textContent=user?Array.from(user.name)[0].toUpperCase():label('登录','Sign in');
  accountButton.classList.toggle('account-avatar',Boolean(user));
  accountButton.title=user?user.name:label('登录','Sign in');
  accountButton.setAttribute('aria-label',user?label('账户菜单：','Account menu: ')+user.name:label('登录','Sign in'));
  document.getElementById('account-name').textContent=user?.name||'';
  document.getElementById('account-role').textContent=({1:'reader',2:'moderator',3:'admin'})[user?.role]||'';
  document.getElementById('account-console').hidden=!(user?.role>=2);
  set('account-console','管理后台','Admin console');
  set('account-logout','退出登录','Sign out');
  set('account-login-title','登录','Sign in');set('account-microsoft','使用 Microsoft 登录','Sign in with Microsoft');
  set('account-divider','或使用账号密码','or use your username and password');set('account-username-label','账号','Username');set('account-password-label','密码','Password');set('account-submit','登录','Sign in');
 }
 async function request(path,options={}){
  const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json'}});
  if(!response.ok){const value=await response.json();throw new Error(value.error||label('操作失败，请重试。','Please retry.'));}
  return response.status===204?null:response.json();
 }
 async function loadSession(){session=await request('/school/session');renderAccount();renderSubscribe();accountButton.disabled=false;}
 async function canLogin(){
  try{await loadSession();if(!session?.user)return true;accountButton.title=label('当前已登录，请先退出登录。','Already signed in. Sign out first.');}
  catch(error){accountButton.title=error.message;document.getElementById('account-login-error').textContent=error.message;}
  return false;
 }
 async function openLogin(){if(!await canLogin())return false;closeMenu();document.getElementById('account-login-error').textContent='';if(!dialog.open)dialog.showModal();return true;}
 accountButton.onclick=()=>{if(!session?.user){openLogin();return;}menu.hidden=!menu.hidden;accountButton.setAttribute('aria-expanded',String(!menu.hidden));};
 document.getElementById('account-close').onclick=()=>dialog.close();
 window.addEventListener('account-login',openLogin);
 document.addEventListener('click',event=>{if(!/** @type {Element} */(event.target).closest('.user-menu'))closeMenu();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){closeMenu();accountButton.focus();}});
 document.getElementById('account-login-form').onsubmit=async event=>{
  event.preventDefault();const button=/** @type {HTMLButtonElement} */(document.getElementById('account-submit'));button.disabled=true;
  try{
   if(!await canLogin())return;
   const values=Object.fromEntries(new FormData(/** @type {HTMLFormElement} */(event.target)));
   await request('/login',{method:'POST',body:JSON.stringify(values)});
   await loadSession();dialog.close();/** @type {HTMLFormElement} */(event.target).reset();
   window.dispatchEvent(new CustomEvent('account-changed',{detail:session}));
  }catch(error){document.getElementById('account-login-error').textContent=error.message;}
  finally{button.disabled=false;}
 };
 document.getElementById('account-microsoft').onclick=async()=>{
  if(!await canLogin())return;
  sessionStorage.setItem('school-login-scroll',JSON.stringify({url:location.pathname+location.search+location.hash,y:scrollY}));
  location.href='/api/school/login?returnTo='+encodeURIComponent(location.pathname+location.search+location.hash);
 };
 document.getElementById('account-logout').onclick=async()=>{
  const event=new Event('account-before-logout',{cancelable:true});if(!window.dispatchEvent(event))return;
  try{await request('/logout',{method:'POST'});location.reload();}catch(error){document.getElementById('account-error').textContent=error.message;}
 };
 new MutationObserver(()=>{renderAccount();renderSubscribe();}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
 const savedScroll=sessionStorage.getItem('school-login-scroll');
 if(savedScroll){sessionStorage.removeItem('school-login-scroll');try{const saved=JSON.parse(savedScroll);if(saved.url===location.pathname+location.search+location.hash)window.addEventListener('load',()=>requestAnimationFrame(()=>scrollTo(0,saved.y)),{once:true});}catch{}}
 if(new URLSearchParams(location.search).has('auth')){
  window.addEventListener('load',async()=>{if(!await openLogin())return;document.getElementById('account-login-error').textContent=label('学校登录未完成，请确认账户可用且 Microsoft SSO 已配置。','School sign-in failed. Check your account and Microsoft SSO configuration.');});
 }
 /* — 日历订阅: the school calendar, all exams, or the signed-in student's own exams, as iCalendar feeds. — */
 const icon='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4"/></svg>';
 const subscribeMenu=document.getElementById('subscribe-menu'),examsButton=document.getElementById('subscribe-exams');
 let feedDialog=null,feeds=null;
 function renderSubscribe(){
  // Each page offers its own feed: the calendar page the school calendar, the exams page all exams or mine.
  const calendarButton=document.getElementById('subscribe-calendar');
  if(calendarButton){
   calendarButton.innerHTML=`${icon}<span>${label('订阅校历','Subscribe')}</span>`;
   // Narrow headers show only the icon, so the name stays available as a tooltip and label.
   calendarButton.title=label('订阅校历到手机或电脑日历','Subscribe to the school calendar');calendarButton.setAttribute('aria-label',calendarButton.title);
  }
  if(!examsButton)return;
  examsButton.title=label('订阅考试：所有考试或我的考试','Subscribe to exams: all or mine');examsButton.setAttribute('aria-label',examsButton.title);
  examsButton.innerHTML=`${icon}<span>${label('订阅考试','Subscribe')}</span><span aria-hidden="true">▾</span>`;
  subscribeMenu.querySelector('[data-feed=exams]').innerHTML=`<strong>${label('所有考试','All exams')}</strong><small>${label('全部已发布的考试场次','Every published exam session')}</small>`;
  subscribeMenu.querySelector('[data-feed=mine]').innerHTML=`<strong>${label('我的考试','My exams')}</strong><small>${session?.user?label('只含我关注的考试，附本人考场与座位','Only the exams I follow, with my room and seat'):label('登录学生账号后可用','Sign in as a student first')}</small>`;
 }
 const closeSubscribe=()=>{if(!examsButton)return;subscribeMenu.hidden=true;examsButton.setAttribute('aria-expanded','false');};
 const feedText={
  calendar:[['订阅校历','Subscribe to the school calendar'],['活动、比赛、截止日与放假调休会自动出现在你的手机或电脑日历中；学校改期或取消后，日历会随之更新。','Events, competitions, deadlines, days off and make-up days appear in your phone or computer calendar and update when the school changes them.']],
  exams:[['订阅所有考试','Subscribe to all exams'],['全部已发布的考试场次，考试时间或考场调整后自动更新。','Every published exam session, updated when times or rooms change.']],
  mine:[['订阅我的考试','Subscribe to my exams'],['只包含“我的考试”中的场次，并附上你的考场和座位；在考试页修改“我的考试”后，日历也会更新。','Only the sessions in “My exams”, with your room and seat; changes you make on the exams page follow.']]
 };
 async function openFeed(kind){
  closeSubscribe();
  if(kind==='mine'&&!session?.user){window.dispatchEvent(new Event('account-login'));return;}
  try{feeds=await request('/feeds');}catch(error){alert(error.message);return;}
  show(kind);
 }
 function show(kind){
  const url=feeds[kind]+(english()?'?lang=en':''),webcal=url.replace(/^https?:/,'webcal:');
  if(!feedDialog){feedDialog=document.createElement('dialog');feedDialog.id='subscribe-dialog';document.body.append(feedDialog);feedDialog.addEventListener('click',event=>{if(event.target===feedDialog)feedDialog.close();});}
  const [title,why]=feedText[kind];
  feedDialog.innerHTML=`<form method="dialog" class="subscribe-head"><h2>${label(...title)}</h2><button aria-label="${label('关闭','Close')}">×</button></form>
   <p>${label(...why)}</p>
   <div class="subscribe-url"><input readonly value="${url.replace(/"/g,'&quot;')}" aria-label="${label('订阅链接','Subscription link')}"><button type="button" data-copy>${label('复制链接','Copy link')}</button></div>
   <div class="subscribe-actions"><a class="primary" href="${webcal.replace(/"/g,'&quot;')}">${label('添加到日历','Add to calendar')}</a><a href="${url.replace(/"/g,'&quot;')}" download>${label('下载 .ics','Download .ics')}</a></div>
   ${kind==='mine'?`<p class="subscribe-warning">${label('这个链接只属于你，含你的座位信息，请勿分享。如已泄露，可','This link is yours alone and includes your seat; do not share it. If it leaks, ')}<button type="button" data-reset>${label('重新生成链接','generate a new link')}</button>${label('，旧链接会立即失效。','; the old one stops working at once.')}</p>`:''}
   <details><summary>${label('如何订阅？','How to subscribe')}</summary><ul>
    <li><b>iPhone / iPad / Mac</b>：${label('点击“添加到日历”，在弹出的窗口中确认订阅。','tap “Add to calendar” and confirm.')}</li>
    <li><b>${label('Google 日历','Google Calendar')}</b>：${label('电脑网页版 → 其他日历“+” → 通过网址添加 → 粘贴链接。','on the web: Other calendars “+” → From URL → paste the link.')}</li>
    <li><b>Outlook</b>：${label('添加日历 → 从网络订阅 → 粘贴链接。','Add calendar → Subscribe from web → paste the link.')}</li>
    <li>${label('华为、小米等手机日历：在“日历账户/订阅”中选择“添加订阅”，粘贴链接。','Other phone calendars: look for “Add subscription” and paste the link.')}</li></ul>
    <p>${label('订阅后日历应用会定期刷新（通常每小时到每天一次）。','Calendar apps refresh subscriptions periodically (usually hourly to daily).')}</p></details>`;
  const input=feedDialog.querySelector('input');
  feedDialog.querySelector('[data-copy]').onclick=async event=>{
   const button=/** @type {HTMLButtonElement} */(event.currentTarget);
   try{await navigator.clipboard.writeText(input.value);}catch{input.select();document.execCommand('copy');}
   button.textContent=label('已复制','Copied');setTimeout(()=>button.textContent=label('复制链接','Copy link'),1600);
  };
  const reset=feedDialog.querySelector('[data-reset]');
  if(reset)reset.onclick=async()=>{try{feeds=await request('/feeds/mine/reset',{method:'POST'});show('mine');}catch(error){alert(error.message);}};
  if(!feedDialog.open)feedDialog.showModal();
 }
 function subscriptions(){
  renderSubscribe();
  const calendarButton=document.getElementById('subscribe-calendar');
  if(calendarButton)calendarButton.onclick=()=>openFeed('calendar');
  if(!examsButton)return;
  examsButton.onclick=()=>{closeMenu();subscribeMenu.hidden=!subscribeMenu.hidden;examsButton.setAttribute('aria-expanded',String(!subscribeMenu.hidden));};
  subscribeMenu.querySelectorAll('[data-feed]').forEach(button=>button.addEventListener('click',()=>openFeed(/** @type {HTMLElement} */(button).dataset.feed)));
  document.addEventListener('click',event=>{if(!/** @type {Element} */(event.target).closest('.subscribe'))closeSubscribe();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!subscribeMenu.hidden){closeSubscribe();examsButton.focus();}});
 }
 subscriptions();
 renderAccount();loadSession().catch(error=>{accountButton.disabled=false;accountButton.title=error.message;});
})();
