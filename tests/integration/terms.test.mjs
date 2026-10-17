import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';
import {mondayOf,termWeek,termWeeks,weekLabel} from '../../public/terms.mjs';

const autumn={id:'a',name:['2026–2027 第一学期','Autumn 2026'],start:'2026-09-02',end:'2027-01-22'};
const spring={id:'b',name:['2026–2027 第二学期','Spring 2027'],start:'2027-02-22',end:'2027-07-02'};

test('term weeks count Monday–Sunday weeks from the week holding the first day',()=>{
  assert.equal(mondayOf('2026-09-02'),'2026-08-31');assert.equal(mondayOf('2026-09-06'),'2026-08-31');assert.equal(mondayOf('2026-08-31'),'2026-08-31');
  // A Wednesday start: that whole week is week 1, including the days before the term begins.
  assert.equal(termWeek([autumn],'2026-08-31').week,1);
  assert.equal(termWeek([autumn],'2026-09-06').week,1);
  const second=termWeek([autumn],'2026-09-07');assert.equal(second.week,2);assert.equal(second.odd,false);assert.equal(second.term.id,'a');
  // Holiday weeks still count (National Day falls in week 5), and numbering runs across month boundaries.
  assert.deepEqual([termWeek([autumn],'2026-10-01').week,termWeek([autumn],'2026-10-01').odd],[5,true]);
  assert.equal(termWeek([autumn],'2026-11-02').week,10);
  // The last week counts while any of its days is in the term; after it and between terms there is no number.
  assert.equal(termWeek([autumn,spring],'2027-01-24').week,21);
  assert.equal(termWeek([autumn,spring],'2027-01-25'),null);
  assert.equal(termWeek([autumn,spring],'2027-02-14'),null);
  // Each term restarts at week 1.
  assert.equal(termWeek([autumn,spring],'2027-02-22').week,1);assert.equal(termWeek([autumn,spring],'2027-02-22').term.id,'b');
  // A week touching two terms belongs to the one just starting.
  assert.equal(termWeek([{...autumn,end:'2027-02-17'},{...spring,start:'2027-02-18'}],'2027-02-15').term.id,'b');
  const weeks=termWeeks(autumn);assert.equal(weeks.length,21);assert.deepEqual(weeks[0],{week:1,odd:true,monday:'2026-08-31',sunday:'2026-09-06'});
  assert.equal(weekLabel(second,0),'第 2 周 · 双周');assert.equal(weekLabel(second,1),'Week 2 · Even');
});

test('terms are public to read, editable by moderators, validated and versioned',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'calendar-terms-'));
  const instance=createApplication({dataDir:directory,origin:'http://calendar.test'});
  const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(r=>server.close(r));instance.close();await rm(directory,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const call=(path,method='GET',body,cookie='')=>fetch(base+path,{method,headers:{Origin:'http://calendar.test','Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
  const signIn=async(username,password)=>(await call('/login','POST',{username,password})).headers.get('set-cookie').split(';')[0];
  await setAdminPassword(instance.db,'admin','terms-testing-password');
  const admin=await signIn('admin','terms-testing-password');
  assert.equal((await call('/admin/accounts','POST',{username:'reader',password:'terms-reader-password',name:'Reader',role:1},admin)).status,201);
  const reader=await signIn('reader','terms-reader-password');
  const body={name:autumn.name,start:autumn.start,end:autumn.end};

  assert.deepEqual(await (await call('/terms')).json(),[]);
  assert.equal((await call('/admin/terms','POST',body)).status,401);
  assert.equal((await call('/admin/terms','POST',body,reader)).status,403);

  for(const bad of [{...body,name:['','']},{...body,end:'2026-09-01'},{...body,start:'2026-02-30'},{...body,end:'2027-09-03'}])
    assert.equal((await call('/admin/terms','POST',bad,admin)).status,422,JSON.stringify(bad));
  const created=await call('/admin/terms','POST',body,admin);assert.equal(created.status,201);
  const term=await created.json();assert.equal(term.version,1);assert.deepEqual(term.name,autumn.name);
  // Overlapping terms are refused, naming the clash.
  const clash=await call('/admin/terms','POST',{...body,start:'2027-01-20',end:'2027-03-01'},admin);
  assert.equal(clash.status,422);assert.match((await clash.json()).error,/2026–2027 第一学期/);
  assert.equal((await call('/admin/terms','POST',{name:spring.name,start:spring.start,end:spring.end},admin)).status,201);

  // Anyone may read them, in date order.
  const listed=await (await call('/terms')).json();assert.deepEqual(listed.map(t=>t.start),['2026-09-02','2027-02-22']);

  // Editing needs the current version; a term may move its own dates without clashing with itself.
  assert.equal((await call(`/admin/terms/${term.id}`,'PUT',{...body,start:'2026-09-01',version:1},reader)).status,403);
  const edited=await call(`/admin/terms/${term.id}`,'PUT',{...body,start:'2026-09-01',version:1},admin);
  assert.equal(edited.status,200);assert.equal((await edited.json()).version,2);
  assert.equal((await call(`/admin/terms/${term.id}`,'PUT',{...body,version:1},admin)).status,409);
  assert.equal((await call(`/admin/terms/${term.id}`,'PUT',{...body,end:'2027-02-25',version:2},admin)).status,422);
  assert.equal((await call('/admin/terms/missing','PUT',{...body,version:1},admin)).status,404);

  assert.equal((await call(`/admin/terms/${term.id}`,'DELETE',null,reader)).status,403);
  assert.equal((await call(`/admin/terms/${term.id}`,'DELETE',null,admin)).status,204);
  assert.deepEqual((await (await call('/terms')).json()).map(t=>t.name[1]),['Spring 2027']);
});
