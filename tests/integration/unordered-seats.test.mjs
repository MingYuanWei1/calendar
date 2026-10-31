import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import ExcelJS from 'exceljs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';
import {localRunner} from '../../server/extract-jobs.mjs';
import {localStep} from '../../server/extract-run.mjs';
import {prepareSeats,finishSeats} from '../../server/seat-extract.mjs';
import {materialsForm} from '../helpers.mjs';
import {seatErrors,batchSchema} from '../../server/exam-model.mjs';
import {adaptRooms,examMode,mergeSeats,modeConflicts} from '../../public/exam-seats.mjs';
import {seatingMarkup} from '../../public/exam-common.js';

const sessions=[
 {id:'b',title:'Chinese B',division:'high',grades:[10],date:'2026-07-07',start:'08:15',end:'09:45',rooms:['101','102']},
 {id:'honor',title:'Chinese Honor',division:'high',grades:[10],date:'2026-07-07',start:'08:15',end:'09:45',rooms:['101']},
 {id:'math',title:'Math',division:'high',grades:[10],date:'2026-07-07',start:'10:15',end:'11:45',rooms:['101']}
];
const rooms=[{name:'101',rows:2,columns:2},{name:'102',rows:2,columns:2}];
const student=(examId,room,extra={})=>({examId,room,className:'10.1',name:'学生',englishName:'Student',...extra});

test('unordered extraction asks for room lists and drops positions; ordered extraction needs them',async()=>{
 const book=new ExcelJS.Workbook();book.addWorksheet('101').getCell('A1').value='10.1 学生';
 const buffer=Buffer.from(await book.xlsx.writeBuffer()),batch={start:'2026-07-07',end:'2026-07-07',sessions,rooms};
 const materials={parts:[],workbooks:[{name:'seats.xlsx',buffer}]};
 const unordered=await prepareSeats(materials,batch,'unordered'),ordered=await prepareSeats(materials,batch);
 const instruction=prepared=>prepared.request.parts[0].body.messages[0].content;
 assert.match(instruction(unordered),/Do NOT return row or column/);assert.doesNotMatch(instruction(unordered),/podium/);
 assert.match(instruction(ordered),/podium/);
 assert.equal(unordered.context.mode,'unordered');assert.equal(ordered.context.mode,'ordered');
 const source={sheet:'101',cell:'A1'};
 const listed=finishSeats(unordered.context,{seats:[{...student('b','101'),row:9,column:9,source},{...student('b','101',{name:'二'}),source}],warnings:[]});
 assert.deepEqual(listed.seats.map(s=>[s.row,s.column]),[[undefined,undefined],[undefined,undefined]]);
 assert.deepEqual(listed.errors,[]);assert.deepEqual(listed.roomChanges,[]);
 const placed=finishSeats(ordered.context,{seats:[{...student('b','101'),source},{...student('b','101',{row:1,column:1}),source}],warnings:[]});
 assert.equal(placed.seats.length,1);assert.equal(placed.invalid.length,1);
});

test('an exam is seated either in order or as room lists, and exams sharing a room at once share the mode',()=>{
 const listed=[student('b','101'),student('b','102',{name:'二'})];
 assert.deepEqual(seatErrors({sessions,rooms},listed),[]);
 assert.equal(examMode(listed,'b'),'unordered');assert.equal(examMode(listed,'math'),null);
 assert.equal(examMode([student('math','101',{row:1,column:1})],'math'),'ordered');
 // The same exam in another room, and another exam sharing room 101 at the same time, both conflict.
 assert.match(seatErrors({sessions,rooms},[...listed,student('b','102',{row:1,column:1})]).join(),/Chinese B · 102：与该场考试其他座位冲突/);
 assert.match(seatErrors({sessions,rooms},[...listed,student('honor','101',{row:1,column:1})]).join(),/Chinese Honor · 101/);
 // A later exam in the same room is free to use the other mode.
 assert.deepEqual(seatErrors({sessions,rooms},[...listed,student('math','101',{row:1,column:1})]),[]);
 // Imports are checked against the draft seats they would join.
 assert.deepEqual(modeConflicts(sessions,listed,[student('honor','101')]),[]);
 assert.deepEqual(modeConflicts(sessions,listed,[student('honor','101',{row:2,column:2}),student('honor','101',{row:1,column:2})]),['Chinese Honor · 101：与该场考试其他座位冲突（已有不排序的座位）']);
 assert.deepEqual(modeConflicts(sessions,[student('b','101',{row:1,column:1})],[student('b','102')]),['Chinese B · 102：与该场考试其他座位冲突（已有按座位排序的座位）']);
 // Rooms never grow for room lists, and room lists merge by student only.
 assert.deepEqual(adaptRooms({rooms},listed).changes,[]);
 const merged=mergeSeats(listed,[student('b','101',{englishName:'Renamed',name:'学生'})]);
 assert.equal(merged.seats.length,3);assert.equal(merged.added.length,1);
 const parsed=batchSchema.safeParse({title:'T',start:'2026-07-07',end:'2026-07-07',sessions,rooms,seats:[student('b','101',{row:1})]});
 assert.equal(parsed.success,false);
});

