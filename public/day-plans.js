'use strict';
function openDayPlanEditor(){
  const dialog=$('#day-plan-dialog');
  $('#day-plan-content').innerHTML=`<div class="dialog-top"><h2 id="day-plan-heading">${A('放假与调休','Holidays and school days')}</h2><button type="button" id="close-day-plan" class="close-button" aria-label="${A('关闭','Close')}">×</button></div><p class="media-caption">${A('全校适用，独立于事件和筛选。未设置时，周一至周五为工作日，周六日为普通周末。保存会覆盖所选日期的现有安排，不更改事件。','Applies school-wide, independently of events and filters. Dates default to weekdays or weekends. Saving replaces existing day settings in the selected range; events are unchanged.')}</p><form id="day-plan-form">${field('plan-start',A('开始日期','Start date'),schoolToday(),'date')}${field('plan-end',A('结束日期','End date'),schoolToday(),'date')}${selectField('plan-kind',A('日期安排','Day setting'),{off:A('放假 · 休','Holiday · Off'),school:A('调休上课 · 上课','Adjusted school day · Class'),default:A('恢复默认（工作日／周末）','Restore weekday / weekend defaults')},'off')}${field('plan-zh',A('名称 · 中文','Name · Chinese'))}${field('plan-en',A('名称 · English','Name · English'))}<p id="plan-error" class="request-error" role="alert"></p><button class="primary" type="submit">${A('保存日期安排','Save day settings')}</button></form><section class="saved-day-plans"><h3>${A('已设置日期','Configured dates')}</h3><div id="saved-plans"></div></section>`;
  const refresh=()=>{
    $('#saved-plans').innerHTML=Object.values(dayPlans).map(plan=>`<button type="button" data-plan="${plan.date}">${esc(formatDate(plan.date))} ${dayBadge(plan)} ${esc(dayPlanName(plan))}</button>`).join('')||`<p>${A('暂无设置','No overrides yet')}</p>`;
    $$('[data-plan]').forEach(button=>button.onclick=()=>{const plan=dayPlans[button.dataset.plan];$('#plan-start').value=plan.date;$('#plan-end').value=plan.date;$('#plan-kind').value=plan.kind;$('#plan-zh').value=plan.title[0];$('#plan-en').value=plan.title[1];});
  };
  refresh();$('#close-day-plan').onclick=()=>dialog.close();
  $('#plan-start').onchange=()=>{if($('#plan-end').value<$('#plan-start').value)$('#plan-end').value=$('#plan-start').value;};
  let busy=false;
  dialog.oncancel=e=>{if(busy)e.preventDefault();};
  $('#day-plan-form').onsubmit=async e=>{
    e.preventDefault();if(busy)return;
    const body={start:$('#plan-start').value,end:$('#plan-end').value,kind:$('#plan-kind').value,title:[$('#plan-zh').value,$('#plan-en').value]};
    busy=true;dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
    $('#plan-error').textContent=A('正在保存…','Saving…');
    try{
      await api('/admin/day-plans',{method:'PUT',body:JSON.stringify(body)});
      const plans=await api('/day-plans');dayPlans=Object.fromEntries(plans.map(plan=>[plan.date,plan]));
      renderCalendar();refresh();$('#plan-error').textContent=A('已保存，公共校历已更新。','Saved. The public calendar is updated.');
    }catch(error){$('#plan-error').textContent=error.message;}
    finally{busy=false;dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}
  };
  dialog.showModal();
}
