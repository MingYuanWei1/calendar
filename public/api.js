'use strict';
/** @type {{schoolName:string,schoolNameEn:string,timeZone:string}} */
let settings={schoolName:'学校校历',schoolNameEn:'School calendar',timeZone:'Asia/Shanghai'};
async function api(path,options={}){
  let response;
  try{response=await fetch('/api'+path,{credentials:'same-origin',...options,headers:{...(options.body instanceof File?{}:{'Content-Type':'application/json'}),...options.headers}});}
  catch{throw new Error(state.lang?'Unable to connect. Your inputs are preserved; please retry.':'无法连接服务器，已保留输入，请重试。');}
  if(!response.ok){
    const detail=await response.json().catch(()=>({error:'网络请求失败，请重试。'}));
    const english=typeof state!=='undefined'&&state.lang;
    const messages={400:'Please check the request and try again.',401:path==='/login'?'Incorrect username or password.':'Your session has expired. Please sign in again.',403:'Request origin does not match the website address.',404:'This item no longer exists.',409:'This event changed in another window. Keep your inputs, then reload the list before editing.',413:'File is too large. Maximum image size is 5 MB.',415:'Please upload a PNG, JPEG or WebP image.',422:'Please check the event fields or image file.',429:'Too many sign-in attempts. Please retry in 15 minutes.'};
    const error=new Error(english?(messages[response.status]||'Service unavailable. Please retry.'):detail.error);Object.assign(error,{status:response.status,fields:detail.fields});throw error;
  }
  return response.status===204?null:response.json();
}
function schoolToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:settings.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function setLoadMessage(message,error=false){const el=$('#load-status');el.textContent=message;el.classList.toggle('request-error',error);}
async function loadEvents(management=false){
  const [list,plans]=await Promise.all([api(management?'/admin/events':'/events'),api('/day-plans')]);
  dayPlans=Object.fromEntries(plans.map(plan=>[plan.date,plan]));
  events.splice(0,events.length,...list);
  if(!events.some(e=>e.id===state.selected&&matches(e)))state.selected=null;
  renderCalendar();renderDetail();
}
async function startCalendar(){
  try{
    setLoadMessage('正在加载校历…');
    settings=await api('/config');
    copy.school=[settings.schoolName,settings.schoolNameEn];
    const current=schoolToday().split('-').map(Number);state.year=current[0];state.month=current[1]-1;
    await loadEvents();render();setLoadMessage('');
    const session=await api('/session');admin.signedIn=session.authenticated;
    if(admin.open&&admin.signedIn)await loadEvents(true);
    renderAdmin();
  }catch(error){setLoadMessage('校历暂时无法加载，请点击重试。',true);$('#retry-load').hidden=false;}
}
