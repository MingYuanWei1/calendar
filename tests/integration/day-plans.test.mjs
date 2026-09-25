import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {openStore,setAdminPassword} from '../../server/store.mjs';

test('school date overrides require login, validate ranges, persist and restore defaults',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'calendar-days-'));
  const instance=createApplication({dataDir:directory,origin:'http://calendar.test'});
  const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,headers={Origin:'http://calendar.test','Content-Type':'application/json'};
  try{
    const plan={start:'2026-09-25',end:'2026-09-27',kind:'off',title:['秋季休假','Autumn break']};
    const save=body=>fetch(base+'/api/admin/day-plans',{method:'PUT',headers,body:JSON.stringify(body)});
    assert.equal((await save(plan)).status,401);
    await setAdminPassword(instance.db,'admin','day-plan-test-password');
    const login=await fetch(base+'/api/login',{method:'POST',headers,body:JSON.stringify({username:'admin',password:'day-plan-test-password'})});headers.Cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await save({...plan,end:'2026-09-24'})).status,422);
    assert.equal((await save({...plan,start:'2026-02-30'})).status,422);
    assert.equal((await save({...plan,end:'2026-02-30'})).status,422);
    assert.equal((await save({...plan,end:'2027-09-26'})).status,422);
    assert.equal((await save(plan)).status,204);
    let days=await (await fetch(base+'/api/day-plans')).json();assert.equal(days.length,3);assert.equal(days[0].kind,'off');
    assert.equal((await save({...plan,start:'2026-09-27',kind:'school'})).status,204);
    days=await (await fetch(base+'/api/day-plans')).json();assert.equal(days[2].kind,'school');
    assert.equal((await save({...plan,kind:'half',title:['半天安排','Half day']})).status,204);
    days=await (await fetch(base+'/api/day-plans')).json();assert.equal(days.length,3);assert.ok(days.every(day=>day.kind==='half'));
    assert.equal((await save({...plan,kind:'invalid'})).status,422);
    assert.equal((await save({...plan,kind:'default'})).status,204);
    assert.deepEqual(await (await fetch(base+'/api/day-plans')).json(),[]);
    // A single selected date must work with either an equal end or no range end.
    for(const kind of ['off','school','half']){
      for(const end of ['2026-10-02',undefined,'']){
        const response=await save({start:'2026-10-02',end,kind,title:['','']});
        assert.equal(response.status,204,`${kind}, end=${String(end)}: ${await response.text()}`);
        const stored=await (await fetch(base+'/api/day-plans')).json();
        assert.deepEqual(stored,[{date:'2026-10-02',kind,title:['','']}]);
      }
    }
    assert.equal((await save({start:'2026-10-02',kind:'default'})).status,204);
    assert.deepEqual(await (await fetch(base+'/api/day-plans')).json(),[]);

  }finally{await new Promise(resolve=>server.close(resolve));instance.close();await rm(directory,{recursive:true,force:true});}
});


test('retired holiday test events are removed on startup without changing day plans or other events',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'calendar-retire-holidays-'));
  const db=openStore(directory);
  for(const type of ['holiday','activity'])db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(type,'published',1,JSON.stringify({id:type,type,status:'published',start:'2026-09-25'}));
  db.prepare('INSERT INTO day_plans VALUES(?,?,?)').run('2026-09-25','off','["假期","Holiday"]');
  db.close();
  let instance;
  try{
    instance=createApplication({dataDir:directory,origin:'http://calendar.test'});
    assert.deepEqual(instance.db.prepare('SELECT id FROM events').all().map(row=>row.id),['activity']);
    assert.equal(instance.db.prepare('SELECT kind FROM day_plans').get().kind,'off');
  }finally{instance?.close();await rm(directory,{recursive:true,force:true});}
});
