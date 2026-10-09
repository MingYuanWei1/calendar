import {request as httpRequest} from 'node:http';
import http from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/passwords.mjs';
import {addDays,expandEvents,seriesDates,weekdayOf} from '../../public/recurrence.mjs';

const origin='http://localhost:3000';
async function setup(t,llm){
 const directory=await mkdtemp(join(tmpdir(),'recurrence-test-'));
 const instance=createApplication({dataDir:directory,origin,timeZone:'Asia/Shanghai',llm,sso:{preview:true,previewEmail:'29wangxiaoming@school.edu.cn'}});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));instance.close();await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 // DELETE carries a body here, so send an explicit length: Node only chunks bodies of other methods by default.
 const request=(path,{method='GET',body,cookie='school_preview_out=1',accept='application/json'}={})=>new Promise((resolve,reject)=>{
  const payload=body===undefined?undefined:JSON.stringify(body);
  const req=httpRequest(base+path,{method,headers:{Host:'localhost:3000',Origin:origin,'Content-Type':'application/json',Accept:accept,Cookie:cookie,...(payload?{'Content-Length':Buffer.byteLength(payload)}:{})}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));});
  req.on('error',reject);req.end(payload);
 });
 await setAdminPassword(instance.db,'admin','recurrence-testing-password');
 const login=await request('/api/login',{method:'POST',body:{username:'admin',password:'recurrence-testing-password'}});
 const admin=login.headers['set-cookie'][0].split(';')[0]+'; school_preview_out=1';
 const send=(path,method='GET',body)=>request(path,{method,body,cookie:admin});
 const call=async(path,method='GET',body)=>{const r=await send(path,method,body);assert.ok(r.status<300,`${path} ${r.status} ${r.text}`);return r.text?JSON.parse(r.text):null;};
 return {request,send,call};
}
const club=fields=>({title:['机器人社','Robotics club'],type:'activity',scope:['schoolwide'],location:['创客室','Maker lab'],status:'published',start:'2026-09-30',timeMode:'timed',time:'15:30',endTime:'17:00',repeat:{freq:'weekly',interval:1,weekdays:[3]},...fields});
/** The unfolded VEVENT blocks of a calendar file; repeated properties (EXDATE, RDATE) keep every value. */
function vevents(text){
 const unfolded=text.replace(/\r\n /g,'');
 return [...unfolded.matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT/g)].map(m=>{
  const item={};
  for(const line of m[1].trim().split('\r\n')){const i=line.indexOf(':'),key=line.slice(0,i);(item[key]??=[]).push(line.slice(i+1));}
  return item;
 });
}

test('repeat rules are validated and normalised',async t=>{
 const {send,call}=await setup(t);
 assert.equal((await send('/api/admin/events','POST',club({timeMode:'multi',start:'2026-09-30',end:'2026-10-01',time:undefined,endTime:undefined}))).status,422);
 const wrongDay=await send('/api/admin/events','POST',club({repeat:{freq:'weekly',interval:1,weekdays:[1]}}));
 assert.equal(wrongDay.status,422);assert.match(wrongDay.text,/start date must be one of the repeat dates/);
 assert.equal((await send('/api/admin/events','POST',club({repeat:{freq:'weekly',interval:1,weekdays:[3],until:'2026-09-01'}}))).status,422);
 assert.equal((await send('/api/admin/events','POST',club({repeat:{freq:'daily',interval:2,schoolDays:true}}))).status,201,'school days force an interval of 1');
 const saved=await call('/api/admin/events','POST',club({repeat:{freq:'weekly',interval:1,weekdays:[5,3,3],monthDays:[4],count:6}}));
 assert.deepEqual(saved.repeat,{freq:'weekly',interval:1,weekdays:[3,5],count:6});
 const plain=await call('/api/admin/events','POST',club({repeat:null}));
 assert.equal(plain.repeat,undefined);
});

