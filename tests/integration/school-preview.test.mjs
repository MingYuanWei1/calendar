import {test} from 'node:test';
import {request} from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';

test('local SSO preview supports choices and logout without enabling administrator access',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'school-preview-'));
 const origin='http://localhost:3000';
 const instance=createApplication({dataDir:directory,origin,sso:{preview:true}});
 const server=instance.app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,options={})=>new Promise((resolve,reject)=>{
  const req=request(base+'/api'+path,{method:options.method||'GET',headers:{Host:'localhost:3000',Origin:origin,'Content-Type':'application/json',...options.headers}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:{get:key=>{const value=res.headers[key];return Array.isArray(value)?value.join(','):value;}},json:async()=>JSON.parse(Buffer.concat(chunks).toString())}));
  });req.on('error',reject);req.end(options.body);
 });
 try{
  const batch={id:'preview-batch',sessions:[{id:'math'}]};
  instance.db.prepare('INSERT INTO exam_batches VALUES(?,?,?,?,?)').run(batch.id,1,JSON.stringify(batch),JSON.stringify(batch),JSON.stringify({rooms:[],seats:[]}));
  const session=await (await call('/school/session')).json();
  assert.equal(session.preview,true);assert.equal(session.user.id,'local-preview-student');
  assert.equal((await call('/admin/exams')).status,401);
  assert.equal((await call('/exams/preview-batch/seats')).status,200);
  assert.equal((await call('/exams/preview-batch/choices',{method:'PUT',body:JSON.stringify({ids:['math']})})).status,200);
  assert.deepEqual(await (await call('/exams/preview-batch/choices')).json(),['math']);
  const logout=await call('/school/logout',{method:'POST'});
  const cookie=logout.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/exams/preview-batch/seats',{headers:{Cookie:cookie}})).status,401);
  const login=await call('/school/login',{headers:{Cookie:cookie}});
  assert.equal(login.headers.get('location'),'/');
  for(const target of ['/', '/exams.html?batch=preview-batch&division=middle#details', '/exams?batch=preview-batch&division=middle#details']){
   const result=await call('/school/login?returnTo='+encodeURIComponent(target));
   assert.equal(result.headers.get('location'),target);
  }
  for(const target of ['//evil.example','/\\evil.example','https://evil.example','/api/school/login']){
   assert.equal((await call('/school/login?returnTo='+encodeURIComponent(target))).headers.get('location'),'/');
  }
  assert.match(login.headers.get('set-cookie'),/school_preview_out=;/);
  assert.deepEqual(await (await call('/exams/preview-batch/choices')).json(),['math']);
  assert.equal((await (await call('/school/session',{headers:{Host:'untrusted.example'}})).json()).user,null);
 }finally{await new Promise(resolve=>server.close(resolve));instance.close();await rm(directory,{recursive:true,force:true});}
});

for(const loginUrl of ['', 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?prompt=select_account'])test(`Microsoft flow stores the originating page and returns failures there (${loginUrl||'default endpoint'})`,async(t)=>{
 const directory=await mkdtemp(join(tmpdir(),'school-return-'));
 const instance=createApplication({dataDir:directory,origin:'http://localhost:3000',sso:{tenantId:'11111111-1111-1111-1111-111111111111',clientId:'test-client',clientSecret:'test-secret',loginUrl}});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const target='/exams?batch=sample&division=middle#details';
  const login=await fetch(base+'/api/school/login?returnTo='+encodeURIComponent(target),{redirect:'manual'});
  const authorization=new URL(login.headers.get('location'));
  assert.equal(authorization.hostname,'login.microsoftonline.com');
  assert.equal(authorization.pathname,loginUrl?'/organizations/oauth2/v2.0/authorize':'/11111111-1111-1111-1111-111111111111/oauth2/v2.0/authorize');
  assert.equal(authorization.searchParams.get('client_id'),'test-client');
  assert.equal(authorization.searchParams.get('redirect_uri'),'http://localhost:3000/api/school/callback');
  assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
  if(loginUrl)assert.equal(authorization.searchParams.get('prompt'),'select_account');
  assert.equal(instance.db.prepare('SELECT return_to FROM school_auth_states').get().return_to,target);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const cancelled=await fetch(base+'/api/school/callback?state='+authorization.searchParams.get('state')+'&error=access_denied',{headers:{Cookie:cookie},redirect:'manual'});
  assert.equal(cancelled.headers.get('location'),'/exams?batch=sample&division=middle&auth=failed#details');
  const httpFetch=globalThis.fetch;let tokenEndpoint;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
   tokenEndpoint=new URL(url);
   return Response.json({error:'invalid_grant',error_codes:[700005]},{status:400});
  });
  const failedExchange=await httpFetch(base+'/api/school/callback?state='+authorization.searchParams.get('state')+'&code=test-code',{headers:{Cookie:cookie},redirect:'manual'});
  assert.equal(tokenEndpoint.origin,authorization.origin);
  assert.equal(tokenEndpoint.pathname,authorization.pathname.replace(/authorize$/,'token'));
  assert.equal(tokenEndpoint.search,'');
  assert.equal(failedExchange.headers.get('location'),'/exams?batch=sample&division=middle&auth=failed#details');
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS count FROM school_sessions').get().count,0);
 }finally{await new Promise(resolve=>server.close(resolve));instance.close();await rm(directory,{recursive:true,force:true});}
});
