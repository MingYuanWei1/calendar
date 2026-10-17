import {esc,corners,T,api,app} from './console-core.js';

// 访问统计: today, this week and this month at a glance, then the latest days, weeks or months as a chart and a table.
const UNITS={day:['日','Day'],week:['周','Week'],month:['月','Month']};
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let unit='day';

const views=p=>p.views.calendar+p.views.exams;
const visitors=p=>p.visitors.signedIn+p.visitors.anonymous;
const number=n=>n.toLocaleString(app.lang?'en':'zh-CN');
function label(kind,start){
 const [y,m,d]=start.split('-').map(Number);
 if(kind==='month')return app.lang?`${MON[m-1]} ${y}`:`${y}年${m}月`;
 const day=app.lang?`${MON[m-1]} ${d}`:`${m}月${d}日`;
 return kind==='week'?T(`${day}起`,`Wk of ${day}`):day;
}
function change(now,before){
 if(!before)return `<span class="stat-change">${T('上期无数据','No earlier data')}</span>`;
 const pct=Math.round((now-before)/before*100);
 return `<span class="stat-change">${pct>0?'+':''}${pct}% ${T('较上期','vs previous')}</span>`;
}
function tile(kind,list){
 const now=list.at(-1),before=list.at(-2);
 const title={day:T('今天','Today'),week:T('本周','This week'),month:T('本月','This month')}[kind];
 return `<section class="panel blueprint stat-tile">${corners}<h4>${title}<span class="stat-sofar">${T('截至目前','so far')}</span></h4>
  <div class="stat-figures"><div><strong>${number(views(now))}</strong><span>${T('浏览量','Views')}</span>${change(views(now),views(before))}</div>
  <div><strong>${number(visitors(now))}</strong><span>${T('访客','Visitors')}</span>${change(visitors(now),visitors(before))}</div></div></section>`;
}
/** A rounded maximum for the axis, so gridlines fall on readable numbers. */
function axisMax(value){
 if(value<=4)return 4;
 const step=10**Math.floor(Math.log10(value/4)),nice=[1,2,2.5,5,10].find(f=>f*step*4>=value);
 return nice*step*4;
}
function chart(list){
 const W=720,H=240,L=44,R=8,T0=12,B=28,plotW=W-L-R,plotH=H-T0-B;
 const max=axisMax(Math.max(1,...list.map(views),...list.map(visitors)));
 const x=i=>L+plotW*(i+.5)/list.length,y=v=>T0+plotH*(1-v/max),slot=plotW/list.length,bar=Math.max(3,Math.min(28,slot*.62));
 const grid=[0,1,2,3,4].map(i=>{const v=max*i/4;return `<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" class="${i?'grid':'base'}"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end">${number(v)}</text>`;}).join('');
 // Bars end in 4px rounded tops anchored on the baseline.
 const bars=list.map((p,i)=>{const h=plotH*views(p)/max,r=Math.min(4,h/2,bar/2),x0=x(i)-bar/2,top=T0+plotH-h;
  return h?`<path class="bar" d="M${x0},${T0+plotH}V${top+r}Q${x0},${top} ${x0+r},${top}H${x0+bar-r}Q${x0+bar},${top} ${x0+bar},${top+r}V${T0+plotH}Z"/>`:'';}).join('');
 const line=`<polyline class="line" points="${list.map((p,i)=>`${x(i)},${y(visitors(p))}`).join(' ')}"/>`+list.map((p,i)=>`<circle class="dot" cx="${x(i)}" cy="${y(visitors(p))}" r="4"/>`).join('');
 const every=Math.ceil(list.length/8);
 const ticks=list.map((p,i)=>(list.length-1-i)%every?'':`<text x="${x(i)}" y="${H-8}" text-anchor="middle">${esc(label(unit,p.start))}</text>`).join('');
 const hits=list.map((p,i)=>`<rect class="hit" data-i="${i}" x="${x(i)-slot/2}" y="${T0}" width="${slot}" height="${plotH}"/>`).join('');
 return `<div class="stat-legend"><span><i class="key-bar"></i>${T('浏览量','Views')}</span><span><i class="key-line"></i>${T('访客','Visitors')}</span></div>
 <div class="stat-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${T('浏览量与访客趋势','Views and visitors over time')}">${grid}${bars}${line}${ticks}${hits}</svg><div class="stat-tip" hidden></div></div>`;
}
function table(list){
 const rows=[...list].reverse().map(p=>`<tr><td>${esc(label(unit,p.start))}</td><td class="num">${number(views(p))}</td><td class="num">${number(p.views.calendar)}</td><td class="num">${number(p.views.exams)}</td><td class="num">${number(visitors(p))}</td><td class="num">${number(p.visitors.signedIn)}</td><td class="num">${number(p.visitors.anonymous)}</td></tr>`).join('');
 return `<div style="overflow:auto"><table class="review-table stat-table"><thead><tr><th>${{day:T('日期','Date'),week:T('周','Week'),month:T('月份','Month')}[unit]}</th><th class="num">${T('浏览量','Views')}</th><th class="num">${T('校历','Calendar')}</th><th class="num">${T('考试安排','Exams')}</th><th class="num">${T('访客','Visitors')}</th><th class="num">${T('已登录','Signed in')}</th><th class="num">${T('未登录','Anonymous')}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export async function showStats(main){
 const visit=app.visit;
 main.innerHTML=`<div class="page"><header class="page-head"><div><div class="kicker">${T('管理后台','Admin console')}</div><h1>${T('统计','Statistics')}</h1></div></header><p class="hint">${T('加载中…','Loading…')}</p></div>`;
 const data=await api('/admin/stats');
 if(visit!==app.visit)return;
 const draw=()=>{
  const list=data.series[unit];
  main.innerHTML=`<div class="page">
  <header class="page-head"><div><div class="kicker">${T('管理后台','Admin console')}</div><h1>${T('统计','Statistics')}</h1>
   <p class="sub">${T('校历与考试安排页面的浏览量和访客。管理员本人的访问不计入；每位访客在同一天、同一页面最多计 50 次浏览。','Views and visitors of the calendar and exams pages. Administrators’ own visits are not counted, and each visitor counts at most 50 views per page per day.')}</p></div></header>
  <div class="stat-tiles">${['day','week','month'].map(kind=>tile(kind,data.series[kind])).join('')}</div>
  <section class="panel blueprint">${corners}<div class="stat-head"><h4>${T('趋势','Trend')}</h4><div class="seg" role="group" aria-label="${T('时间单位','Period')}">${Object.entries(UNITS).map(([key,[zh,en]])=>`<button type="button" data-unit="${key}" aria-pressed="${key===unit}">${T(zh,en)}</button>`).join('')}</div></div>
   ${chart(list)}${table(list)}</section></div>`;
  main.querySelectorAll('[data-unit]').forEach(button=>button.onclick=()=>{unit=button.dataset.unit;draw();});
  const box=main.querySelector('.stat-chart'),tip=box.querySelector('.stat-tip');
  box.querySelectorAll('.hit').forEach(hit=>{
   hit.onmouseenter=()=>{
    const p=list[Number(hit.dataset.i)],r=hit.getBoundingClientRect(),b=box.getBoundingClientRect();
    tip.innerHTML=`<strong>${esc(label(unit,p.start))}</strong><span>${T('浏览量','Views')} ${number(views(p))}<small>${T('校历','Calendar')} ${number(p.views.calendar)} · ${T('考试','Exams')} ${number(p.views.exams)}</small></span><span>${T('访客','Visitors')} ${number(visitors(p))}<small>${T('已登录','Signed in')} ${number(p.visitors.signedIn)} · ${T('未登录','Anonymous')} ${number(p.visitors.anonymous)}</small></span>`;
    tip.hidden=false;
    tip.style.left=Math.min(Math.max(0,r.left-b.left+r.width/2-tip.offsetWidth/2),b.width-tip.offsetWidth)+'px';
    hit.classList.add('on');
   };
   hit.onmouseleave=()=>{tip.hidden=true;hit.classList.remove('on');};
  });
 };
 draw();
}
