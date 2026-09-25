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
 header.innerHTML=`<a class="brand" href="/"><img src="/logo.png" alt=""><span data-i18n="brand" data-zh="日历" data-en="Calendar">日历</span></a><nav class="section-nav" aria-label="主要导航">${link('/','calendarNav','校历','Calendar',!exams)}${link('exams.html','examsNav','考试安排','Exams',exams)}</nav><div class="calendar-toolbar"><div class="date-controls">${management?'':dateControls}</div><div class="calendar-actions">${management?'':pageActions}</div></div><div class="header-actions"><button id="language" class="language" aria-label="Switch to English">EN</button><div class="user-menu"><button id="school-account" type="button" disabled aria-expanded="false" aria-controls="account-menu">登录</button><div id="account-menu" class="account-menu" hidden><strong id="account-name"></strong><small id="account-role"></small><a id="account-console" href="/console.html" hidden>管理后台</a><button id="account-logout" type="button">退出登录</button><p id="account-error" role="alert"></p></div></div></div>`;
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
 async function loadSession(){session=await request('/school/session');renderAccount();accountButton.disabled=false;}
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
 new MutationObserver(renderAccount).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
 const savedScroll=sessionStorage.getItem('school-login-scroll');
 if(savedScroll){sessionStorage.removeItem('school-login-scroll');try{const saved=JSON.parse(savedScroll);if(saved.url===location.pathname+location.search+location.hash)window.addEventListener('load',()=>requestAnimationFrame(()=>scrollTo(0,saved.y)),{once:true});}catch{}}
 if(new URLSearchParams(location.search).has('auth')){
  window.addEventListener('load',async()=>{if(!await openLogin())return;document.getElementById('account-login-error').textContent=label('学校登录未完成，请确认账户可用且 Microsoft SSO 已配置。','School sign-in failed. Check your account and Microsoft SSO configuration.');});
 }
 renderAccount();loadSession().catch(error=>{accountButton.disabled=false;accountButton.title=error.message;});
})();
