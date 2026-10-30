import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import ExcelJS from 'exceljs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';
import {seatingWorkbook,sheetParts,finishSeats,prepareSeats,seatMaterialsError} from '../../server/seat-extract.mjs';
import {generate} from '../../server/llm-stream.mjs';
test('XLSX seat extraction preserves grid context, validates matches and only previews',async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('101');sheet.mergeCells('A1:C1');sheet.getCell('A1').value='数学 HL / SL 2026-09-21 08:10';sheet.getCell('B3').value='G12A 示例学生';
 const buffer=Buffer.from(await book.xlsx.writeBuffer());
 const layout=(await seatingWorkbook(buffer)).sheets;assert.deepEqual(layout[0].merges,['A1:C1']);assert.deepEqual(layout[0].cells.map(c=>c.address),['A1','B3']);
 await assert.rejects(()=>seatingWorkbook(Buffer.from('not xlsx')),/xlsx/);
 const seat={examId:'hl',room:'101',row:1,column:1,className:'G12A',name:'示例学生',englishName:''};let seats=[seat],enabled=true;const calls=[];
 const gateway=http.createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer test-token');res.setHeader('Content-Type','application/json');if(req.url==='/v1/capabilities')return res.end(JSON.stringify({purposes:{flash:{enabled}}}));let body='';for await(const part of req)body+=part;calls.push(JSON.parse(body));res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({seats,warnings:['请核对学生姓名']})}}]}));});
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const directory=await mkdtemp(join(tmpdir(),'seat-extract-')),instance=createApplication({dataDir:directory,origin:'http://calendar.test',llm:{url:`http://127.0.0.1:${gateway.address().port}`,token:'test-token'}}),server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api`;
 try{
  await setAdminPassword(instance.db,'admin','seat-extraction-password');const login=await fetch(base+'/login',{method:'POST',headers:{Origin:'http://calendar.test','Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'seat-extraction-password'})}),cookie=login.headers.get('set-cookie').split(';')[0];
  const batch={title:'Seats',start:'2026-09-21',end:'2026-09-21',rooms:[{name:'101',rows:2,columns:2}],seats:[],sessions:['hl','sl'].map(id=>({id,title:`数学 ${id}`,division:'high',grades:[12],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['101']}))};
  const created=await fetch(base+'/admin/exams',{method:'POST',headers:{Origin:'http://calendar.test','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(batch)});assert.equal(created.status,201);const saved=await created.json();
  const run=(name='seats.xlsx',version=saved.version,auth=cookie,data=buffer)=>fetch(`${base}/admin/exams/${saved.id}/seat-extract`,{method:'POST',headers:{Origin:'http://calendar.test','Content-Type':'application/octet-stream',Cookie:auth,'X-File-Name':name,'X-Draft-Version':String(version)},body:data});
  assert.equal((await run('seats.xlsx',saved.version,'')).status,401);
  assert.equal((await run('seats.pdf')).status,422);assert.equal((await run('seats.xlsx',99)).status,409);
  assert.equal((await run('seats.xlsx',saved.version,cookie,Buffer.from('fake'))).status,422);
  let response=await run();assert.equal(response.status,200);let result=await response.json();assert.deepEqual(result.seats.map(({grade,studentId,student,identityIssues,...original})=>original),[seat]);assert.equal(result.seats[0].grade,12);assert.equal(result.seats[0].student.graduationYear,2027);assert.deepEqual(result.errors,[]);assert.equal(result.warnings.length,1);assert.equal(calls[0].model,'flash');assert.match(calls[0].messages[1].content,/B3/);
  assert.deepEqual((await (await fetch(base+'/admin/exams',{headers:{Cookie:cookie}})).json()).find(b=>b.id===saved.id).seats,[]);assert.deepEqual(await (await fetch(base+'/admin/students',{headers:{Cookie:cookie}})).json(),[]);
  seats=[seat,{...seat,examId:'sl'}];result=await (await run()).json();assert.match(result.errors.join(''),/重复占用/);
  seats=[{...seat,examId:'unknown'}];result=await (await run()).json();assert.match(result.errors.join(''),/不匹配/);
  seats=[{...seat,row:3,column:4}];result=await (await run()).json();assert.deepEqual(result.errors,[]);assert.deepEqual(result.roomChanges,[{name:'101',from:{rows:2,columns:2},to:{rows:3,columns:4}}]);
  assert.deepEqual((await (await fetch(base+'/admin/exams',{headers:{Cookie:cookie}})).json()).find(b=>b.id===saved.id).rooms,batch.rooms);
  enabled=false;const count=calls.length;assert.equal((await run()).status,422);assert.equal(calls.length,count);
 }finally{await new Promise(r=>server.close(r));instance.close();await new Promise(r=>gateway.close(r));await rm(directory,{recursive:true,force:true});}
});
test('a large workbook is sent a few whole worksheets at a time and the answers are joined in order',async()=>{
 const sheet=(name,n)=>({name,merges:[],cells:Array.from({length:n},(_,i)=>({address:`A${i+1}`,text:'x'}))});
 assert.deepEqual(sheetParts([sheet('a',100),sheet('b',100),sheet('c',100),sheet('d',400),sheet('e',10)]).map(p=>p.map(s=>s.name)),[['a','b'],['c'],['d'],['e']]);
 const seat=name=>({examId:'hl',room:'101',row:1,column:1,className:'G12A',name,englishName:''});
 const gateway=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/capabilities')return res.end(JSON.stringify({purposes:{flash:{enabled:true}}}));
  let body='';for await(const part of req)body+=part;
  const sheetName=JSON.parse(JSON.parse(body).messages[1].content)[0].name;
  // Later parts answer first, so joining must follow part order rather than arrival order.
  await new Promise(r=>setTimeout(r,sheetName==='a'?60:0));
  if(sheetName==='e'){res.statusCode=400;return res.end('{}');}
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({seats:[seat(sheetName)],warnings:[`warn ${sheetName}`]})}}]}));
 });
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const config={url:`http://127.0.0.1:${gateway.address().port}`,token:'t'};
 const items=[],resets=[],progress={stage(){},item:(key,i,item)=>items.push(item.name),invalid(){},reset:()=>resets.push(1),text(){},source(){}};
 const request=names=>({parts:names.map(name=>({body:{model:'flash',messages:[{role:'system',content:''},{role:'user',content:JSON.stringify([sheet(name,1)])}]}})),timeout:5000});
 try{
  const raw=await generate(config,request(['a','c','d']),progress);
  assert.deepEqual(raw.seats.map(s=>s.name),['a','c','d']);assert.deepEqual(raw.warnings,['warn a','warn c','warn d']);
  assert.deepEqual(items.sort(),['a','c','d']);assert.deepEqual(resets,[]);
  // A failing part keeps the seats the other parts finished.
  const error=await generate(config,request(['a','e']),progress).then(()=>null,e=>e);
  assert.equal(error.status,400);assert.deepEqual(error.items.seats.map(s=>s.name),['a']);
 }finally{await new Promise(r=>gateway.close(r));}
});
test('a seat the sheet leaves between exams sharing its room and time is kept with every candidate',()=>{
 const context={sessions:['B','Honor'].map(id=>({id,title:`Chinese ${id}`,division:'high',grades:[10],date:'2026-07-07',start:'08:15',end:'09:45',rooms:['Room2120']})),rooms:[{name:'Room2120',rows:5,columns:5}]};
 const base={room:'Room2120',row:1,column:1,className:'10.1',name:'学生',englishName:'',source:{sheet:'G10 Chinese',cell:'B2'}};
 const result=finishSeats(context,{seats:[{...base,examIds:['B','Honor']},{...base,column:2,examIds:['Honor']},{...base,column:3,examId:'B',examIds:['Honor','B']}],warnings:[]});
 assert.deepEqual(result.seats.map(s=>[s.examId,s.examIds]),[['B',['B','Honor']],['Honor',undefined],['Honor',['Honor','B']]]);
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.invalid,[]);
});

