// Both student-facing pages use this header; page scripts bind the existing control IDs.
(() => {
 const header=document.getElementById('site-header');
 if(!header)return;
 const exams=header.dataset.page==='exams';
 const link=(href,key,zh,en,active)=>`<a href="${href}" data-i18n="${key}" data-zh="${zh}" data-en="${en}"${active?' class="active" aria-current="page"':''}>${zh}</a>`;
 const dateControls=exams
  ? '<div class="date-nav"><button id="previous" aria-label="上一周">‹</button><button id="current">本批次首周</button><button id="next" aria-label="下一周">›</button></div>'
  : '<div class="month-heading"><h1 id="month-title"></h1></div><div class="date-nav"><button id="previous" aria-label="上个月">‹</button><button id="today" data-i18n="today">今天</button><button id="next" aria-label="下个月">›</button></div>';
 const pageActions=exams
  ? '<button id="download" class="primary" disabled>下载 PDF</button>'
  : '<div class="view-switch" aria-label="日历视图"><button id="month-view" aria-pressed="true" data-i18n="monthView">月历</button><button id="week-view" aria-pressed="false" data-i18n="weekView">周历</button><button id="list-view" aria-pressed="false" data-i18n="listView">日程</button></div>';
 const account=exams
  ? '<a class="header-manage" href="exams-admin.html" data-zh="考试管理" data-en="Manage exams">考试管理</a>'
  : '<label class="search"><span class="search-label" data-i18n="searchLabel">搜索</span><input id="search" type="search" placeholder="搜索事件" aria-label="搜索事件"></label><button id="admin-entry" type="button">管理事件</button>';
 header.innerHTML=`<a class="brand" href="/"><span class="logo" aria-label="学校 Logo 占位符">LOGO</span><span><strong data-i18n="school" data-school-name>学校校历</strong><span class="brand-sub">CAMPUS CALENDAR</span></span></a><nav class="section-nav" aria-label="主要导航">${link('/','calendarNav','校历','Calendar',!exams)}${link('exams.html','examsNav','考试安排','Exams',exams)}</nav><div class="calendar-toolbar"><div class="date-controls">${dateControls}</div><div class="calendar-actions">${pageActions}</div></div><div class="header-actions">${account}<button id="language" class="language" aria-label="Switch to English">EN</button><button id="school-account" type="button" disabled>登录</button></div>`;
 const accountButton=/** @type {HTMLButtonElement} */(document.getElementById('school-account'));
 let session=null;
 const english=()=>document.documentElement.lang.startsWith('en');
 function renderAccount(){
  accountButton.textContent=session?.user?(english()?'Sign out':'登出'):(english()?'Sign in':'登录');
  accountButton.title=session?.preview?(english()?'Local preview account — Microsoft SSO bypassed':'本地体验账号 · 已跳过 Microsoft SSO'):session?.user?.name||(english()?'Sign in with your school Microsoft account':'使用学校 Microsoft 账号登录');
 }
 async function loadSession(){
  const response=await fetch('/api/school/session');
  if(!response.ok)throw new Error(english()?'Unable to check sign-in status. Please retry.':'暂时无法获取登录状态，请重试。');
  session=await response.json();
  renderAccount();
 }
 new MutationObserver(renderAccount).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
 accountButton.onclick=async()=>{
  accountButton.disabled=true;
  try{
   if(!session)await loadSession();
   if(!session.user){
    sessionStorage.setItem('school-login-scroll',JSON.stringify({url:location.pathname+location.search+location.hash,y:scrollY}));
    location.href='/api/school/login?returnTo='+encodeURIComponent(location.pathname+location.search+location.hash);return;
   }
   const response=await fetch('/api/school/logout',{method:'POST'});
   if(!response.ok)throw new Error(english()?'Sign-out failed. Please retry.':'登出失败，请重试。');
   location.reload();
  }catch(error){alert(error.message);}
  finally{accountButton.disabled=false;}
 };
 const savedScroll=sessionStorage.getItem('school-login-scroll');
 if(savedScroll){
  sessionStorage.removeItem('school-login-scroll');
  try{const saved=JSON.parse(savedScroll);if(saved.url===location.pathname+location.search+location.hash)window.addEventListener('load',()=>requestAnimationFrame(()=>scrollTo(0,saved.y)),{once:true});}catch{}
 }
 if(!exams&&new URLSearchParams(location.search).has('auth')){
  const unconfigured=new URLSearchParams(location.search).get('auth')==='unconfigured';
  window.addEventListener('load',()=>alert(unconfigured?(english()?'Microsoft SSO is not configured.':'学校 Microsoft SSO 尚未配置，请联系管理员。'):(english()?'Sign-in failed. Please retry.':'登录未完成，请重试。')),{once:true});
 }
 renderAccount();
 loadSession().catch(error=>{accountButton.title=error.message;}).finally(()=>{accountButton.disabled=false;});
})();
