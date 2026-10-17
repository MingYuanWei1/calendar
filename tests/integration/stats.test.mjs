import {request as httpRequest} from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import express from 'express';
import {createApplication} from '../../server/app.mjs';
import {openStore} from '../../server/store.mjs';
import {setAdminPassword} from '../../server/passwords.mjs';
import {installStats,weekOf} from '../../server/stats.mjs';

const origin='http://localhost:3000';
async function listen(t,app,cleanup){
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await cleanup();});
 const base=`http://127.0.0.1:${server.address().port}`;
 return (path,{method='GET',body,cookie='school_preview_out=1',ip='192.0.2.1'}={})=>new Promise((resolve,reject)=>{
  const payload=body===undefined?undefined:JSON.stringify(body);
  const req=httpRequest(base+path,{method,headers:{Host:'localhost:3000',Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-Forwarded-For':ip,...(payload?{'Content-Length':Buffer.byteLength(payload)}:{})}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,body:text?JSON.parse(text):null,headers:res.headers});});});
  req.on('error',reject);req.end(payload);
 });
}
async function setup(t){
 const directory=await mkdtemp(join(tmpdir(),'stats-test-'));
 const instance=createApplication({dataDir:directory,origin,timeZone:'Asia/Shanghai',trustProxy:'loopback',sso:{preview:true,previewEmail:'29wangxiaoming@school.edu.cn'}});
 const request=await listen(t,instance.app,async()=>{instance.close();await rm(directory,{recursive:true,force:true});});
 await setAdminPassword(instance.db,'admin','stats-testing-password');
 const login=await request('/api/login',{method:'POST',body:{username:'admin',password:'stats-testing-password'}});
 const admin=login.headers['set-cookie'][0].split(';')[0]+'; school_preview_out=1';
 return {request,instance,admin,view:(page,options={})=>request('/api/views',{method:'POST',body:{page},...options})};
}
const total=list=>list.at(-1);

test('weeks start on Monday',()=>{
 assert.equal(weekOf('2026-10-17'),'2026-10-12');
 assert.equal(weekOf('2026-10-12'),'2026-10-12');
 assert.equal(weekOf('2026-10-11'),'2026-10-05');
 assert.equal(weekOf('2027-01-01'),'2026-12-28');
});

test('views count per page, visitors count once, and signed-in students are told apart',async t=>{
 const {request,admin,view}=await setup(t);
 for(let i=0;i<3;i++)assert.equal((await view('calendar')).status,204);
 await view('exams');
 await view('calendar',{ip:'192.0.2.2'});
 await view('exams',{cookie:''});
 const stats=(await request('/api/admin/stats',{cookie:admin})).body;
 for(const unit of ['day','week','month']){
  const now=total(stats.series[unit]);
  assert.deepEqual(now.views,{calendar:4,exams:2});
  assert.deepEqual(now.visitors,{signedIn:1,anonymous:2});
 }
 assert.equal(stats.series.day.length,30);assert.equal(stats.series.week.length,12);assert.equal(stats.series.month.length,12);
 assert.equal(total(stats.series.week).start,weekOf(stats.today));
 assert.equal(total(stats.series.month).start,stats.today.slice(0,7));
});

test('admins are not counted, unknown pages are refused, and only admins can read the statistics',async t=>{
 const {request,admin,view}=await setup(t);
 assert.equal((await view('calendar',{cookie:admin})).status,204);
 assert.equal((await view('console')).status,400);
 assert.equal((await request('/api/admin/stats')).status,401);
 assert.equal((await request('/api/admin/stats',{cookie:''})).status,403);
 const now=total((await request('/api/admin/stats',{cookie:admin})).body.series.day);
 assert.deepEqual(now,{...now,views:{calendar:0,exams:0},visitors:{signedIn:0,anonymous:0}});
});

test('one visitor counts at most 50 views per page per day',async t=>{
 const {request,admin,view}=await setup(t);
 for(let i=0;i<55;i++)await view('calendar');
 await view('exams');
 const now=total((await request('/api/admin/stats',{cookie:admin})).body.series.day);
 assert.deepEqual(now.views,{calendar:50,exams:1});
});

test('a closed period keeps its counts but forgets its visitors',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'stats-test-'));
 const db=openStore(directory),app=express();
 let clock=Date.parse('2026-10-18T02:00:00Z');// Sunday in Shanghai
 app.set('trust proxy','loopback');app.use(express.json());
 installStats(app,db,{session:()=>null,requireAdmin:(req,res,next)=>next(),timeZone:'Asia/Shanghai',now:()=>clock});
 const request=await listen(t,app,async()=>{db.close();await rm(directory,{recursive:true,force:true});});
 await request('/api/views',{method:'POST',body:{page:'calendar'}});
 await request('/api/views',{method:'POST',body:{page:'calendar'},ip:'192.0.2.2'});
 const salts=db.prepare("SELECT salt FROM stat_salts WHERE unit='day'").get().salt;
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stat_visitor_keys WHERE unit='day'").get().n,2);
 clock+=86400000;// Monday: a new day and a new week, same month
 await request('/api/views',{method:'POST',body:{page:'calendar'}});
 assert.notEqual(db.prepare("SELECT salt FROM stat_salts WHERE unit='day'").get().salt,salts);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stat_visitor_keys WHERE unit='day'").get().n,1);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stat_visitor_keys WHERE unit='month'").get().n,2);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stat_page_loads').get().n,1);
 const {series}=(await request('/api/admin/stats')).body;
 assert.deepEqual(series.day.slice(-2).map(p=>[p.start,p.views.calendar,p.visitors.anonymous]),[['2026-10-18',2,2],['2026-10-19',1,1]]);
 assert.deepEqual(series.week.slice(-2).map(p=>[p.start,p.views.calendar,p.visitors.anonymous]),[['2026-10-12',2,2],['2026-10-19',1,1]]);
 assert.deepEqual(series.month.slice(-1).map(p=>[p.start,p.views.calendar,p.visitors.anonymous]),[['2026-10',3,2]]);
});
