import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword,digest} from '../../server/passwords.mjs';

test('roles protect management, migrate old accounts, and apply account changes to live sessions',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'calendar-accounts-'));
 const origin='http://localhost:3000',instance=createApplication({dataDir:directory,origin});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,method='GET',body,cookie='')=>fetch(base+'/api'+path,{redirect:'manual',method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});
 const password='a-long-password-123';
 const login=async username=>{const response=await call('/login','POST',{username,password});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
 try{
  await setAdminPassword(instance.db,'legacy',password);
  const admin=await login('legacy');
  assert.equal((await (await call('/session','GET',undefined,admin)).json()).user.role,3);
  assert.equal((await call('/admin/accounts')).status,401);
  for(const [username,role] of [['reader',1],['moderator',2],['otheradmin',3]]){
   assert.equal((await call('/admin/accounts','POST',{username,password,name:username,role},admin)).status,201);
  }
  const reader=await login('reader'),moderator=await login('moderator'),otherAdmin=await login('otheradmin');
  const pages=[['/accounts.html',3],['/exams-admin.html',2],['/?manage=events',2],['/index.html?manage=events',2]];
  for(const [cookie,role] of [['',0],[reader,1],[moderator,2],[admin,3]]){
   for(const [path,required] of pages){
    const response=await fetch(base+path,{headers:{Cookie:cookie}});
    assert.equal(response.status,role>=required?200:role?403:401);
    assert.equal(response.headers.get('cache-control'),'no-store');
    const body=await response.text();
    if(role<required)assert.equal(body,'');else assert.match(body,/<!doctype html>/i);
    const check=await call('/page-access?path='+encodeURIComponent(path),'GET',undefined,cookie);
    assert.equal(check.status,role>=required?204:role?403:401);
   }
  }
  for(const path of ['/accounts','/accounts/','/%61ccounts.html','/unused%2f..%2faccounts.html','//accounts.html','/exams-admin','/exams-admin/']){
   const response=await fetch(base+path,{headers:{Cookie:reader},redirect:'manual'});
   assert.equal(response.status,403);assert.equal(await response.text(),'');
   assert.equal((await call('/page-access?path='+encodeURIComponent(path),'GET',undefined,reader)).status,403);
  }
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await fetch(base+'/exams.html')).status,200);

  for(const cookie of [reader,moderator]){
   assert.equal((await call('/admin/accounts','GET',undefined,cookie)).status,403);
   assert.equal((await call('/admin/accounts','POST',{username:'attacker',password,name:'Attacker',role:3},cookie)).status,403);
   assert.equal((await call('/admin/accounts/local%3Areader','PATCH',{role:3,disabled:false},cookie)).status,403);
  }
  for(const path of ['/admin/events','/admin/exams']){
   assert.equal((await call(path,'GET',undefined,reader)).status,403);
   assert.equal((await call(path,'GET',undefined,moderator)).status,200);
  }
  assert.equal((await call('/admin/day-plans','PUT',{start:'2026-09-24',end:'2026-09-24',kind:'off',title:['休假','Holiday']},reader)).status,403);
  assert.equal((await call('/admin/accounts/local%3Alegacy','PATCH',{role:1,disabled:false},admin)).status,409);
  assert.equal((await call('/admin/accounts/local%3Areader','PATCH',{role:4,disabled:false},admin)).status,422);
  assert.equal((await call('/admin/accounts/local%3Amoderator','PATCH',{role:1,disabled:false},admin)).status,200);
  assert.equal((await call('/admin/events','GET',undefined,moderator)).status,403);
  assert.equal((await call('/admin/accounts/local%3Areader','PATCH',{role:2,disabled:false},admin)).status,200);
  assert.equal((await call('/admin/events','GET',undefined,reader)).status,200);
  assert.equal((await call('/admin/accounts/local%3Areader','PATCH',{role:2,disabled:true},admin)).status,200);
  assert.equal((await call('/admin/events','GET',undefined,reader)).status,401);
  assert.equal((await call('/login','POST',{username:'reader',password})).status,403);
  assert.equal((await call('/admin/accounts/local%3Aotheradmin','PATCH',{role:1,disabled:false},admin)).status,200);
  assert.equal((await call('/admin/accounts','GET',undefined,otherAdmin)).status,403);
  // School identities have reader metadata by default and share the same role checks.
  instance.db.prepare('INSERT INTO school_sessions VALUES(?,?,?,?)').run(digest('school-token'),'tenant:student','School Student',Date.now()+60000);
  const school='school_session=school-token';
  assert.equal((await (await call('/school/session','GET',undefined,school)).json()).user.role,1);
  assert.equal((await call('/admin/events','GET',undefined,school)).status,403);
  // Every login entry refuses both identity types, including the same account and stale OAuth callbacks.
  for(const cookie of [admin,school]){
   const before=await (await call('/session','GET',undefined,cookie)).json();
   for(const [path,method,body] of [['/login','POST',{username:'legacy',password}],['/login','POST',{username:'moderator',password}],['/school/login','GET'],['/school/callback?state=stale&code=stale','GET']]){
    const response=await call(path,method,body,cookie);
    assert.equal(response.status,409);
    assert.equal((await response.json()).code,'ALREADY_AUTHENTICATED');
    assert.equal(response.headers.get('set-cookie'),null);
    assert.deepEqual(await (await call('/session','GET',undefined,cookie)).json(),before);
   }
  }

  assert.equal((await call('/admin/accounts/tenant%3Astudent','PATCH',{role:2,disabled:false},admin)).status,200);
  assert.equal((await call('/admin/events','GET',undefined,school)).status,200);
  assert.equal((await (await call('/school/session','GET',undefined,school)).json()).user.role,2);
  assert.equal((await call('/admin/accounts/tenant%3Astudent','PATCH',{role:2,disabled:true},admin)).status,200);
  assert.equal((await (await call('/session','GET',undefined,school)).json()).authenticated,false);
  const accounts=await (await call('/admin/accounts','GET',undefined,admin)).json();
  assert.ok(accounts.every(account=>!('hash' in account)&&!('salt' in account)));
  assert.equal((await call('/logout','POST',{},admin)).status,204);
  assert.equal((await call('/admin/accounts','GET',undefined,admin)).status,401);
  assert.equal((await call('/login','POST',{username:'moderator',password},admin)).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));instance.close();await rm(directory,{recursive:true,force:true});}
});
