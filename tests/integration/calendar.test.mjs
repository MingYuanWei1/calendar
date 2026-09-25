import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';

const event = {title:['开学典礼','Opening'],type:'activity',start:'2026-09-23',timeMode:'timed',time:'14:00',endTime:'15:00',scope:['schoolwide'],status:'draft'};

test('real HTTP: authentication, draft isolation, validation, persistence, transitions and logout',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'school-calendar-test-'));
  let instance, server;
  const origin='http://calendar.test';
  async function start(){instance=createApplication({dataDir:directory,origin,timeZone:'Asia/Shanghai'});server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));}
  async function stop(){await new Promise(resolve=>server.close(resolve));instance.close();}
  let cookie='';
  async function request(path,method='GET',body,extra={}){
    return fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
  }
  try{
    await start();await setAdminPassword(instance.db,'admin','test-password-very-long');
    assert.equal((await request('/api/admin/events','POST',event)).status,401);
    assert.equal((await request('/api/login','POST',{username:'admin',password:'wrong'})).status,401);
    assert.equal((await request('/api/login','POST',{username:'admin',password:'test-password-very-long'},{Origin:'https://other.test'})).status,403);
    const login=await request('/api/login','POST',{username:'admin',password:'test-password-very-long'});
    assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/);
    cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/admin/events','POST',{...event,type:'holiday'})).status,422);
    assert.equal((await request('/api/admin/events','POST',{...event,type:'deadline',timeMode:'allDay'})).status,422);
    assert.equal((await request('/api/admin/events','POST',{...event,start:'2026-02-30'})).status,422);
    assert.equal((await request('/api/admin/events','POST',{...event,registrationUrl:'javascript:alert(1)'})).status,422);
    assert.equal((await request('/api/admin/events','POST',{...event,scope:['schoolwide','high']})).status,422);
    const draftResponse=await request('/api/admin/events','POST',event);assert.equal(draftResponse.status,201);
    let saved=await draftResponse.json();
    assert.equal((await (await request('/api/events')).json()).length,0);
    assert.equal((await (await request('/api/admin/events')).json()).length,1);
    await stop();await start();
    assert.equal((await (await request('/api/admin/events')).json()).length,1);
    saved=await (await request('/api/admin/events/'+saved.id,'PUT',{...saved,status:'published'})).json();
    assert.equal((await (await request('/api/events')).json()).length,1);
    assert.equal((await request('/api/admin/events/'+saved.id,'PUT',{...saved,version:1})).status,409);
    saved=await (await request('/api/admin/events/'+saved.id,'PUT',{...saved,start:'2026-09-24'})).json();
    assert.equal(saved.previousSchedule.start,'2026-09-23');assert.equal(saved.start,'2026-09-24');
    saved=await (await request('/api/admin/events/'+saved.id+'/cancel','POST',{version:saved.version,reason:'场地维护'})).json();
    assert.equal(saved.cancelled,true);assert.equal(saved.cancelReason,'场地维护');
    assert.equal((await (await request('/api/events')).json())[0].status,'cancelled');
    assert.equal((await request('/api/admin/events/'+saved.id,'DELETE',{version:saved.version})).status,204);
    assert.equal((await (await request('/api/events')).json()).length,0);
    assert.equal((await request('/api/logout','POST')).status,204);
    assert.equal((await request('/api/admin/events')).status,401);
  }finally{if(server?.listening)await stop();await rm(directory,{recursive:true,force:true});}
});
