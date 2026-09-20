import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';

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
    assert.equal((await save(plan)).status,204);
    let days=await (await fetch(base+'/api/day-plans')).json();assert.equal(days.length,3);assert.equal(days[0].kind,'off');
    assert.equal((await save({...plan,start:'2026-09-27',kind:'school'})).status,204);
    days=await (await fetch(base+'/api/day-plans')).json();assert.equal(days[2].kind,'school');
    assert.equal((await save({...plan,kind:'default'})).status,204);
    assert.deepEqual(await (await fetch(base+'/api/day-plans')).json(),[]);
  }finally{await new Promise(resolve=>server.close(resolve));instance.close();await rm(directory,{recursive:true,force:true});}
});
