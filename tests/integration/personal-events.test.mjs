import {request as httpRequest} from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/passwords.mjs';
import {audienceGrades,audienceParts,normalizeGrades,parseGrade} from '../../public/grades.mjs';
import {batchEvent,numberGrades} from '../../server/exam-model.mjs';

const origin='http://localhost:3000';
async function setup(t){
 const directory=await mkdtemp(join(tmpdir(),'personal-test-'));
 const instance=createApplication({dataDir:directory,origin,timeZone:'Asia/Shanghai',sso:{preview:true,previewEmail:'29wangxiaoming@school.edu.cn'}});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));instance.close();await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 // The local preview signs in a student unless the school_preview_out cookie says they signed out.
 const request=(path,{method='GET',body,cookie='school_preview_out=1'}={})=>new Promise((resolve,reject)=>{
  const payload=body===undefined?undefined:JSON.stringify(body);
  const req=httpRequest(base+path,{method,headers:{Host:'localhost:3000',Origin:origin,'Content-Type':'application/json',Cookie:cookie,...(payload?{'Content-Length':Buffer.byteLength(payload)}:{})}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,text:Buffer.concat(chunks).toString()}));});
  req.on('error',reject);req.end(payload);
 });
 await setAdminPassword(instance.db,'admin','personal-testing-password');
 const login=await new Promise((resolve,reject)=>{const payload=JSON.stringify({username:'admin',password:'personal-testing-password'});const req=httpRequest(base+'/api/login',{method:'POST',headers:{Host:'localhost:3000',Origin:origin,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),Cookie:'school_preview_out=1'}},resolve);req.on('error',reject);req.end(payload);});
 const admin=login.headers['set-cookie'][0].split(';')[0]+'; school_preview_out=1';
 const json=async r=>{assert.ok(r.status<300,`${r.status} ${r.text}`);return r.text?JSON.parse(r.text):null;};
 return {
  student:(path,method='GET',body)=>request(path,{method,body,cookie:''}),
  admin:(path,method='GET',body)=>request(path,{method,body,cookie:admin}),
  anonymous:(path,method='GET',body)=>request(path,{method,body}),
  json
 };
}

test('grade labels become numbers and audiences reach the right grades',()=>{
 assert.deepEqual(['G10','10','Grade 11','高一','初二','三年级','12年级','10.3','高2027级',13].map(parseGrade),[10,10,11,10,8,3,12,null,null,null]);
 assert.deepEqual(normalizeGrades(['middle','high'],[7,8,9,11,3]),[11]);
 assert.deepEqual(audienceGrades(['middle','high'],[11]),[7,8,9,11]);
 assert.deepEqual(audienceGrades(['schoolwide']).length,12);
 assert.deepEqual(audienceParts(['middle','high'],[8],s=>({middle:'初中部',high:'高中部'})[s]),['初中部 · 8年级','高中部']);
 const migrated=numberGrades({sessions:[{division:'high',grades:['高一','G11']},{division:'middle',grades:['X']},{division:'high',grades:[12]}]});
 assert.deepEqual(migrated.sessions.map(s=>[s.grades,Boolean(s.gradesUnverified)]),[[[10,11],false],[[7,8,9],true],[[12],false]]);
 assert.equal(numberGrades({sessions:[{division:'high',grades:[10]}]}),null);
 const event=batchEvent({id:'b',title:'期中',start:'2026-11-02',end:'2026-11-04',publishedAt:'x',sessions:[{division:'high',grades:[10,11,12]},{division:'middle',grades:[8]}]});
 assert.deepEqual([event.id,event.type,event.timeMode,event.scope,event.grades],['exam-batch-b','exam','multi',['middle','high'],[8]]);
});

test('school events take grades within their divisions and deadlines may be all day',async t=>{
 const {admin,anonymous,json}=await setup(t);
 const base={title:['初二家长会','Grade 8 meeting'],type:'activity',timeMode:'timed',start:'2026-10-20',time:'18:00',endTime:'19:00',status:'published'};
 assert.equal((await admin('/api/admin/events','POST',{...base,scope:['middle'],grades:[10]})).status,422);
 const meeting=await json(await admin('/api/admin/events','POST',{...base,scope:['middle'],grades:[8]}));
 assert.deepEqual(meeting.grades,[8]);
 // Every grade of a division is the same as the whole division.
 const whole=await json(await admin('/api/admin/events','POST',{...base,scope:['middle'],grades:[7,8,9]}));
 assert.equal(whole.grades,undefined);
 const due=await json(await admin('/api/admin/events','POST',{title:['交表','Forms due'],type:'deadline',timeMode:'deadline',start:'2026-10-21',scope:['schoolwide'],status:'published'}));
 assert.equal(due.time,undefined);
 const feed=(await anonymous('/api/feeds/calendar.ics')).text.replace(/\r\n /g,'');
 assert.match(feed,/DTSTART;VALUE=DATE:20261021\r\nDTEND;VALUE=DATE:20261022\r\nSUMMARY:截止：交表/);
});

