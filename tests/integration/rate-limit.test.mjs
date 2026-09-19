import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';

test('trusted proxy login limits isolate clients; untrusted forwarding headers are ignored',async()=>{
  for(const trustProxy of ['loopback','']){
    const directory=await mkdtemp(join(tmpdir(),'calendar-rate-test-'));
    const instance=createApplication({dataDir:directory,origin:'http://calendar.test',trustProxy});
    const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const login=(ip,password)=>fetch(`http://127.0.0.1:${server.address().port}/api/login`,{method:'POST',headers:{Origin:'http://calendar.test','Content-Type':'application/json','X-Forwarded-For':ip},body:JSON.stringify({username:'admin',password})});
    try{
      await setAdminPassword(instance.db,'admin','rate-test-password');
      for(let attempt=0;attempt<10;attempt++)assert.equal((await login('192.0.2.1','wrong')).status,401);
      assert.equal((await login('192.0.2.1','wrong')).status,429);
      assert.equal((await login('192.0.2.2','rate-test-password')).status,trustProxy?200:429);
    }finally{await new Promise(resolve=>server.close(resolve));instance.close();await rm(directory,{recursive:true,force:true});}
  }
});
