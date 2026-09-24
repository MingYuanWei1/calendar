import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';

test('Microsoft callback persists only the signed identity email and keeps a stable account',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'school-email-')),tenant='11111111-1111-1111-1111-111111111111',issuer=`https://login.microsoftonline.com/${tenant}/v2.0`;
 const instance=createApplication({dataDir:directory,origin:'http://localhost:3000',sso:{tenantId:tenant,clientId:'client',clientSecret:'test-secret'}});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await new Promise(r=>server.close(r));instance.close();await rm(directory,{recursive:true,force:true});});
 const {publicKey,privateKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'email-test',alg:'RS256',use:'sig'};
 const network=globalThis.fetch;let claims,nonce;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url).startsWith('https://login.microsoftonline.com/')){
   if(String(url).includes('/keys'))return Response.json({keys:[jwk]});
   const token=await new SignJWT({...claims,tid:tenant,oid:'student-one',name:'王小明',nonce}).setProtectedHeader({alg:'RS256',kid:'email-test'}).setIssuer(issuer).setAudience('client').setIssuedAt().setExpirationTime('5m').sign(privateKey);
   return Response.json({id_token:token});
  }
  return network(url,options);
 });
 async function login(email){
  claims=email?{email}:{};
  const start=await network(base+'/api/school/login',{redirect:'manual'}),authorize=new URL(start.headers.get('location'));
  assert.ok(authorize.searchParams.get('scope').split(' ').includes('email'));nonce=authorize.searchParams.get('nonce');
  const callback=await network(base+'/api/school/callback?state='+authorize.searchParams.get('state')+'&code=example&email=attacker@school.edu.cn',{redirect:'manual',headers:{Cookie:start.headers.get('set-cookie').split(';')[0]}});
  const cookie=callback.headers.get('set-cookie').split(',').map(s=>s.trim()).find(s=>s.startsWith('school_session=')).split(';')[0];
  return (await (await network(base+'/api/school/session',{headers:{Cookie:cookie}})).json()).user;
 }
 const first=await login('29WangXiaoming@school.edu.cn');assert.equal(first.email,'29wangxiaoming@school.edu.cn');
 const next=await login('29xiaoming@school.edu.cn');assert.equal(first.id,next.id);assert.equal(next.email,'29xiaoming@school.edu.cn');
 assert.equal((await login(null)).email,'');
});
