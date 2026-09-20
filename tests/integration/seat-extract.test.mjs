import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import ExcelJS from 'exceljs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';
import {seatingWorkbook} from '../../server/seat-extract.mjs';
test('XLSX seat extraction preserves grid context, validates matches and only previews',async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('101');sheet.mergeCells('A1:C1');sheet.getCell('A1').value='数学 HL / SL 2026-09-21 08:10';sheet.getCell('B3').value='G12A 示例学生';
 const buffer=Buffer.from(await book.xlsx.writeBuffer());
 const layout=JSON.parse(await seatingWorkbook(buffer));assert.deepEqual(layout[0].merges,['A1:C1']);assert.deepEqual(layout[0].cells.map(c=>c.address),['A1','B3']);
 await assert.rejects(()=>seatingWorkbook(Buffer.from('not xlsx')),/xlsx/);
 const seat={examId:'hl',room:'101',row:1,column:1,className:'G12A',name:'示例学生',englishName:''};let seats=[seat],enabled=true;const calls=[];
 const gateway=http.createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer test-token');res.setHeader('Content-Type','application/json');if(req.url==='/v1/capabilities')return res.end(JSON.stringify({purposes:{flash:{enabled}}}));let body='';for await(const part of req)body+=part;calls.push(JSON.parse(body));res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({seats,warnings:['请核对学生姓名']})}}]}));});
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const directory=await mkdtemp(join(tmpdir(),'seat-extract-')),instance=createApplication({dataDir:directory,origin:'http://calendar.test',llm:{url:`http://127.0.0.1:${gateway.address().port}`,token:'test-token'}}),server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api`;
 try{
  await setAdminPassword(instance.db,'admin','seat-extraction-password');const login=await fetch(base+'/login',{method:'POST',headers:{Origin:'http://calendar.test','Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'seat-extraction-password'})}),cookie=login.headers.get('set-cookie').split(';')[0];
  const batch={title:'Seats',start:'2026-09-21',end:'2026-09-21',rooms:[{name:'101',rows:2,columns:2}],seats:[],sessions:['hl','sl'].map(id=>({id,title:`数学 ${id}`,division:'high',grades:['G12'],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['101']}))};
  const created=await fetch(base+'/admin/exams',{method:'POST',headers:{Origin:'http://calendar.test','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(batch)});assert.equal(created.status,201);const saved=await created.json();
  const run=(name='seats.xlsx',version=saved.version,auth=cookie,data=buffer)=>fetch(`${base}/admin/exams/${saved.id}/seat-extract`,{method:'POST',headers:{Origin:'http://calendar.test','Content-Type':'application/octet-stream',Cookie:auth,'X-File-Name':name,'X-Draft-Version':String(version)},body:data});
  assert.equal((await run('seats.xlsx',saved.version,'')).status,401);
  assert.equal((await run('seats.pdf')).status,422);assert.equal((await run('seats.xlsx',99)).status,409);
  assert.equal((await run('seats.xlsx',saved.version,cookie,Buffer.from('fake'))).status,422);
  let response=await run();assert.equal(response.status,200);let result=await response.json();assert.deepEqual(result.seats,[seat]);assert.deepEqual(result.errors,[]);assert.equal(result.warnings.length,1);assert.equal(calls[0].model,'flash');assert.match(calls[0].messages[1].content,/B3/);
  assert.deepEqual(JSON.parse(instance.db.prepare('SELECT draft FROM exam_batches WHERE id=?').get(saved.id).draft).seats,[]);
  seats=[seat,{...seat,examId:'sl'}];result=await (await run()).json();assert.match(result.errors.join(''),/重复占用/);
  seats=[{...seat,examId:'unknown'}];result=await (await run()).json();assert.match(result.errors.join(''),/不匹配/);
  seats=[{...seat,row:3}];result=await (await run()).json();assert.match(result.errors.join(''),/范围/);
  enabled=false;const count=calls.length;assert.equal((await run()).status,422);assert.equal(calls.length,count);
 }finally{await new Promise(r=>server.close(r));instance.close();await new Promise(r=>gateway.close(r));await rm(directory,{recursive:true,force:true});}
});
