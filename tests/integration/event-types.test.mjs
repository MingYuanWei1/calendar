import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';

test('event types are the school’s own list: editable, coloured, and removed without orphaning events',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'calendar-types-'));
  const instance=createApplication({dataDir:directory,origin:'http://calendar.test'});
  const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(r=>server.close(r));instance.close();await rm(directory,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const call=(path,method='GET',body,cookie='')=>fetch(base+path,{method,headers:{Origin:'http://calendar.test','Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
  const signIn=async(username,password)=>(await call('/login','POST',{username,password})).headers.get('set-cookie').split(';')[0];
  await setAdminPassword(instance.db,'admin','types-testing-password');
  const admin=await signIn('admin','types-testing-password');
  assert.equal((await call('/admin/accounts','POST',{username:'reader',password:'types-reader-password',name:'Reader',role:1},admin)).status,201);
  const reader=await signIn('reader','types-reader-password');

  // The four defaults, in order; 考试, 活动 and 截止日 are fixed.
  const defaults=await (await call('/event-types')).json();
  assert.deepEqual(defaults.map(t=>[t.id,t.fixed]),[['exam',true],['competition',false],['activity',true],['deadline',true]]);
  assert.equal((await call('/admin/event-types','POST',{name:['讲座','Talk'],color:'#0f7c8c'},reader)).status,403);
  for(const bad of [{name:['',''],color:'#0f7c8c'},{name:['讲座','Talk'],color:'teal'},{name:['讲'.repeat(21),''],color:'#0f7c8c'}])
    assert.equal((await call('/admin/event-types','POST',bad,admin)).status,422,JSON.stringify(bad));
  const dup=await call('/admin/event-types','POST',{name:['比赛',''],color:'#0f7c8c'},admin);assert.equal(dup.status,409,await dup.text());
  const created=await call('/admin/event-types','POST',{name:['讲座','Talk'],color:'#0F7C8C'},admin);
  assert.equal(created.status,201);
  const talk=(await created.json()).at(-1);
  assert.match(talk.id,/^t[0-9a-f]{8}$/);assert.equal(talk.color,'#0f7c8c');assert.equal(talk.fixed,false);

  // Fixed types may be renamed and recoloured.
  const renamed=await (await call('/admin/event-types/activity','PUT',{name:['校园活动','Campus life'],color:'#123456'},admin)).json();
  assert.deepEqual(renamed.find(t=>t.id==='activity'),{id:'activity',name:['校园活动','Campus life'],color:'#123456',fixed:true});
  assert.equal((await call('/admin/event-types/activity','DELETE',undefined,admin)).status,422);
  assert.equal((await call('/admin/event-types/missing','PUT',{name:['x',''],color:'#000000'},admin)).status,404);

  // Events take the new type; an id that is not in the list is refused.
  const event={title:['名师讲座','Guest talk'],type:talk.id,timeMode:'timed',start:'2026-11-03',time:'14:00',endTime:'15:00',scope:['schoolwide'],status:'published'};
  assert.equal((await call('/admin/events','POST',{...event,type:'tnope0000'},admin)).status,422);
  const saved=await (await call('/admin/events','POST',event,admin)).json();
  assert.equal(saved.type,talk.id);
  const mine=await (await call('/personal-events','POST',{title:'Reading',type:talk.id,timeMode:'allDay',start:'2026-11-04'},reader)).json();

  // Removing it moves school events and 个人事件 to 活动, as a new version.
  const removed=await (await call(`/admin/event-types/${talk.id}`,'DELETE',undefined,admin)).json();
  assert.equal(removed.moved,1);assert.ok(!removed.types.some(t=>t.id===talk.id));
  const after=(await (await call('/admin/events','GET',undefined,admin)).json()).find(e=>e.id===saved.id);
  assert.equal(after.type,'activity');assert.equal(after.version,saved.version+1);
  const own=(await (await call('/personal-events','GET',undefined,reader)).json()).find(e=>e.id===mine.id);
  assert.equal(own.type,'activity');assert.equal(own.version,mine.version+1);
  // The bumped version is what the next edit must send.
  assert.equal((await call(`/admin/events/${saved.id}`,'PUT',{...event,type:'activity',version:after.version},admin)).status,200);
});
