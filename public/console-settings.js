import {esc,corners,app,T} from './console-core.js';

export function showSettings(main){
 const roles={1:'reader',2:'moderator',3:'admin'};
 main.innerHTML=`<div class="page narrow">
 <header class="page-head"><div><div class="kicker">${T('管理后台','Admin console')}</div><h1>${T('设置','Settings')}</h1></div></header>
 <section class="panel blueprint">${corners}<h4>${T('学校信息','School profile')}</h4><div class="kv">
  <span>${T('时区','Time zone')}</span><span class="mono">${esc(app.config.timeZone)}</span>
  <span>${T('站点地址','Site address')}</span><span class="mono">${esc(location.origin)}</span></div>
  <p class="hint" style="margin-top:14px;font-size:12px;color:var(--color-neutral-700)">${T('以上由服务器 .env 配置，修改后需重启服务。','Set in the server .env; restart the service after changes.')}</p></section>
 <section class="panel blueprint">${corners}<h4>${T('当前账户','Your account')}</h4><div class="kv">
  <span>${T('账户','Account')}</span><span>${esc(app.user.name)}</span>
  <span>${T('角色','Role')}</span><span>${app.user.role} · ${roles[app.user.role]}</span>
  <span>${T('界面语言','Language')}</span><div class="seg" style="width:max-content"><button type="button" data-lang="0" aria-pressed="${!app.lang}">中文</button><button type="button" data-lang="1" aria-pressed="${!!app.lang}">English</button></div></div>
  <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">${app.user.role===3?`<a class="btn btn-secondary" href="#accounts">${T('账户管理','Manage accounts')}</a>`:''}<a class="btn btn-secondary" href="/students.html">${T('学生管理','Students')}</a><button type="button" class="btn btn-secondary" data-sign-out>${T('退出登录','Sign out')}</button></div></section>
 </div>`;
 main.querySelectorAll('[data-lang]').forEach(button=>button.onclick=()=>app.setLanguage(Number(button.dataset.lang)));
 main.querySelector('[data-sign-out]').onclick=()=>app.signOut();
}