test('single dates can be changed, cancelled this time, deleted and restored',async t=>{
 const {send,call,request}=await setup(t);
 await call('/api/admin/day-plans','PUT',{start:'2026-10-01',end:'2026-10-07',kind:'off',title:['国庆节','National Day']});
 let series=await call('/api/admin/events','POST',club({}));
 const plans={};for(let d='2026-10-01';d<='2026-10-07';d=addDays(d,1))plans[d]={kind:'off'};
 assert.deepEqual(seriesDates(series,plans,'2026-10-21'),['2026-09-30','2026-10-14','2026-10-21'],'the Wednesday in the National Day break is skipped');

 // A date in the holiday is not a date of the series.
 assert.equal((await send(`/api/admin/events/${series.id}/cancel`,'POST',{version:series.version,reason:'',occurrence:{date:'2026-10-07',span:'one'}})).status,422);
 // "This event only" stores just the fields that differ from the series, keyed by the original date.
 series=await call(`/api/admin/events/${series.id}`,'PUT',{...club({}),start:'2026-10-15',time:'16:00',endTime:'17:30',location:['礼堂','Hall'],version:series.version,occurrence:{date:'2026-10-14',span:'one'}});
 assert.deepEqual(series.exceptions['2026-10-14'],{start:'2026-10-15',time:'16:00',endTime:'17:30',location:['礼堂','Hall']});
 assert.equal(series.start,'2026-09-30');
 assert.equal((await send(`/api/admin/events/${series.id}`,'PUT',{...club({}),scope:['high'],version:series.version,occurrence:{date:'2026-10-21',span:'one'}})).status,422,'audience stays with the series');
 series=await call(`/api/admin/events/${series.id}/cancel`,'POST',{version:series.version,reason:'老师外出',occurrence:{date:'2026-10-21',span:'one'}});
 assert.deepEqual(series.exceptions['2026-10-21'],{cancelled:true,cancelReason:'老师外出'});
 assert.equal(series.status,'published');
 series=await call(`/api/admin/events/${series.id}`,'DELETE',{version:series.version,occurrence:{date:'2026-10-28'}});
 assert.deepEqual(series.exceptions['2026-10-28'],{deleted:true});

 const shown=expandEvents(JSON.parse((await request('/api/events')).text),plans,'2026-10-12','2026-11-01');
 assert.deepEqual(shown.map(e=>[e.start,e.time,e.cancelledOnce,e.oldDate||null]),[['2026-10-15','16:00',false,'2026-10-14'],['2026-10-21','15:30',true,null]]);

 // An all-events edit keeps the single-date changes, but refuses a rule that no longer includes them.
 const moved=await send(`/api/admin/events/${series.id}`,'PUT',{...club({}),start:'2026-10-01',repeat:{freq:'weekly',interval:1,weekdays:[4]},version:series.version});
 assert.equal(moved.status,422);assert.match(JSON.parse(moved.text).error,/2026-10-14/);
 series=await call(`/api/admin/events/${series.id}`,'PUT',{...club({}),title:['机器人社团','Robotics club'],version:series.version});
 assert.equal(Object.keys(series.exceptions).length,3);
 assert.equal(series.oldDate,undefined,'a series edit is not a reschedule');
 series=await call(`/api/admin/events/${series.id}/restore`,'POST',{version:series.version,occurrence:{date:'2026-10-28'}});
 assert.equal(series.exceptions['2026-10-28'],undefined);
});

test('"this and future" splits the series and carries later changes and the remaining count',async t=>{
 const {call,request}=await setup(t);
 let series=await call('/api/admin/events','POST',club({repeat:{freq:'weekly',interval:1,weekdays:[3],count:6}}));
 series=await call(`/api/admin/events/${series.id}/cancel`,'POST',{version:series.version,reason:'',occurrence:{date:'2026-10-28',span:'one'}});
 const next=await call(`/api/admin/events/${series.id}`,'PUT',{...club({repeat:series.repeat}),start:'2026-10-14',time:'16:00',endTime:'17:00',version:series.version,occurrence:{date:'2026-10-14',span:'future'}});
 assert.equal(next.start,'2026-10-14');assert.equal(next.time,'16:00');
 assert.deepEqual(next.repeat,{freq:'weekly',interval:1,weekdays:[3],count:4});
 assert.deepEqual(Object.keys(next.exceptions),['2026-10-28']);
 const all=JSON.parse((await request('/api/events')).text),old=all.find(e=>e.id===series.id);
 assert.deepEqual(old.repeat,{freq:'weekly',interval:1,weekdays:[3],until:'2026-10-13'});
 assert.deepEqual(old.exceptions,{});
 assert.deepEqual(expandEvents(all,{},'2026-09-01','2026-12-31').map(e=>e.start+' '+e.time),['2026-09-30 15:30','2026-10-07 15:30','2026-10-14 16:00','2026-10-21 16:00','2026-10-28 16:00','2026-11-04 16:00']);

 // Cancelling this and future dates keeps them visible as cancelled.
 const rest=await call(`/api/admin/events/${next.id}/cancel`,'POST',{version:next.version,reason:'学期结束',occurrence:{date:'2026-10-21',span:'future'}});
 assert.equal(rest.status,'cancelled');assert.equal(rest.start,'2026-10-21');assert.equal(rest.cancelReason,'学期结束');
 const after=JSON.parse((await request('/api/events')).text);
 assert.deepEqual(expandEvents(after,{},'2026-10-14','2026-12-31').map(e=>[e.start,e.cancelled]),[['2026-10-14',false],['2026-10-21',true],['2026-10-28',true],['2026-11-04',true]]);
});

