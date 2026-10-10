import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';

const origin='http://calendar.test';

// A gateway that streams whatever `state.items` holds as the model's notice reading.
async function gateway(){
 const state={calls:[],items:[],warnings:[]};
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  if(req.url==='/v1/capabilities'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({purposes:{flash:{enabled:true}}}));}
  state.calls.push(JSON.parse(body));
  res.setHeader('Content-Type','text/event-stream');
  const content=JSON.stringify({items:state.items,warnings:state.warnings});
  res.end(`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\ndata: [DONE]\n\n`);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {state,server,url:`http://127.0.0.1:${server.address().port}`};
}

async function setup(t,llmOptions={}){
 const llm=await gateway(),directory=await mkdtemp(join(tmpdir(),'notice-test-'));
 const instance=createApplication({dataDir:directory,origin,llm:{url:llm.url,token:'fixture-token',...llmOptions}});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>llm.server.close(r));instance.close();await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}/api`;
 const call=(path,method='GET',body,cookie='',accept='application/json')=>fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',Accept:accept,Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 const signIn=async(username,password)=>(await call('/login','POST',{username,password})).headers.get('set-cookie').split(';')[0];
 await setAdminPassword(instance.db,'admin','notice-testing-password');
 const admin=await signIn('admin','notice-testing-password');
 const json=async(path,method,body,status=200)=>{const r=await call(path,method,body,admin);assert.equal(r.status,status,await r.clone().text());return r.status===204?null:r.json();};
 const extract=(body,cookie=admin)=>call('/admin/notice-extract','POST',body,cookie,'application/x-ndjson');
 const stream=async body=>{const r=await extract(body);assert.equal(r.status,200);return (await r.text()).trim().split('\n').map(line=>JSON.parse(line));};
 return {llm,call,signIn,admin,json,extract,stream};
}
const published=fields=>({type:'activity',scope:['schoolwide'],status:'published',...fields});

test('a notice becomes reviewable proposals about new, moved and cancelled events and day plans',async t=>{
 const {llm,json,stream}=await setup(t);
 const debate=await json('/admin/events','POST',published({title:['辩论赛','Debate'],type:'competition',start:'2026-10-10',timeMode:'timed',time:'15:00',endTime:'17:00',scope:['high'],location:['报告厅','Hall']}),201);
 const sports=await json('/admin/events','POST',published({title:['运动会','Sports day'],start:'2026-10-12',timeMode:'allDay'}),201);
 await json('/admin/events','POST',{...published({title:['秘密草稿','Secret draft'],start:'2026-10-13',timeMode:'allDay'}),status:'draft'},201);
 // The model refers to existing events by the short references it was given.
 llm.state.items=[
  {action:'reschedule',target:'E1',event:{start:'2026-10-17'},source:{page:1,quote:'辩论赛改至10月17日'}},
  {action:'cancel',target:'E2',cancelReason:'天气原因',source:{page:1,quote:'运动会取消'}},
  {action:'cancel',target:'E9',cancelReason:'x'},
  {action:'create',event:{title:{zh:'科技节'},type:'activity',start:'2026-10-16',time:'13:30',endTime:'16:30',scope:['middle','high'],location:{zh:'科技中心'}},source:{page:2,quote:'科技节'}},
  {action:'create',event:{title:{zh:'选课截止',en:'Course selection due'},type:'deadline',start:'2026-10-14',scope:['schoolwide','high']}},
  {action:'create',event:{title:{zh:'秋游',en:'Autumn outing'},type:'activity',start:'2026-10-20',end:'2026-10-21',scope:['primary']}},
  {action:'dayPlan',dayPlan:{start:'2026-10-24',kind:'school',title:{zh:'调休'},follows:1},source:{page:2,quote:'10月24日上课'}}
 ];
 llm.state.warnings=['第二页模糊'];
 const parts=[{kind:'text',text:'关于活动调整的通知'},{kind:'image',image:'data:image/jpeg;base64,aGVsbG8=',text:'取消'}];
 const lines=await stream({parts});
 assert.deepEqual(lines.filter(l=>l.type==='item').map(l=>l.item.action),['reschedule','cancel','cancel','create','create','create','dayPlan']);
 const done=lines.at(-1);assert.equal(done.type,'done');
 const {items,warnings}=done.result;
 assert.deepEqual(items.map(i=>i.action),['reschedule','cancel','create','create','create','dayPlan']);
 assert.equal(warnings[0],'第二页模糊');assert.ok(warnings.some(w=>/未能在校历中找到/.test(w)));

 // A reschedule keeps the event's time unless the notice changes it.
 const [moved,cancel,fair,due,outing,plan]=items;
 assert.equal(moved.target.id,debate.id);assert.equal(moved.target.version,debate.version);
 assert.deepEqual(moved.change,{start:'2026-10-17',end:'',time:'15:00',endTime:'17:00'});
 assert.deepEqual(moved.source,{page:1,quote:'辩论赛改至10月17日'});
 assert.equal(cancel.target.id,sports.id);assert.equal(cancel.cancelReason,'天气原因');
 assert.equal(fair.event.timeMode,'timed');assert.deepEqual(fair.event.scope,['middle','high']);assert.equal(fair.event.status,'draft');assert.deepEqual(fair.event.location,['科技中心','']);
 // A deadline without its time is due all day; "schoolwide" wins over specific divisions.
 assert.equal(due.event.timeMode,'deadline');assert.deepEqual(due.event.scope,['schoolwide']);assert.deepEqual(due.problems,[]);assert.equal(due.event.time,undefined);
 assert.equal(outing.event.timeMode,'multi');
 assert.deepEqual(plan.dayPlan,{start:'2026-10-24',end:'2026-10-24',kind:'school',title:['调休',''],follows:1});

 // Materials are numbered in order, images reach the model with their embedded text, and only published events are context.
 const [system,user]=llm.state.calls[0].messages;
 assert.match(user.content[0].text,/^Material 1 \(pasted text\)/);assert.match(user.content[1].text,/^Material 2 \(image; embedded PDF text: 取消\)/);assert.equal(user.content[2].type,'image_url');
 assert.match(system.content,/辩论赛/);assert.doesNotMatch(system.content,/秘密草稿/);

 // Extraction saves nothing; the reviewed proposals then go through the existing event APIs.
 assert.equal((await json('/admin/events')).length,3);
 const created=await json('/admin/events','POST',{...fair.event,status:'published'},201);
 assert.equal(created.timeMode,'timed');
 const existing=(await json('/admin/events')).find(e=>e.id===moved.target.id);
 const rescheduled=await json('/admin/events/'+existing.id,'PUT',{...existing,start:moved.change.start,time:moved.change.time,endTime:moved.change.endTime});
 assert.equal(rescheduled.start,'2026-10-17');assert.equal(rescheduled.previousSchedule.start,'2026-10-10');
 assert.equal((await json(`/admin/events/${sports.id}/cancel`,'POST',{version:cancel.target.version,reason:cancel.cancelReason})).status,'cancelled');
 await json('/admin/day-plans','PUT',plan.dayPlan,204);
 assert.deepEqual((await json('/day-plans')).find(p=>p.date==='2026-10-24'),{date:'2026-10-24',kind:'school',title:['调休',''],follows:1});
});

test('moving a multi-day event by its start date keeps its length',async t=>{
 const {llm,json,stream}=await setup(t);
 await json('/admin/events','POST',published({title:['研学旅行','Study trip'],start:'2026-10-12',end:'2026-10-14',timeMode:'multi'}),201);
 llm.state.items=[{action:'reschedule',target:'E1',event:{start:'2026-10-19'},source:{page:1,quote:'研学旅行推迟一周'}}];
 const [moved]=(await stream({parts:[{kind:'text',text:'研学旅行推迟一周'}]})).at(-1).result.items;
 assert.equal(moved.change.start,'2026-10-19');assert.equal(moved.change.end,'2026-10-21');assert.deepEqual(moved.problems,[]);
});

test('only admins may read notices, and bad or oversized materials are refused',async t=>{
 const {json,signIn,extract}=await setup(t);
 await json('/admin/accounts','POST',{username:'reader',password:'notice-reader-password',name:'Reader',role:1},201);
 const reader=await signIn('reader','notice-reader-password');
 const parts=[{kind:'text',text:'通知'}];
 assert.equal((await extract({parts},'')).status,401);
 assert.equal((await extract({parts},reader)).status,403);
 assert.equal((await extract({parts:[]})).status,422);
 assert.equal((await extract({parts:[{kind:'image',image:'data:text/html;base64,aGVsbG8='}]})).status,422);
 assert.equal((await extract({parts:Array.from({length:13},()=>({kind:'text',text:'x'}))})).status,422);
 assert.equal((await json('/admin/notice-extract')).configured,true);
});

test('notice reading counts against the AI limits and reports malformed output',async t=>{
 const {llm,extract,stream}=await setup(t,{dailyLimit:2});
 llm.state.items='not an array';
 const last=(await stream({parts:[{kind:'text',text:'通知'}]})).at(-1);
 assert.equal(last.type,'error');assert.match(last.error,/格式不正确/);
 llm.state.items=[];
 const none=(await stream({parts:[{kind:'text',text:'通知'}]})).at(-1);
 assert.deepEqual(none.result.items,[]);
 const refused=await extract({parts:[{kind:'text',text:'通知'}]});
 assert.equal(refused.status,429);assert.equal((await refused.json()).code,'LLM_QUOTA');
});
