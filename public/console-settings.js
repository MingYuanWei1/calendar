import {esc,corners,app,T,tx,api,toast,errorLine} from './console-core.js';

export function showSettings(main){
 const roles={1:'reader',2:'moderator',3:'admin'};
 main.innerHTML=`<div class="page narrow">
 <header class="page-head"><div><div class="kicker">${T('管理后台','Admin console')}</div><h1>${T('设置','Settings')}</h1></div></header>
 <section class="panel blueprint">${corners}<h4>${T('学校信息','School profile')}</h4><div class="kv">
  <span>${T('时区','Time zone')}</span><span class="mono">${esc(app.config.timeZone)}</span>
  <span>${T('站点地址','Site address')}</span><span class="mono">${esc(location.origin)}</span></div>
  <p class="hint" style="margin-top:14px;font-size:12px;color:var(--color-neutral-700)">${T('以上由服务器 .env 配置，修改后需重启服务。','Set in the server .env; restart the service after changes.')}</p></section>
 <section class="panel blueprint" data-school-rules>${corners}<h4>${T('学校规则（AI 提取）','School rules (AI extraction)')}</h4><p class="hint" style="font-size:13px">${T('加载中…','Loading…')}</p></section>
 <section class="panel blueprint">${corners}<h4>${T('当前账户','Your account')}</h4><div class="kv">
  <span>${T('账户','Account')}</span><span>${esc(app.user.name)}</span>
  <span>${T('角色','Role')}</span><span>${app.user.role} · ${roles[app.user.role]}</span>
  <span>${T('界面语言','Language')}</span><div class="seg" style="width:max-content"><button type="button" data-lang="0" aria-pressed="${!app.lang}">中文</button><button type="button" data-lang="1" aria-pressed="${!!app.lang}">English</button></div></div>
  <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">${app.user.role===3?`<a class="btn btn-secondary" href="#accounts">${T('账户管理','Manage accounts')}</a>`:''}<a class="btn btn-secondary" href="/students.html">${T('学生管理','Students')}</a><button type="button" class="btn btn-secondary" data-sign-out>${T('退出登录','Sign out')}</button></div></section>
 </div>`;
 main.querySelectorAll('[data-lang]').forEach(button=>button.onclick=()=>app.setLanguage(Number(button.dataset.lang)));
 main.querySelector('[data-sign-out]').onclick=()=>app.signOut();
 schoolRules(main.querySelector('[data-school-rules]'));
}

// The school-specific course naming the LLM follows when extracting exams. A template sets the starting rules
// (and, for IB, the matching clean-up in code); the text can then be adapted to the school's own courses.
async function schoolRules(panel){
 let current;
 try{current=await api('/admin/school-rules');}catch(error){panel.querySelector('.hint').textContent=error.message;return;}
 let template=current.template;
 const hint='margin:0 0 12px;font-size:13px;line-height:1.7;color:var(--color-neutral-700)';
 panel.innerHTML=`${corners}<h4>${T('学校规则（AI 提取）','School rules (AI extraction)')}</h4>
  <p style="${hint}">${T('通用的提取要求（格式、出处、不编造）对所有学校相同；这里是本校自己的课程命名与分类规则，会附加到“从 PDF 提取考试”的提示词中，冲突时以本校规则为准。换一所学校只需选模板或改这段文字，不用改代码。','The general extraction instructions (format, sources, never inventing facts) are the same for every school. These are your school’s own course naming rules, appended to the “Extract from PDF” prompt and taking priority. Another school only picks a template or edits this text — no code changes.')}</p>
  <div class="field"><span class="label">${T('学校模板','School template')}</span><div class="seg" role="group">${Object.entries(current.templates).map(([id,t])=>`<button type="button" data-template="${id}" aria-pressed="${id===template}">${esc(tx(t.name))}</button>`).join('')}</div></div>
  <div class="field" style="margin-top:12px"><label for="school-rules-text">${T('本校课程规则（发送给模型，建议用英文书写）','Your school’s course rules (sent to the model; English recommended)')}</label><textarea id="school-rules-text" class="input mono" rows="12" maxlength="6000" style="font-size:12px;line-height:1.6"></textarea></div>
  <p data-note style="${hint};margin-top:8px"></p>${errorLine}
  <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn btn-primary" data-save>${T('保存规则','Save rules')}</button><button type="button" class="btn btn-secondary" data-restore>${T('恢复模板默认','Restore template defaults')}</button></div>`;
 const text=panel.querySelector('textarea'),note=panel.querySelector('[data-note]');
 const show=()=>{
  panel.querySelectorAll('[data-template]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.template===template)));
  const edited=text.value.trim()!==current.templates[template].rules.trim();
  note.textContent=[current.templates[template].curriculum==='ib'?T('IB 模板还会在提取后用内置规则统一课程名（如 non-DP 编号、数学 AA/AI 分轨）。','The IB template also cleans up course names in code after extraction (e.g. non-DP numbering, Mathematics AA/AI tracks).'):T('该模板只使用上面的文字规则，提取后不做额外的课程名改写。','This template relies on the text rules only; course names are not rewritten afterwards.'),
   edited?T('已在模板基础上修改。','Edited from the template.'):''].filter(Boolean).join(' ');
 };
 text.value=current.rules;show();
 text.oninput=show;
 panel.querySelectorAll('[data-template]').forEach(b=>b.onclick=()=>{
  if(b.dataset.template===template)return;
  template=b.dataset.template;text.value=current.templates[template].rules;show();
 });
 panel.querySelector('[data-restore]').onclick=()=>{text.value=current.templates[template].rules;show();};
 const save=panel.querySelector('[data-save]'),error=panel.querySelector('[data-error]');
 save.onclick=async()=>{
  save.disabled=true;error.hidden=true;
  try{
   current=await api('/admin/school-rules',{method:'PUT',body:JSON.stringify({template,rules:text.value})});
   template=current.template;text.value=current.rules;show();
   toast(T(`已保存：${tx(current.templates[template].name)}`,`Saved: ${tx(current.templates[template].name)}`));
  }catch(e){error.textContent=e.message;error.hidden=false;}
  finally{save.disabled=false;}
 };
}
