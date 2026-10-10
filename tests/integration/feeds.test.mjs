import {request as httpRequest} from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/passwords.mjs';

const origin='http://localhost:3000';
async function setup(t){
 const directory=await mkdtemp(join(tmpdir(),'feeds-test-'));
 const instance=createApplication({dataDir:directory,origin,timeZone:'Asia/Shanghai',sso:{preview:true,previewEmail:'29wangxiaoming@school.edu.cn'}});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));instance.close();await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 // On the local preview, the preview student is signed in unless school_preview_out=1 is sent.
 const request=(path,{method='GET',body,cookie='school_preview_out=1'}={})=>new Promise((resolve,reject)=>{
  const req=httpRequest(base+path,{method,headers:{Host:'localhost:3000',Origin:origin,'Content-Type':'application/json',Cookie:cookie}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));});
  req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
 await setAdminPassword(instance.db,'admin','feeds-testing-password');
 const login=await request('/api/login',{method:'POST',body:{username:'admin',password:'feeds-testing-password'}});
 const admin=login.headers['set-cookie'][0].split(';')[0]+'; school_preview_out=1';
 const call=async(path,method='GET',body,cookie=admin)=>{const r=await request(path,{method,body,cookie});assert.ok(r.status<300,`${path} ${r.status} ${r.text}`);return r.text?JSON.parse(r.text):null;};
 return {request,call,student:''};
}
const event=fields=>({type:'activity',scope:['schoolwide'],location:['礼堂','Hall'],status:'published',...fields});
/** The unfolded VEVENT blocks of a calendar file, as maps of property name (with parameters) to value. */
function events(text){
 assert.ok(text.endsWith('\r\n'));
 for(const line of text.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75,`line longer than 75 octets: ${line}`);
 const unfolded=text.replace(/\r\n /g,'');
 return [...unfolded.matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT/g)].map(m=>Object.fromEntries(m[1].trim().split('\r\n').map(line=>{const i=line.indexOf(':');return [line.slice(0,i),line.slice(i+1)];})));
}

