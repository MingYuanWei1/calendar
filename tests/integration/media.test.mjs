import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';

test('media is validated, private before publication, and inaccessible after deleting its event',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'calendar-media-test-'));
  const app=createApplication({dataDir:join(directory,'.data'),origin:'http://calendar.test'});
  const server=app.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={Origin:'http://calendar.test','Content-Type':'application/json'};
  try{
    await setAdminPassword(app.db,'admin','media-test-password');
    const login=await fetch(base+'/api/login',{method:'POST',headers,body:JSON.stringify({username:'admin',password:'media-test-password'})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const image=await sharp({create:{width:12,height:12,channels:3,background:'#286477'}}).png().toBuffer();
    assert.equal((await fetch(base+'/api/admin/media',{method:'POST',headers:{...headers,'Content-Type':'image/png'},body:image})).status,401);
    assert.equal((await fetch(base+'/api/admin/media',{method:'POST',headers:{...headers,Cookie:cookie,'Content-Type':'image/png'},body:Buffer.from('invalid image')})).status,422);
    const upload=await fetch(base+'/api/admin/media',{method:'POST',headers:{...headers,Cookie:cookie,'Content-Type':'image/png'},body:image});
    assert.equal(upload.status,201);const {url}=await upload.json();
    assert.equal((await fetch(base+url)).status,404);
    assert.equal((await fetch(base+url,{headers:{Cookie:cookie}})).status,200);
    const draft={title:['媒体测试','Media test'],type:'activity',timeMode:'allDay',scope:['schoolwide'],start:'2026-10-01',status:'draft',poster:url};
    let event=await (await fetch(base+'/api/admin/events',{method:'POST',headers:{...headers,Cookie:cookie},body:JSON.stringify(draft)})).json();
    assert.equal((await fetch(base+url)).status,404);
    event=await (await fetch(base+'/api/admin/events/'+event.id,{method:'PUT',headers:{...headers,Cookie:cookie},body:JSON.stringify({...event,status:'published'})})).json();
    const publicImage=await fetch(base+url);assert.equal(publicImage.status,200);assert.equal(publicImage.headers.get('content-type'),'image/webp');
    assert.equal((await fetch(base+'/api/admin/events/'+event.id,{method:'DELETE',headers:{...headers,Cookie:cookie},body:JSON.stringify({version:event.version})})).status,204);
    assert.equal((await fetch(base+url)).status,404);
    assert.equal((await fetch(base+'/.env')).status,404);
    assert.equal((await fetch(base+'/api/admin/events')).status,401);
    assert.equal((await fetch(base+'/')).headers.get('x-frame-options'),'DENY');
  }finally{await new Promise(resolve=>server.close(resolve));app.close();await rm(directory,{recursive:true,force:true});}
});
