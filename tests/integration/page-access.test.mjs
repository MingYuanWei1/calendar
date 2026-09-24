import {test} from 'node:test';
import assert from 'node:assert/strict';
import pages from '../../cloudflare/pages.mjs';

test('Pages refuses protected HTML before touching assets and never caches protected responses',async()=>{
 for(const path of ['/accounts.html','/accounts','/accounts/','/%61ccounts.html','/unused%2f..%2faccounts.html','//accounts.html','/exams-admin.html','/exams-admin','/?manage=events','/index?manage=events']){
  for(const status of [401,403,503,204]){
   let assets=0,checks=0;
   const env={CALENDAR_API:{fetch:async request=>{checks++;assert.equal(request.headers.get('Cookie'),'session=test');const url=new URL(request.url);assert.equal(url.pathname,'/api/page-access');assert.equal(url.searchParams.get('path'),path);return new Response(null,{status});}},ASSETS:{fetch:async()=>{assets++;return new Response('protected page',{headers:{'Cache-Control':'public, max-age=3600'}});}}};
   const response=await pages.fetch(new Request('https://calendar.example'+path,{headers:{Cookie:'session=test'}}),env);
   assert.equal(checks,1);assert.equal(assets,status===204?1:0);
   assert.equal(response.status,status===204?200:status);
   assert.equal(await response.text(),status===204?'protected page':'');
   assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
 }
 let assets=0;
 const env={CALENDAR_API:{fetch:async()=>{throw new Error('Unavailable');}},ASSETS:{fetch:async()=>{assets++;return new Response('public');}}};
 assert.equal((await pages.fetch(new Request('https://calendar.example/accounts.html'),env)).status,503);
 assert.equal(assets,0);
 assert.equal(await (await pages.fetch(new Request('https://calendar.example/'),env)).text(),'public');
 assert.equal(assets,1);
});
