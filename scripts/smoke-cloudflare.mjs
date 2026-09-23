import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
const origin=process.argv[2]||'http://localhost:8787';
const password=(await readFile('.data/cloudflare-admin-login.txt','utf8')).match(/^Password: (.+)$/m)[1];
let cookie='',eventId='',batchId='';
async function request(path,method='GET',body,headers={}){
 return fetch(origin+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body&&!Buffer.isBuffer(body)?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:Buffer.isBuffer(body)?body:JSON.stringify(body)}:{})});
}
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
try{
 assert.equal((await request('/api/admin/events')).status,401);
 await json(await request('/api/config'));
 const login=await request('/api/login','POST',{username:'admin',password});await json(login);cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/api/login','POST',{username:'admin',password},{Origin:'https://wrong.invalid'})).status,403);
 const image=await sharp({create:{width:10,height:10,channels:3,background:'#3671a1'}}).png().toBuffer();
 const uploaded=await json(await request('/api/admin/media','POST',image,{'Content-Type':'image/png'}),201);
 const adminCookie=cookie;cookie='';assert.equal((await request(uploaded.url)).status,404);cookie=adminCookie;
 let event=await json(await request('/api/admin/events','POST',{title:['部署验收','Deployment verification'],type:'activity',start:'2026-09-23',timeMode:'timed',time:'14:00',endTime:'15:00',scope:['schoolwide'],status:'draft',poster:uploaded.url}),201);eventId=event.id;
 assert.ok(!(await json(await request('/api/events'))).some(e=>e.id===eventId));
 event=await json(await request('/api/admin/events/'+eventId,'PUT',{...event,status:'published'}));
 cookie='';assert.equal((await request(uploaded.url)).status,200);assert.ok((await json(await request('/api/events'))).some(e=>e.id===eventId));cookie=adminCookie;
 assert.equal((await request('/api/admin/events/'+eventId,'PUT',{...event,version:1})).status,409);
 const batch={title:'部署验收',titleEn:'Deployment verification',start:'2026-09-23',end:'2026-09-24',rooms:[],sessions:[],seats:[]};
 const saved=await json(await request('/api/admin/exams','POST',batch),201);batchId=saved.id;
 const template=await request('/api/admin/exams/'+batchId+'/template');assert.equal(template.status,200,await template.clone().text());const xlsx=Buffer.from(await template.arrayBuffer());assert.equal(xlsx.subarray(0,2).toString(),'PK');
 const preview=await json(await request('/api/admin/exams/'+batchId+'/import-preview','POST',xlsx,{'Content-Type':'application/octet-stream'}));assert.deepEqual(preview.errors,[]);
 const pdf=await request('/api/exam-schedule-pdf','POST',{pages:[{width:800,height:400,items:[{kind:'text',x:10,y:10,width:200,height:40,color:[0,0,0],text:'考试 Exam',size:20,bold:false}]}]});assert.equal(pdf.status,200,await pdf.clone().text());assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
 assert.equal((await request('/api/admin/events/'+eventId,'DELETE',{version:event.version})).status,204);eventId='';
 assert.equal((await request('/api/admin/exams/'+batchId,'DELETE',{version:saved.version})).status,204);batchId='';
 assert.equal((await request('/api/logout','POST')).status,204);
 assert.equal((await request('/api/admin/events')).status,401);
 console.log('PASS: login, CSRF, draft isolation, image upload/privacy, publish/conflicts, exams, XLSX template/import, Chinese PDF, deletion, logout.');
}finally{
 if(eventId){const events=await json(await request('/api/admin/events'));const event=events.find(e=>e.id===eventId);if(event)await request('/api/admin/events/'+eventId,'DELETE',{version:event.version});}
 if(batchId){const batches=await json(await request('/api/admin/exams'));const batch=batches.find(e=>e.id===batchId);if(batch)await request('/api/admin/exams/'+batchId,'DELETE',{version:batch.version});}
}
