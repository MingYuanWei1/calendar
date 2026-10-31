import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';
import {materialsForm,followJob} from '../helpers.mjs';

const origin='http://calendar.test';

// The gateway answers each kind of reading with what the test put in `state`.
async function gateway(){
 const state={sessions:[],seats:[],events:[],days:[],calls:[]};
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/capabilities')return res.end(JSON.stringify({purposes:{flash:{enabled:true}}}));
  const asked=JSON.parse(body),system=asked.messages[0].content;state.calls.push(asked);
  const answer=system.includes('exam sessions')?{sessions:state.sessions}:/seating|student list of each exam room/.test(system)?{seats:state.seats}:system.includes('calendar events')?{rows:state.events}:{rows:state.days};
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({...answer,warnings:[]})}}]}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {state,server,url:`http://127.0.0.1:${server.address().port}`};
}
async function setup(t){
 const llm=await gateway(),directory=await mkdtemp(join(tmpdir(),'checks-'));
 const instance=createApplication({dataDir:directory,origin,llm:{url:llm.url,token:'fixture-token'}});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>llm.server.close(r));instance.close();await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}/api`;
 const call=(path,method='GET',body,cookie='')=>fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 await setAdminPassword(instance.db,'admin','checks-testing-password');
 const admin=(await call('/login','POST',{username:'admin',password:'checks-testing-password'})).headers.get('set-cookie').split(';')[0];
 const json=async(path,method,body,status)=>{const r=await call(path,method,body,admin);if(status)assert.equal(r.status,status,await r.clone().text());else assert.ok(r.ok,await r.clone().text());return r.status===204?null:r.json();};
 const check=async(kind,fields={},query='')=>{
  const r=await fetch(`${base}/admin/extract-jobs/check-${kind}${query}`,{method:'POST',headers:{Origin:origin,Cookie:admin},body:materialsForm({parts:[{kind:'text',text:'参考'}]},fields)});
  assert.equal(r.status,201,await r.clone().text());
  const run=await followJob(base,admin,(await r.json()).id);assert.equal(run.status,'done',run.job.error);
  return run.job.id;
 };
 const post=(path,form)=>fetch(base+path,{method:'POST',headers:{Origin:origin,Cookie:admin},body:form});
 return {llm,json,check,post,instance};
}
const compared=(json,id)=>json('/admin/checks/'+id);
// Applies an item the way the console does: through its record's own request. Several items may change one record
// (dates of one series), so each request carries the version the record's last response gave.
const versions={};
const run=async(json,item)=>{
 const {path,method,body,record}=item.apply;
 const result=await json(path,method,record&&versions[record]?{...body,version:versions[record]}:body);
 if(result?.id&&result.version)versions[result.id]=result.version;
 return result;
};

const ids={数学:'math',物理:'phys',化学:'chem',生物:'bio',历史:'hist'};
const session=(subject,extra={})=>({id:ids[subject],title:`${subject} HL`,subject,level:'HL',division:'high',grades:[12],date:'2026-11-09',start:'08:10',end:'09:40',rooms:['101'],note:'',cancelled:false,...extra});
const batch=(sessions,seats=[])=>({title:'期中',start:'2026-11-09',end:'2026-11-13',academicYear:2026,rooms:[{name:'101',rows:5,columns:5},{name:'102',rows:5,columns:5}],sessions,seats});

test('a timetable is compared with one batch only, and its corrections go into that draft',async t=>{
 const {llm,json,check}=await setup(t);
 const midterm=await json('/admin/exams','POST',batch([session('数学'),session('物理'),session('化学'),session('生物')]),201);
 // Another batch with the same courses is never looked at.
 await json('/admin/exams','POST',{...batch([session('历史',{id:'h'})]),title:'其他'},201);
 // 生物 was published, so leaving it out cancels it instead of deleting it.
 await json(`/admin/exams/${midterm.id}/publish`,'POST',{version:midterm.version});
 llm.state.sessions=[
  {title:'数学 HL',subject:'数学',level:'HL',division:'high',grades:[12],date:'2026-11-09',start:'08:10',end:'09:40',rooms:['101']},
  {title:'物理 HL',subject:'物理',level:'HL',division:'high',grades:[12],date:'2026-11-10',start:'08:10',end:'09:40',rooms:['101']},
  {title:'历史 HL',subject:'历史',level:'HL',division:'high',grades:[12],date:'2026-11-11',start:'08:10',end:'09:40',rooms:['102']}
 ];
 const id=await check('sessions',{},`?batch=${midterm.id}`);
 let {items}=await compared(json,id);
 const by=title=>items.find(i=>i.title===title);
 assert.equal(by('数学 HL').status,'ok');
 assert.equal(by('物理 HL').status,'mismatch');assert.deepEqual(by('物理 HL').changes,[{field:'date',from:'2026-11-09',to:'2026-11-10'}]);
 assert.equal(by('历史 HL').status,'missing');
 assert.deepEqual(items.filter(i=>i.status==='extra').map(i=>[i.title,i.action]).sort(),[['化学 HL','cancel'],['生物 HL','cancel']]);
 // Applying the chosen items updates the draft in one go; what is left unticked stays.
 const keys=items.filter(i=>['物理 HL','历史 HL','生物 HL'].includes(i.title)).map(i=>i.key);
 const applied=await json(`/admin/checks/${id}/apply`,'POST',{keys});
 assert.equal(applied.applied.length,3);
 const draft=(await json('/admin/exams')).find(b=>b.id===midterm.id);
 assert.equal(draft.sessions.find(s=>s.subject==='物理').date,'2026-11-10');
 assert.ok(draft.sessions.some(s=>s.subject==='历史'));assert.ok(draft.rooms.some(r=>r.name==='102'));
 assert.equal(draft.sessions.find(s=>s.subject==='生物').cancelled,true);
 assert.equal(draft.sessions.find(s=>s.subject==='化学').cancelled,false);
 // Read again, the applied items match and only the unticked one remains.
 ({items}=await compared(json,id));
 assert.deepEqual(items.filter(i=>i.status!=='ok').map(i=>i.title),['化学 HL']);
 assert.equal((await json(`/admin/checks/${id}/apply`,'POST',{keys},422)).error.length>0,true);
});

test('an exam check needs an existing batch',async t=>{
 const {post}=await setup(t);
 assert.equal((await post('/admin/extract-jobs/check-sessions?batch=nope',materialsForm({parts:[{kind:'text',text:'x'}]}))).status,404);
 assert.equal((await post('/admin/extract-jobs/check-seats',materialsForm({parts:[{kind:'text',text:'x'}]}))).status,404);
});

test('a seating plan is compared by student and exam within one batch',async t=>{
 const {llm,json,check}=await setup(t);
 const seat=(name,column,extra={})=>({examId:'math',room:'101',row:1,column,className:'12.1',name,englishName:'',...extra});
 const created=await json('/admin/exams','POST',batch([session('数学')],[seat('甲',1),seat('乙',2),seat('丙',3)]),201);
 llm.state.seats=[seat('甲',1),seat('乙',4),seat('丁',5),{...seat('戊',6),examIds:['math','phys']}];
 const id=await check('seats',{mode:'ordered'},`?batch=${created.id}`);
 const {items}=await compared(json,id);
 const by=name=>items.find(i=>i.title.startsWith(name));
 assert.equal(by('甲').status,'ok');
 assert.equal(by('乙').status,'mismatch');assert.deepEqual(by('乙').changes,[{field:'position',from:'1-2',to:'1-4'}]);
 assert.equal(by('丁').status,'missing');
 assert.equal(by('丙').status,'extra');
 assert.equal(by('戊').status,'ambiguous');assert.equal(by('戊').apply,false);
 await json(`/admin/checks/${id}/apply`,'POST',{keys:['乙','丁','丙'].map(name=>by(name).key)});
 const seats=(await json('/admin/exams')).find(b=>b.id===created.id).seats;
 assert.deepEqual(seats.map(s=>[s.name,s.column]).sort(),[['丁',5],['乙',4],['甲',1]]);
 assert.deepEqual((await compared(json,id)).items.filter(i=>i.status!=='ok').map(i=>i.status),['ambiguous']);
});

test('the school calendar is compared with events in its dates, including single dates of a series',async t=>{
 const {llm,json,check}=await setup(t);
 const event=fields=>({type:'activity',scope:['schoolwide'],status:'published',timeMode:'allDay',...fields});
 const fair=await json('/admin/events','POST',event({title:['2026 科技节','Science Fair'],start:'2026-11-20'}),201);
 const talk=await json('/admin/events','POST',event({title:['家长会',''],start:'2026-11-12',timeMode:'timed',time:'18:00',endTime:'19:00'}),201);
 await json('/admin/events','POST',event({title:['旧活动',''],start:'2026-11-15',status:'draft'}),201);
 const club=await json('/admin/events','POST',event({title:['社团活动',''],start:'2026-11-02',timeMode:'timed',time:'15:00',endTime:'16:00',repeat:{freq:'weekly',interval:1,weekdays:[1],until:'2026-11-30'}}),201);
 // Outside the reference's dates nothing counts as extra.
 await json('/admin/events','POST',event({title:['寒假前活动',''],start:'2027-01-10'}),201);
 llm.state.events=[
  {title:{zh:'科技节'},type:'activity',start:'2026-11-21'},
  {title:{zh:'家长会'},start:'2026-11-12',time:'18:30'},
  {title:{zh:'运动会'},type:'competition',start:'2026-11-25'},
  {title:{zh:'社团活动'},start:'2026-11-02',time:'15:00'},
  {title:{zh:'社团活动'},start:'2026-11-09',time:'15:30'},
  {title:{zh:'社团活动'},start:'2026-11-23',time:'15:00'},
  {title:{zh:'社团活动'},start:'2026-11-30',time:'15:00'}
 ];
 const id=await check('events');
 const result=await compared(json,id);
 assert.deepEqual([result.from,result.to],['2026-11-02','2026-11-30']);
 const items=result.items,find=(title,status)=>items.filter(i=>i.title.includes(title)&&i.status===status);
 // "科技节" is the stored "2026 科技节": only the date differs.
 assert.deepEqual(find('科技节','mismatch')[0].changes,[{field:'date',from:'2026-11-20',to:'2026-11-21'}]);
 assert.deepEqual(find('家长会','mismatch')[0].changes,[{field:'time',from:'18:00',to:'18:30'}]);
 assert.equal(find('运动会','missing').length,1);
 assert.equal(find('旧活动','extra')[0].action,'delete');
 // The 16th is a date of the series the reference leaves out: only that date is cancelled.
 const skipped=find('社团活动','extra');
 assert.deepEqual(skipped.map(i=>i.record.date),['2026-11-16']);assert.equal(skipped[0].action,'cancel');
 assert.equal(find('寒假前活动','extra').length,0);
 // Each correction goes through the event's own API; a series' date changes alone.
 const moved=find('社团活动','mismatch')[0];assert.equal(moved.record.date,'2026-11-09');
 for(const item of [find('科技节','mismatch')[0],find('运动会','missing')[0],skipped[0],moved,find('旧活动','extra')[0]])await run(json,item);
 const events=await json('/admin/events');
 assert.equal(events.find(e=>e.id===fair.id).start,'2026-11-21');
 assert.equal(events.find(e=>e.title[0]==='运动会').status,'draft');
 const series=events.find(e=>e.id===club.id);
 assert.equal(series.exceptions['2026-11-09'].time,'15:30');assert.equal(series.exceptions['2026-11-16'].cancelled,true);
 assert.ok(!events.some(e=>e.title[0]==='旧活动'));
 // Read again, only the correction left unapplied remains; the new draft now matches its row.
 const left=(await compared(json,id)).items.filter(i=>i.status!=='ok');
 assert.deepEqual(left.map(i=>[i.record.id,i.status]),[[talk.id,'mismatch']]);
});

test('days off, make-up days and terms are compared with the stored ones in the reference range',async t=>{
 const {llm,json,check}=await setup(t);
 await json('/admin/day-plans','PUT',{start:'2026-10-01',end:'2026-10-07',kind:'off',title:['国庆','']},204);
 await json('/admin/day-plans','PUT',{start:'2026-10-10',end:'2026-10-10',kind:'half',title:['',''],follows:null},204);
 const term=await json('/admin/terms','POST',{name:['2026–2027 第一学期',''],start:'2026-09-01',end:'2027-01-20'},201);
 llm.state.days=[
  {kind:'off',start:'2026-10-01',end:'2026-10-08',title:{zh:'国庆'}},
  {kind:'school',start:'2026-10-11',title:{zh:'调休'},follows:3},
  {kind:'term',start:'2026-09-01',end:'2027-01-22',title:{zh:'第一学期'}}
 ];
 const id=await check('days',{from:'2026-09-01',to:'2026-10-31'});
 const {items}=await compared(json,id);
 const by=(kind,status)=>items.find(i=>(i.row?.kind===kind||(!i.row&&kind==='extra'))&&i.status===status);
 assert.deepEqual(by('off','mismatch').changes,[{field:'kind',from:'off / default',to:'off'}]);
 assert.equal(by('school','missing').apply.body.follows,3);
 assert.deepEqual(by('term','mismatch').changes,[{field:'end',from:'2027-01-20',to:'2027-01-22'}]);
 assert.equal(by('extra','extra').record.when,'2026-10-10');
 for(const item of items.filter(i=>i.apply))await run(json,item);
 assert.deepEqual((await compared(json,id)).items.map(i=>i.status),['ok','ok','ok']);
 assert.equal((await json('/terms')).find(t=>t.id===term.id).end,'2027-01-22');
 assert.equal((await json('/day-plans')).find(p=>p.date==='2026-10-10'),undefined);
});

test('自检 lists problems in the stored data with where to fix them',async t=>{
 const {json}=await setup(t);
 await json('/admin/day-plans','PUT',{start:'2026-11-10',end:'2026-11-10',kind:'off',title:['',''],follows:null},204);
 const seat=(name,column,examId='math')=>({examId,room:'101',row:1,column,className:'12.1',name,englishName:''});
 const created=await json('/admin/exams','POST',batch([session('数学'),session('数学',{id:'dup',title:'数学 HL 重复'}),session('物理',{date:'2026-11-10'})],[seat('甲',1),seat('甲',2,'dup')]),201);
 await json('/admin/events','POST',{title:['放假日活动',''],type:'activity',scope:['schoolwide'],status:'published',timeMode:'allDay',start:'2026-11-10'},201);
 const {issues}=await json('/admin/checks/self');
 const messages=issues.map(i=>i.message).join('\n');
 assert.match(messages,/甲 同时安排在/);
 assert.match(messages,/“物理 HL”安排在放假日/);
 assert.match(messages,/同一年级同一课程，时间重叠/);
 assert.match(messages,/“放假日活动”安排在放假日/);
 assert.ok(issues.every(i=>i.link&&i.area));
 assert.ok(issues.some(i=>i.link===`#exams/${created.id}`));
});
