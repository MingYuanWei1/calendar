import {createDayPlanResolver} from './day-plans.mjs';
import {$,esc,corners,icon,app,T,tx,api,toast,refreshNav,addDays,dow,md,mdw,monthLabel,weekdays,loadPlans,planRanges} from './console-core.js';

const view={offset:0,selA:'',selB:'',picking:false,kind:'off',zh:'',en:'',saving:false};
const kinds=()=>({off:T('放假','Holiday'),school:T('全天上课','Full day'),half:T('上半天','Half day'),default:T('恢复默认','Default')});
const rangeLabel=(a,b)=>a===b?mdw(a):`${md(a)} – ${md(b)}`;
const daysIn=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000)+1;

export async function showDays(main){
 if(!app.data.plans){main.innerHTML=`<p class="loading">${T('正在加载…','Loading…')}</p>`;await loadPlans();}
 if(!view.selA)view.selA=view.selB=app.today;
 render(main);
}

function render(main){
 const plans=app.data.plans,resolvePlan=createDayPlanResolver(plans),[ty,tm]=app.today.split('-').map(Number);
 const first=new Date(Date.UTC(ty,tm-1+view.offset,1)),y=first.getUTCFullYear(),m=first.getUTCMonth()+1;
 const start=first.toISOString().slice(0,10),count=new Date(Date.UTC(y,m,0)).getUTCDate();
 let cells='<span class="day blank"></span>'.repeat(dow(start));
 for(let d=0;d<count;d++){
  const iso=addDays(start,d),plan=resolvePlan(iso),classes=['day'];
  if(dow(iso)>=5)classes.push('weekend');if(plan)classes.push(plan.kind);if(iso===app.today)classes.push('today');
  if(iso>=view.selA&&iso<=view.selB)classes.push('selected');
  const badge=plan?(plan.kind==='off'?T('休','Off'):plan.kind==='half'?T('上半天','Half day'):T('全天','Full day')):'';
  cells+=`<button type="button" class="${classes.join(' ')}" data-day="${iso}" aria-pressed="${iso>=view.selA&&iso<=view.selB}" aria-label="${esc(mdw(iso)+(plan?' · '+kinds()[plan.kind]+' '+tx(plan.title):''))}"><span class="top"><span class="n">${d+1}</span>${badge?`<span class="badge">${badge}</span>`:''}</span><span class="name">${esc(plan?tx(plan.title):'')}</span></button>`;
 }
 cells+='<span class="day blank"></span>'.repeat((7-(dow(start)+count)%7)%7);
 const ranges=planRanges(plans),named=view.kind!=='default';
 main.innerHTML=`<div class="page">
 <header class="page-head"><div><div class="kicker">${T('管理后台','Admin console')}</div><h1>${T('放假与调休','School days')}</h1><p class="sub">${T('全校适用。周一至周五默认全天上课，周六日默认休息。仅人工指定后显示上半天。保存会覆盖所选日期安排，恢复默认会清除人工设置。','School-wide. Weekdays default to full school days and weekends are off. Half days are shown only when manually assigned. Saving replaces the selected dates; Default clears their overrides.')}</p></div></header>
 <div class="days-grid"><div style="display:flex;flex-direction:column;gap:20px;min-width:0">
  <div class="legend"><span><i style="background:var(--color-bg)"></i>${T('工作日','Weekday')}</span><span><i style="background:var(--color-neutral-200)"></i>${T('周末','Weekend')}</span><span><i style="background:var(--color-accent-200);border-color:var(--color-accent-400)"></i>${T('放假','Holiday')}</span><span><i style="border:1px dashed var(--color-accent)"></i>${T('全天上课','Full school day')}</span><span><i style="background:#fff0d6;border-color:#d7ad68"></i>${T('上半天','Half day')}</span><span class="hint">${T('单日：点击一天即可保存；范围：再点击结束日期','One day: click a date and save. Range: click an end date.')}</span></div>
  <div><div class="month-bar"><strong>${monthLabel(y,m)}</strong><button type="button" class="btn btn-secondary btn-square" data-month="-1" aria-label="${T('上个月','Previous month')}">${icon.prev}</button><button type="button" class="btn btn-secondary" data-month="0">${T('本月','This month')}</button><button type="button" class="btn btn-secondary btn-square" data-month="1" aria-label="${T('下个月','Next month')}">${icon.next}</button></div>
  <div class="weekday-row">${weekdays().map(w=>`<span>${w}</span>`).join('')}</div><div class="month-cells">${cells}</div></div>
 </div>
 <div class="side-panel" style="padding:0;gap:22px">
  <section class="side-panel blueprint">${corners}<div class="kicker">${T('所选日期','Selected dates')}</div><div class="sel-label">${esc(rangeLabel(view.selA,view.selB))}${view.selA!==view.selB?T(` · ${daysIn(view.selA,view.selB)} 天`,` · ${daysIn(view.selA,view.selB)} days`):''}</div>
   <div class="field"><span class="label">${T('日期安排','Day setting')}</span><div class="seg full">${Object.entries(kinds()).map(([k,label])=>`<button type="button" data-kind="${k}" aria-pressed="${view.kind===k}">${label}</button>`).join('')}</div></div>
   ${named?`<div class="field"><label for="plan-zh">${T('名称 · 中文','Name · Chinese')}</label><input class="input" id="plan-zh" maxlength="60" value="${esc(view.zh)}" placeholder="${view.kind==='off'?'学校放假':view.kind==='half'?'上半天':'全天上课'}"></div><div class="field"><label for="plan-en">${T('名称 · English','Name · English')}</label><input class="input" id="plan-en" maxlength="60" value="${esc(view.en)}" placeholder="${view.kind==='off'?'School holiday':view.kind==='half'?'Half day':'Full school day'}"></div>`:''}
   <button type="button" class="btn btn-primary blueprint" data-save>${corners}${T('保存日期安排','Save day settings')}</button><p class="alert bad" role="alert" id="plan-error" hidden></p>
   <p class="note">${T('保存后公共校历立即更新。','The public calendar updates immediately.')}</p></section>
  <section><div class="list-head">${T('已设置日期','Configured dates')}</div>${ranges.map((r,i)=>`<div class="range-row"><button type="button" data-range="${i}"><strong>${esc(rangeLabel(r.start,r.end))}</strong><small>${kinds()[r.kind]}${tx(r.title)?' · '+esc(tx(r.title)):''}</small></button><button type="button" class="btn btn-ghost" style="font-size:12px" data-restore="${i}">${T('恢复默认','Default')}</button></div>`).join('')||`<p class="muted" style="font-size:13px;padding:10px 0">${T('暂无设置','No overrides yet')}</p>`}</section>
 </div></div></div>`;
 const page=main.querySelector('.page');
 page.oninput=e=>{if(e.target.id==='plan-zh')view.zh=e.target.value;if(e.target.id==='plan-en')view.en=e.target.value;};
 page.onclick=async e=>{
  const b=e.target.closest('button');if(!b||view.saving)return;
  if(b.dataset.day){const iso=b.dataset.day;if(view.picking&&iso>=view.selA)Object.assign(view,{selB:iso,picking:false});else Object.assign(view,{selA:iso,selB:iso,picking:true});}
  else if(b.dataset.month!==undefined)view.offset=b.dataset.month==='0'?0:view.offset+Number(b.dataset.month);
  else if(b.dataset.kind)view.kind=b.dataset.kind;
  else if(b.dataset.range){const r=ranges[Number(b.dataset.range)];Object.assign(view,{selA:r.start,selB:r.end,picking:false,kind:r.kind,zh:r.title[0],en:r.title[1]});const [ry,rm]=r.start.split('-').map(Number);view.offset=(ry-ty)*12+rm-tm;}
  else if(b.dataset.restore){const r=ranges[Number(b.dataset.restore)];await save(main,{start:r.start,end:r.end,kind:'default',title:['','']},T('已恢复默认安排。','Restored to default settings.'));return;}
  else if(b.hasAttribute('data-save')){await save(main,{start:view.selA,end:view.picking?view.selA:(view.selB||view.selA),kind:view.kind,title:view.kind==='default'?['','']:[view.zh.trim(),view.en.trim()]},T('已保存，公共校历已更新。','Saved. The public calendar is updated.'));return;}
  else return;
  render(main);
  (b.dataset.day?$(`[data-day="${b.dataset.day}"]`):b.dataset.kind?$(`[data-kind="${b.dataset.kind}"]`):null)?.focus();
 };
}

async function save(main,body,message){
 view.saving=true;main.querySelectorAll('button,input').forEach(el=>el.disabled=true);
 try{
  await api('/admin/day-plans',{method:'PUT',body:JSON.stringify(body)});
  await loadPlans();view.picking=false;refreshNav();render(main);toast(message);
 }catch(error){render(main);$('#plan-error').textContent=error.message;$('#plan-error').hidden=false;}
 finally{view.saving=false;}
}
