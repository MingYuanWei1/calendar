// 校历问答: a drawer that answers questions from the published calendar and exams, streaming the
// answer and turning the model's [[E1]] / [[X1]] citations into cards that open the cited item.
(() => {
 const trigger=document.getElementById('assistant-open');
 if(!trigger)return;
 const english=()=>document.documentElement.lang.startsWith('en');
 const L=(zh,en)=>english()?en:zh;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 /** @type {{role:'user'|'assistant',content:string,citations?:Record<string,any>,error?:boolean}[]} */
 const messages=[];
 let busy=false,configured=true,role=0,controller=null;

 const drawer=document.createElement('aside');
 drawer.className='assistant';drawer.id='assistant';drawer.hidden=true;drawer.setAttribute('role','dialog');
 document.body.append(drawer);
 drawer.innerHTML=`<div class="assistant-head"><div><h2 data-l="title"></h2><p data-l="subtitle"></p></div><div class="assistant-tools"><button type="button" data-clear></button><button type="button" data-close aria-label="">✕</button></div></div>
 <div class="assistant-log" aria-live="polite"></div><div class="assistant-suggest"></div><p class="assistant-note"></p>
 <form class="assistant-form"><textarea rows="1" maxlength="500"></textarea><button type="submit"></button></form>`;
 const $=selector=>/** @type {HTMLElement} */(drawer.querySelector(selector));
 const log=$('.assistant-log'),input=/** @type {HTMLTextAreaElement} */($('textarea')),send=/** @type {HTMLButtonElement} */($('form button'));

 const suggestions=()=>role>=1
  ?[L('我这周有哪些考试？','Which exams do I have this week?'),L('我下一场考试在哪个教室、坐哪？','Where do I sit for my next exam?'),L('下次放假是什么时候？','When is the next day off?'),L('这周有哪些活动？','What activities are on this week?')]
  :[L('这个月有哪些比赛？','Which competitions are on this month?'),L('下次放假是什么时候？','When is the next day off?'),L('最近有调休上课吗？','Are there any make-up school days soon?'),L('高中部近期有什么考试？','Any upcoming high school exams?')];

 const weekday=iso=>(english()?['Sun','Mon','Tue','Wed','Thu','Fri','Sat']:['周日','周一','周二','周三','周四','周五','周六'])[new Date(iso+'T12:00:00Z').getUTCDay()];
 const day=iso=>{const [,m,d]=iso.split('-').map(Number);return english()?`${d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]} ${weekday(iso)}`:`${m}月${d}日 ${weekday(iso)}`;};
 const pick=pair=>Array.isArray(pair)?(pair[english()?1:0]||pair[english()?0:1]||''):'';
 function card(item,n){
  if(item.kind==='event'){
   const when=item.end&&item.end!==item.start?`${day(item.start)} – ${day(item.end)}`:`${day(item.start)}${item.time?' · '+item.time+(item.endTime?'–'+item.endTime:''):''}`;
   return `<button type="button" class="assistant-card" data-open="${n}"><span class="n">${n+1}</span><strong>${esc(pick(item.title))}</strong><span class="meta">${esc(when)}${pick(item.location)?' · '+esc(pick(item.location)):''}</span>${item.cancelled?`<span class="tag">${L('已取消','Cancelled')}</span>`:''}</button>`;
  }
  const title=(english()?item.titleEn||item.title:item.title)+(item.level&&!String(item.title).includes(item.level)?' · '+item.level:'');
  return `<button type="button" class="assistant-card" data-open="${n}"><span class="n">${n+1}</span><strong>${esc(title)}</strong><span class="meta">${esc(day(item.date))} · ${esc(item.start)}–${esc(item.end)} · ${esc((item.rooms||[]).join(' / '))}</span>${item.seat?`<span class="seat">${esc(L(`我的座位：${item.seat.room} 教室第 ${item.seat.row} 排第 ${item.seat.column} 列`,`My seat: room ${item.seat.room}, row ${item.seat.row}, column ${item.seat.column}`))}</span>`:item.cancelled?`<span class="tag">${L('已取消','Cancelled')}</span>`:''}</button>`;
 }
 /** Renders answer text, replacing citations with numbered chips (and hiding a half-streamed one). */
 function answer(message,streaming){
  const order=[];
  const text=streaming?message.content.replace(/\[\[[^\]]*\]?$/,''):message.content;
  const html=esc(text).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\[\[([EX]\d+)\]\]/g,(match,ref)=>{
   if(!streaming&&!message.citations?.[ref])return '';
   let n=order.indexOf(ref);if(n<0){order.push(ref);n=order.length-1;}
   return `<button type="button" class="cite" data-cite="${n}" aria-label="${L('引用','Citation')} ${n+1}">${n+1}</button>`;
  });
  const cards=!streaming&&order.length?`<div class="assistant-cards">${order.map((ref,n)=>card(message.citations[ref],n)).join('')}</div>`:'';
  return html+(streaming?'<span class="typing" aria-hidden="true"><i></i><i></i><i></i></span>':'')+cards;
 }
 function render(){
  $('[data-l=title]').textContent=L('问一问 · AI 校历助手','Ask · AI calendar assistant');
  $('[data-l=subtitle]').textContent=L('仅依据已发布的校历与考试安排作答','Answers only from the published calendar and exams');
  $('[data-clear]').textContent=L('清空','Clear');$('[data-close]').setAttribute('aria-label',L('关闭','Close'));
  drawer.setAttribute('aria-label',L('AI 校历助手','AI calendar assistant'));
  input.placeholder=L('例如：下周三有什么活动？','e.g. What’s on next Wednesday?');input.setAttribute('aria-label',L('输入问题','Your question'));
  send.textContent=busy?L('回答中…','Answering…'):L('发送','Send');send.disabled=busy||!configured;
  log.innerHTML=messages.length?messages.map((m,i)=>m.role==='user'?`<div class="assistant-msg user">${esc(m.content)}</div>`:`<div class="assistant-msg bot${m.error?' error':''}" data-message="${i}">${m.error?esc(m.content)+(i===messages.length-1?` <button type="button" class="assistant-retry" data-retry>${L('重试','Retry')}</button>`:''):answer(m,busy&&i===messages.length-1)}</div>`).join('')
   :`<p class="assistant-empty">${L('你可以用自然语言询问校历中的活动、比赛、放假与调休安排，以及考试时间和地点。用学校账号登录后，还可以问自己的考试和座位。','Ask in plain language about events, competitions, days off, make-up days, and exam times and rooms. Sign in with your school account to ask about your own exams and seats.')}</p>`;
  $('.assistant-suggest').innerHTML=messages.length?'':suggestions().map(q=>`<button type="button" data-ask="${esc(q)}">${esc(q)}</button>`).join('');
  const note=$('.assistant-note');note.className='assistant-note'+(configured?'':' warn');
  note.textContent=configured?L('AI 生成的回答可能有误，请以引用的原始安排为准。','AI answers can be wrong; the cited items are authoritative.'):L('尚未配置 LLM_WORKER_URL 和 LLM_WORKER_TOKEN，问答暂不可用。','LLM_WORKER_URL and LLM_WORKER_TOKEN are not configured, so the assistant is unavailable.');
  log.scrollTop=log.scrollHeight;
 }
 function renderLast(){
  const index=messages.length-1,el=log.querySelector(`[data-message="${index}"]`);
  if(!el){render();return;}
  el.innerHTML=answer(messages[index],true);log.scrollTop=log.scrollHeight;
 }

 async function ask(question){
  question=question.trim();if(!question||busy||!configured)return;
  messages.push({role:'user',content:question},{role:'assistant',content:''});
  const history=messages.slice(0,-1).filter(m=>!m.error&&m.content).slice(-12).map(({role,content})=>({role,content}));
  busy=true;input.value='';render();
  const reply=messages.at(-1);controller=new AbortController();
  try{
   const response=await fetch('/api/assistant',{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({messages:history})});
   if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||L('暂时无法回答，请稍后再试。','Unable to answer right now.'));
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',done=false;
   const handle=line=>{
    if(!line.trim())return;
    const message=JSON.parse(line);
    if(message.type==='text'){reply.content+=message.delta;renderLast();}
    if(message.type==='error')throw new Error(message.error);
    if(message.type==='done'){reply.content=message.result.answer;reply.citations=message.result.citations;done=true;}
   };
   while(true){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});let i;while((i=buffer.indexOf('\n'))>=0){handle(buffer.slice(0,i));buffer=buffer.slice(i+1);}}
   handle(buffer);
   if(!done)throw new Error(L('连接中断，请重试。','The connection was interrupted. Please retry.'));
  }catch(error){
   if(error.name==='AbortError'){messages.splice(-2);}
   else{reply.content=error.message;reply.error=true;}
  }finally{busy=false;controller=null;render();if(!drawer.hidden)input.focus();}
 }

 // Opening a citation focuses the item on this page when possible, otherwise navigates to it.
 function open(item){
  const small=matchMedia('(max-width:640px)').matches;
  if(item.kind==='event'){
   const focus=/** @type {any} */(window).calendarFocus;
   if(focus&&focus(item.id,item.date)){if(small)close();return;}
   location.href='/?event='+encodeURIComponent(item.id)+(item.date?'&date='+item.date:'');return;
  }
  const focus=/** @type {any} */(window).examFocus;
  if(focus){focus(item.batchId,item.id);if(small)close();return;}
  location.href=`/exams.html?batch=${encodeURIComponent(item.batchId)}&exam=${encodeURIComponent(item.id)}`;
 }
 drawer.addEventListener('click',event=>{
  const target=/** @type {HTMLElement} */(event.target);
  const ask_=/** @type {HTMLElement|null} */(target.closest('[data-ask]'));if(ask_){ask(ask_.dataset.ask||'');return;}
  if(target.closest('[data-retry]')){const question=messages.at(-2)?.content||'';messages.splice(-2);ask(question);return;}
  const cite=/** @type {HTMLElement|null} */(target.closest('[data-cite]'));
  if(cite){const cardEl=/** @type {HTMLElement|null} */(cite.closest('.assistant-msg')?.querySelector(`[data-open="${cite.dataset.cite}"]`));if(cardEl){cardEl.scrollIntoView({block:'nearest',behavior:'smooth'});cardEl.classList.add('flash');setTimeout(()=>cardEl.classList.remove('flash'),1200);}return;}
  const openEl=/** @type {HTMLElement|null} */(target.closest('[data-open]'));
  if(openEl){const message=messages[Number(openEl.closest('[data-message]')?.getAttribute('data-message'))];const ref=message&&orderedRefs(message)[Number(openEl.dataset.open)];if(ref)open(message.citations[ref]);}
 });
 const orderedRefs=message=>[...new Set([...message.content.matchAll(/\[\[([EX]\d+)\]\]/g)].map(m=>m[1]).filter(ref=>message.citations?.[ref]))];
 $('form').addEventListener('submit',event=>{event.preventDefault();ask(input.value);});
 input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();ask(input.value);}});
 input.addEventListener('input',()=>{input.style.height='auto';input.style.height=Math.min(120,input.scrollHeight)+'px';});
 $('[data-clear]').onclick=()=>{controller?.abort();messages.length=0;render();input.focus();};
 function close(){drawer.hidden=true;document.body.classList.remove('assistant-open');trigger.setAttribute('aria-expanded','false');trigger.focus();}
 $('[data-close]').onclick=close;
 drawer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}});
 trigger.onclick=()=>{drawer.hidden=!drawer.hidden;document.body.classList.toggle('assistant-open',!drawer.hidden);trigger.setAttribute('aria-expanded',String(!drawer.hidden));if(!drawer.hidden){render();input.focus();}};
 const label=()=>{trigger.innerHTML=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="label">${L('问一问','Ask AI')}</span>`;trigger.setAttribute('aria-label',L('打开 AI 校历助手','Open the AI calendar assistant'));};
 trigger.setAttribute('aria-controls','assistant');trigger.setAttribute('aria-expanded','false');
 new MutationObserver(()=>{label();render();}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
 label();
 fetch('/api/assistant',{credentials:'same-origin'}).then(r=>r.json()).then(status=>{configured=Boolean(status.configured);render();}).catch(()=>{});
 fetch('/api/session',{credentials:'same-origin'}).then(r=>r.json()).then(status=>{role=status.user?.role||0;render();}).catch(()=>{});
})();