test('the school calendar feed carries published events, changes and day plans in school time',async t=>{
 const {request,call}=await setup(t);
 await call('/api/admin/events','POST',event({title:['开学典礼','Opening ceremony'],start:'2026-09-23',timeMode:'timed',time:'09:00',endTime:'10:30'}));
 await call('/api/admin/events','POST',event({title:['草稿活动','Draft'],start:'2026-09-24',timeMode:'allDay',status:'draft'}));
 const fair=await call('/api/admin/events','POST',event({title:['社团招新，含“分号；逗号,”','Club fair'],start:'2026-09-25',timeMode:'allDay',description:['全天在操场举行。'.repeat(12),'']}));
 await call('/api/admin/events/'+fair.id,'PUT',{...fair,start:'2026-09-26'});
 const sports=await call('/api/admin/events','POST',event({title:['运动会','Sports day'],start:'2026-10-08',end:'2026-10-09',timeMode:'multi'}));
 await call(`/api/admin/events/${sports.id}/cancel`,'POST',{version:sports.version,reason:'天气原因'});
 await call('/api/admin/events','POST',event({title:['选课截止','Course selection due'],type:'deadline',start:'2026-09-30',timeMode:'deadline',time:'17:00'}));
 await call('/api/admin/day-plans','PUT',{start:'2026-10-01',end:'2026-10-07',kind:'off',title:['国庆节','National Day']});
 await call('/api/admin/day-plans','PUT',{start:'2026-10-10',kind:'school',title:['调休','Make-up day'],follows:5});

 const response=await request('/api/feeds/calendar.ics',{cookie:''});
 assert.equal(response.status,200);assert.match(response.headers['content-type'],/^text\/calendar/);
 assert.match(response.text,/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
 const items=events(response.text),bySummary=name=>items.find(e=>e.SUMMARY.includes(name));
 assert.equal(items.length,6);
 assert.ok(!bySummary('草稿活动'));
 const opening=bySummary('开学典礼');
 assert.equal(opening.DTSTART,'20260923T010000Z');assert.equal(opening.DTEND,'20260923T023000Z');assert.equal(opening.LOCATION,'礼堂');
 const moved=bySummary('社团招新');
 assert.equal(moved['DTSTART;VALUE=DATE'],'20260926');assert.equal(moved['DTEND;VALUE=DATE'],'20260927');
 assert.match(moved.SUMMARY,/分号；逗号\\,/);assert.match(moved.DESCRIPTION,/原定 2026-09-25/);
 const cancelled=bySummary('运动会');
 assert.equal(cancelled.STATUS,'CANCELLED');assert.match(cancelled.SUMMARY,/^\[已取消\]/);assert.match(cancelled.DESCRIPTION,/天气原因/);
 assert.equal(cancelled['DTEND;VALUE=DATE'],'20261010');
 assert.match(bySummary('选课截止').SUMMARY,/^截止：/);
 const holiday=bySummary('国庆节');
 assert.equal(holiday['DTSTART;VALUE=DATE'],'20261001');assert.equal(holiday['DTEND;VALUE=DATE'],'20261008');assert.equal(holiday.TRANSP,'TRANSPARENT');
 assert.match(bySummary('调休').SUMMARY,/按周五课表/);
 assert.equal(new Set(items.map(e=>e.UID)).size,items.length);
 // UIDs stay the same between fetches so calendar apps update instead of duplicating.
 assert.deepEqual(events((await request('/api/feeds/calendar.ics')).text).map(e=>e.UID),items.map(e=>e.UID));

 const english=events((await request('/api/feeds/calendar.ics?lang=en')).text);
 assert.ok(english.some(e=>e.SUMMARY==='Opening ceremony'));assert.ok(english.some(e=>/^\[Cancelled\] Sports day/.test(e.SUMMARY)));
});

const batch=()=>({title:'期中考试',titleEn:'Midterms',start:'2026-09-21',end:'2026-10-04',academicYear:2026,rooms:[{name:'A',rows:3,columns:3},{name:'B',rows:3,columns:3}],
 sessions:[{id:'math',title:'数学',titleEn:'Mathematics',division:'high',grades:[10],date:'2026-09-23',start:'08:00',end:'09:00',rooms:['A','B']},{id:'physics',title:'物理',titleEn:'Physics',division:'high',grades:[10],date:'2026-09-24',start:'10:00',end:'11:30',rooms:['A']}],
 seats:[{examId:'math',room:'B',row:1,column:2,className:'10.5',name:'王小明',englishName:'Ming'}]});
async function publishExams(call){
 await call('/api/admin/students/settings','PUT',{domain:'school.edu.cn'});
 let b=await call('/api/admin/exams','POST',batch());
 b=await call(`/api/admin/exams/${b.id}/publish`,'POST',{version:b.version});
 return call(`/api/admin/exams/${b.id}/publish-seats`,'POST',{version:b.version});
}

test('the exam feed lists every published session without seats',async t=>{
 const {request,call}=await setup(t);
 await publishExams(call);
 const items=events((await request('/api/feeds/exams.ics',{cookie:''})).text);
 assert.deepEqual(items.map(e=>e.SUMMARY).sort(),['考试：数学','考试：物理']);
 const math=items.find(e=>e.SUMMARY==='考试：数学');
 assert.equal(math.DTSTART,'20260923T000000Z');assert.equal(math.LOCATION,'A\\, B');assert.doesNotMatch(math.DESCRIPTION||'',/座位/);
});

test('a student subscribes to their own exams through a personal link that can be replaced',async t=>{
 const {request,call,student}=await setup(t);
 await publishExams(call);
 const anonymous=await call('/api/feeds','GET',undefined,'school_preview_out=1');
 assert.ok(anonymous.calendar.endsWith('/api/feeds/calendar.ics'));assert.ok(anonymous.exams.endsWith('/api/feeds/exams.ics'));assert.equal(anonymous.mine,null);
 assert.equal((await request('/api/feeds/mine/reset',{method:'POST'})).status,401);

 const links=await call('/api/feeds','GET',undefined,student);
 assert.ok(links.mine.startsWith(origin+'/api/feeds/mine/'));
 assert.equal((await call('/api/feeds','GET',undefined,student)).mine,links.mine);
 const path=new URL(links.mine).pathname;
 // A calendar app sends no cookies; "my exams" is first filled from the student's published seats.
 let response=await request(path,{cookie:''});
 assert.equal(response.status,200);
 let items=events(response.text);
 assert.equal(items.length,1);
 assert.match(items[0].SUMMARY,/数学 · B/);assert.equal(items[0].LOCATION,'B 第 1 排，第 2 列');assert.match(items[0].DESCRIPTION,/我的座位/);

 const replaced=await call('/api/feeds/mine/reset','POST',{},student);
 assert.notEqual(replaced.mine,links.mine);
 assert.equal((await request(path,{cookie:''})).status,404);
 assert.equal((await request(new URL(replaced.mine).pathname+'?lang=en',{cookie:''})).status,200);
 items=events((await request(new URL(replaced.mine).pathname+'?lang=en',{cookie:''})).text);
 assert.match(items[0].SUMMARY,/^Exam: Mathematics · B/);
 assert.equal((await request('/api/feeds/mine/not-a-token.ics',{cookie:''})).status,404);
});

test('a disabled account loses its personal feed',async t=>{
 const {request,call,student}=await setup(t);
 await publishExams(call);
 const links=await call('/api/feeds','GET',undefined,student);
 const me=(await call('/api/school/session','GET',undefined,student)).user;
 await call('/api/admin/accounts/'+me.id,'PATCH',{role:me.role,disabled:true});
 assert.equal((await request(new URL(links.mine).pathname,{cookie:''})).status,404);
});