test('the calendar feed sends one repeating entry with exclusions and per-date overrides',async t=>{
 const {call,request}=await setup(t);
 await call('/api/admin/day-plans','PUT',{start:'2026-10-01',end:'2026-10-07',kind:'off',title:['国庆节','National Day']});
 await call('/api/admin/day-plans','PUT',{start:'2026-10-10',kind:'school',title:['调休','Make-up day'],follows:5});
 let series=await call('/api/admin/events','POST',club({repeat:{freq:'weekly',interval:1,weekdays:[3],until:'2026-12-30'}}));
 series=await call(`/api/admin/events/${series.id}/cancel`,'POST',{version:series.version,reason:'老师外出',occurrence:{date:'2026-10-21',span:'one'}});
 series=await call(`/api/admin/events/${series.id}`,'DELETE',{version:series.version,occurrence:{date:'2026-10-28'}});
 await call('/api/admin/events','POST',club({title:['晨读','Morning reading'],start:'2026-09-28',time:'07:30',endTime:'08:00',repeat:{freq:'daily',interval:1,schoolDays:true,count:8}}));
 await call('/api/admin/events','POST',club({title:['月度升旗','Flag ceremony'],start:'2026-09-28',timeMode:'allDay',time:undefined,endTime:undefined,repeat:{freq:'monthly',interval:1,ordinal:-1,weekday:1}}));

 const text=(await request('/api/feeds/calendar.ics')).text;
 assert.match(text,/BEGIN:VTIMEZONE\r\nTZID:Asia\/Shanghai\r\n[\s\S]*TZOFFSETTO:\+0800/);
 const items=vevents(text),find=(name,extra=()=>true)=>items.filter(e=>e.SUMMARY[0].includes(name)&&extra(e));
 const [base]=find('机器人社',e=>!e['RECURRENCE-ID;TZID=Asia/Shanghai']);
 assert.deepEqual(base['DTSTART;TZID=Asia/Shanghai'],['20260930T153000']);
 assert.deepEqual(base.RRULE,['FREQ=WEEKLY;BYDAY=WE;UNTIL=20261230T073000Z']);
 assert.deepEqual(base['EXDATE;TZID=Asia/Shanghai'],['20261007T153000','20261028T153000']);
 const [cancelled]=find('机器人社',e=>e['RECURRENCE-ID;TZID=Asia/Shanghai']);
 assert.deepEqual(cancelled['RECURRENCE-ID;TZID=Asia/Shanghai'],['20261021T153000']);
 assert.match(cancelled.SUMMARY[0],/^\[本次取消\] /);assert.deepEqual(cancelled.STATUS,['CANCELLED']);
 assert.equal(cancelled.UID[0],base.UID[0]);assert.match(cancelled.URL[0],/&date=2026-10-21$/);

 const [reading]=find('晨读');
 assert.deepEqual(reading.RRULE,['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261012T233000Z']);
 assert.deepEqual(reading['EXDATE;TZID=Asia/Shanghai'],['20261001T073000','20261002T073000','20261005T073000','20261006T073000','20261007T073000']);
 assert.deepEqual(reading['RDATE;TZID=Asia/Shanghai'],['20261010T073000']);
 const [flag]=find('月度升旗');
 assert.deepEqual(flag['DTSTART;VALUE=DATE'],['20260928']);assert.deepEqual(flag.RRULE,['FREQ=MONTHLY;BYDAY=-1MO']);
});

test('the assistant sees a repeating event as its concrete upcoming dates',async t=>{
 const prompts=[];
 const gateway=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  if(req.url==='/v1/capabilities'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({purposes:{flash:{enabled:true}}}));}
  prompts.push(JSON.parse(body));res.setHeader('Content-Type','text/event-stream');
  res.write(`data: ${JSON.stringify({choices:[{delta:{content:'见 [[E1]]。'}}]})}\n\n`);res.end('data: [DONE]\n\n');
 });
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>gateway.close(r)));
 const {call,request}=await setup(t,{url:`http://127.0.0.1:${gateway.address().port}`,token:'fixture-token'});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const nextWednesday=addDays(today,(3-weekdayOf(today)+7)%7||7),start=addDays(nextWednesday,-28);
 let series=await call('/api/admin/events','POST',club({start}));
 series=await call(`/api/admin/events/${series.id}/cancel`,'POST',{version:series.version,reason:'',occurrence:{date:nextWednesday,span:'one'}});
 const response=await request('/api/assistant',{method:'POST',body:{messages:[{role:'user',content:'机器人社什么时候活动？'}]},accept:'application/json'});
 assert.equal(response.status,200,response.text);
 const data=JSON.parse(prompts[0].messages[0].content.split('DATA:\n')[1]),event=data.events[0];
 assert.equal(event.repeats,'Every week on Wednesday');
 assert.deepEqual(event.dates[0],{date:nextWednesday,cancelledThisTime:true});
 assert.equal(event.dates[1],addDays(nextWednesday,7));
 assert.ok(event.dates.every(d=>(d.date||d)>=today));
 const cited=JSON.parse(response.text).citations.E1;
 assert.equal(cited.date,addDays(nextWednesday,7),'citations open the next date that goes ahead');
});