test('students see a room list for unordered exams with their own row marked',()=>{
 const batch={sessions};
 const seating={rooms,seats:[student('b','101',{studentId:'s1'}),student('b','101',{name:'二',studentId:'s2'}),student('honor','101',{name:'三',studentId:'s3'})]};
 const html=seatingMarkup(batch,seating,sessions[0],'101','08:15',0,false,{studentId:'s2',room:'101'});
 assert.match(html,/<th>班级<\/th><th>中文名<\/th><th>英文名<\/th><th>考试<\/th>/);
 assert.equal((html.match(/<tr/g)||[]).length,4);
 assert.match(html,/<tr class="my-seat"><td>10\.1<\/td><td>二<\/td>/);
 assert.doesNotMatch(html,/seating-grid/);
 const alone=seatingMarkup(batch,{rooms,seats:[student('b','102')]},sessions[0],'102','08:15',1);
 assert.match(alone,/<th>English name<\/th><\/tr>/);
});

test('the chosen mode reaches the extraction job and its retry, and a mismatching import is blocked',async()=>{
 const book=new ExcelJS.Workbook();book.addWorksheet('101').getCell('A1').value='10.1 学生';
 const buffer=Buffer.from(await book.xlsx.writeBuffer());
 const asked=[];
 const gateway=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/capabilities')return res.end(JSON.stringify({purposes:{flash:{enabled:true}}}));
  let body='';for await(const part of req)body+=part;asked.push(JSON.parse(body).messages[0].content);
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({seats:[{...student('b','101'),source:{sheet:'101',cell:'A1'}}],warnings:[]})}}]}));
 });
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const directory=await mkdtemp(join(tmpdir(),'unordered-seats-'));
 const instance=createApplication({dataDir:directory,origin:'http://calendar.test',llm:{url:`http://127.0.0.1:${gateway.address().port}`,token:'test-token'},extractRunner:(ops,config)=>localRunner(ops,config,localStep(10))});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api`;
 try{
  await setAdminPassword(instance.db,'admin','unordered-seats-password');
  const login=await fetch(base+'/login',{method:'POST',headers:{Origin:'http://calendar.test','Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'unordered-seats-password'})}),cookie=login.headers.get('set-cookie').split(';')[0];
  const headers={Origin:'http://calendar.test',Cookie:cookie};
  const created=await (await fetch(base+'/admin/exams',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({title:'T',start:'2026-07-07',end:'2026-07-07',sessions,rooms,seats:[student('honor','101',{row:1,column:1})]})})).json();
  const finished=async id=>{for(let i=0;i<200;i++){const job=(await (await fetch(base+'/admin/extract-jobs',{headers})).json()).find(j=>j.id===id);if(job.status!=='running')return job;await new Promise(r=>setTimeout(r,10));}throw new Error('job did not finish');};
  const job=await (await fetch(`${base}/admin/extract-jobs/seats?batch=${created.id}`,{method:'POST',headers:{Origin:headers.Origin,Cookie:headers.Cookie},body:materialsForm({workbooks:[{name:'seats.xlsx',buffer}]},{mode:'unordered'})})).json();
  assert.equal((await finished(job.id)).status,'done');
  assert.match(asked.at(-1),/Do NOT return row or column/);
  const {result}=await (await fetch(`${base}/admin/extract-jobs/${job.id}/result`,{headers})).json();
  assert.equal(result.seats[0].row,undefined);
  // Chinese Honor already sits in order in room 101 at the same time.
  assert.match(result.errors.join(),/Chinese B · 101：与该场考试其他座位冲突（已有按座位排序的座位）/);
  const retried=await fetch(`${base}/admin/extract-jobs/${job.id}/retry`,{method:'POST',headers});assert.equal(retried.status,200);
  await finished(job.id);assert.match(asked.at(-1),/Do NOT return row or column/);
  const preview=await (await fetch(`${base}/admin/exams/${created.id}/student-preview`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({version:created.version,seats:result.seats.map(({source,student,identityIssues,...seat})=>seat)})})).json();
  assert.match(preview.errors.join(),/与该场考试其他座位冲突/);
  // Saving a draft that mixes the modes is refused too.
  const mixed=await fetch(`${base}/admin/exams/${created.id}`,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({...created,seats:[...created.seats,student('b','101')]})});
  assert.equal(mixed.status,422);assert.match((await mixed.json()).error,/与该场考试其他座位冲突/);
 }finally{await new Promise(r=>server.close(r));instance.close();await new Promise(r=>gateway.close(r));await rm(directory,{recursive:true,force:true});}
});