test('personal events belong to one signed-in person, repeat, and reach only their own subscription',async t=>{
 const {student,admin,anonymous,json}=await setup(t);
 const piano={title:'钢琴课',type:'activity',timeMode:'timed',start:'2026-10-10',time:'14:00',endTime:'15:00',repeat:{freq:'weekly',interval:1,weekdays:[6]},location:'琴房',note:'带琴谱'};
 assert.equal((await anonymous('/api/personal-events','POST',piano)).status,401);
 assert.equal((await student('/api/personal-events','POST',{...piano,title:''})).status,422);
 let saved=await json(await student('/api/personal-events','POST',piano));
 assert.equal(saved.status,'published');assert.equal(saved.personal,true);
 // Another person sees none of them, and they never reach the public calendar.
 assert.deepEqual(await json(await admin('/api/personal-events')),[]);
 assert.equal((await admin('/api/personal-events/'+saved.id,'PUT',{...piano,version:saved.version})).status,404);
 assert.ok(!(await json(await anonymous('/api/events'))).some(e=>e.id===saved.id));
 // One date moves without a reschedule notice; "this and later" ends the series before a date.
 saved=await json(await student('/api/personal-events/'+saved.id,'PUT',{...piano,start:'2026-10-17',time:'16:00',endTime:'17:00',version:saved.version,occurrence:{date:'2026-10-17',span:'one'}}));
 assert.deepEqual(saved.exceptions,{'2026-10-17':{time:'16:00',endTime:'17:00'}});
 assert.equal(saved.oldDate,undefined);
 saved=await json(await student('/api/personal-events/'+saved.id,'DELETE',{version:saved.version,occurrence:{date:'2026-10-31',span:'future'}}));
 assert.equal(saved.repeat.until,'2026-10-30');
 saved=await json(await student('/api/personal-events/'+saved.id,'DELETE',{version:saved.version,occurrence:{date:'2026-10-24',span:'one'}}));
 assert.deepEqual(saved.exceptions['2026-10-24'],{deleted:true});
 const links=await json(await student('/api/feeds'));
 assert.match(links.calendarMine,/\/api\/feeds\/calendar\/[a-f0-9]{40}\.ics$/);
 const mine=(await anonymous(new URL(links.calendarMine).pathname)).text.replace(/\r\n /g,'');
 assert.match(mine,/UID:personal-.*\r\n[\s\S]*SUMMARY:钢琴课/);
 assert.match(mine,/LOCATION:琴房/);
 assert.doesNotMatch((await anonymous('/api/feeds/calendar.ics')).text,/钢琴课/);
 // Resetting the personal key replaces both personal links at once.
 const fresh=await json(await student('/api/feeds/mine/reset','POST'));
 assert.notEqual(fresh.calendarMine,links.calendarMine);
 assert.equal((await anonymous(new URL(links.calendarMine).pathname)).status,404);
 assert.equal((await student('/api/personal-events/'+saved.id,'DELETE',{version:saved.version})).status,204);
 assert.deepEqual(await json(await student('/api/personal-events')),[]);
});

test('a published exam batch appears as one read-only exam event with its grades',async t=>{
 const {admin,anonymous,json}=await setup(t);
 const session=(id,division,grades,date)=>({id,title:id,division,grades,date,start:'08:00',end:'09:00',rooms:['101']});
 const batch=await json(await admin('/api/admin/exams','POST',{title:'期中考试',titleEn:'Midterms',start:'2026-11-02',end:'2026-11-04',rooms:[{name:'101',rows:5,columns:5}],seats:[],sessions:[session('math','high',[10],'2026-11-02'),session('bio','middle',[8,9],'2026-11-03')]}));
 assert.ok(!(await json(await anonymous('/api/events'))).some(e=>e.examBatch));
 await json(await admin(`/api/admin/exams/${batch.id}/publish`,'POST',{version:batch.version}));
 const event=(await json(await anonymous('/api/events'))).find(e=>e.examBatch===batch.id);
 assert.deepEqual([event.title,event.start,event.end,event.scope,event.grades],[['期中考试','Midterms'],'2026-11-02','2026-11-04',['middle','high'],[8,9,10]]);
 assert.ok((await json(await admin('/api/admin/events'))).some(e=>e.id===event.id));
 assert.equal((await admin('/api/admin/events/'+event.id,'PUT',{...event,status:'published'})).status,404);
 assert.match((await anonymous('/api/feeds/calendar.ics')).text,/SUMMARY:期中考试/);
 // Exam grades must belong to the session's division.
 assert.equal((await admin(`/api/admin/exams/${batch.id}`,'PUT',{...batch,version:batch.version+1,sessions:[session('x','high',[8],'2026-11-02')]})).status,422);
});