test('pasted seating materials go to the model as numbered materials and cite them as their source',async()=>{
 const batch={start:'2026-09-21',end:'2026-09-25',sessions:[{id:'math',title:'数学',date:'2026-09-21',start:'08:00',end:'09:30',rooms:['101'],grades:[10]}],rooms:[{name:'101',rows:5,columns:5}]};
 const parts=[{kind:'text',text:'101 第1排 第1列 张三'},{kind:'image',image:'data:image/jpeg;base64,aGVsbG8=',text:''}];
 assert.equal(seatMaterialsError({parts}),null);
 assert.ok(seatMaterialsError({parts:[]}));
 for(const mode of ['ordered','unordered']){
  const {request,context,source}=await prepareSeats(Buffer.from(JSON.stringify({parts,mode})),batch,mode);
  assert.equal(source,undefined);assert.equal(context.mode,mode);
  const [system,user]=request.body.messages;
  assert.match(system.content,/numbered Material 1/);assert.match(system.content,/may show only part of the seating/);
  assert.match(system.content,/source \{page \(the number of the Material/);
  assert.doesNotMatch(system.content,/XLSX|worksheet name/);
  assert.deepEqual(user.content.map(c=>c.type),['text','text','image_url']);
 }
 const result=finishSeats({sessions:batch.sessions,rooms:batch.rooms,mode:'ordered'},{seats:[{examId:'math',room:'101',row:1,column:1,className:'G10A',name:'张三',englishName:'',grade:null,source:{page:1,quote:'张三'}}],warnings:[]});
 assert.deepEqual(result.seats[0].source,{page:1,quote:'张三'});
});
