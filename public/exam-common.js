import {roomExamsAt} from './exam-seats.mjs';
export const $=selector=>/** @type {any} */(document.querySelector(selector));
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function api(path,options={}){
 const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
 if(!response.ok){const body=await response.json().catch(()=>({error:'请求失败 / Request failed'}));throw new Error(body.error||'请求失败');}
 return response.status===204?null:response.json();
}
export const date=iso=>new Date(iso+'T12:00:00');
export const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export function addDays(value,n){const d=date(value);d.setDate(d.getDate()+n);return iso(d);}
export const monday=value=>addDays(value,-((date(value).getDay()+6)%7));
export const divisions={primary:['小学部','Primary'],middle:['初中部','Middle'],high:['高中部','High']};
export const sorted=sessions=>[...sessions].sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.title.localeCompare(b.title));
export function seatingMarkup(batch,seating,exam,roomName,point=exam.start,lang=0,editable=false,personal=null){
 const room=seating.rooms.find(r=>r.name===roomName);if(!room)return '<p>座位表尚未发布 / Not published</p>';
 const active=roomExamsAt(batch,exam,roomName,point);
 const occupants=seating.seats.filter(seat=>seat.room===roomName&&active.some(s=>s.id===seat.examId));
 let cells=`<span class="seat-label"></span>`;
 for(let c=1;c<=room.columns;c++)cells+=`<span class="seat-label">${lang?'Col '+c:'第 '+c+' 列'}</span>`;
 for(let r=1;r<=room.rows;r++){
  cells+=`<span class="seat-label">${lang?'Row '+r:'第 '+r+' 排'}</span>`;
  for(let c=1;c<=room.columns;c++){
   const seat=occupants.find(s=>s.row===r&&s.column===c),s=seat&&active.find(s=>s.id===seat.examId);
   const own=!!seat&&seat.examId===exam.id&&personal?.room===roomName&&personal?.row===r&&personal?.column===c;
   const tag=editable?'button':'div',attributes=editable?` type="button" data-seat-row="${r}" data-seat-column="${c}" aria-label="${esc(`第 ${r} 排，第 ${c} 列，${seat?(seat.name||seat.englishName):'空位'}，${seat?'编辑':'添加'}座位`)}"`:'';
   cells+=`<${tag}${attributes} class="seat${seat?'':' empty'}${own?' my-seat':''}">${own?`<small>${lang?'Your seat':'你的座位'}</small>`:''}${seat?`<small>${esc(seat.className)}</small><strong>${esc(seat.name)}</strong><span>${esc(seat.englishName)}</span><small>${esc(lang?(s.titleEn||s.title):s.title)}</small>`:(lang?'Empty':'空位')}</${tag}>`;
  }
 }
 return `<div class="podium">${lang?'Front / Podium':'讲台 / 前方'}</div><div class="seating-scroll"><div class="seating-grid" style="grid-template-columns:40px repeat(${room.columns},105px)">${cells}</div></div>`;
}
