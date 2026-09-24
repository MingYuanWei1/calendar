import {request as httpRequest} from 'node:http';
import ExcelJS from 'exceljs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/passwords.mjs';

const source=()=>({title:'学生关联考试',start:'2026-09-21',end:'2026-10-04',academicYear:2026,rooms:[{name:'A',rows:3,columns:3},{name:'B',rows:3,columns:3}],sessions:[{id:'math',title:'数学',division:'high',grades:['G10'],date:'2026-09-23',start:'08:00',end:'09:00',rooms:['A','B']}],seats:[{examId:'math',room:'B',row:1,column:2,className:'10.5',name:'王小明',englishName:'Ming'}]});
async function setup(t,previewEmail='29wangxiaoming@school.edu.cn'){
 const directory=await mkdtemp(join(tmpdir(),'student-matching-')),origin='http://localhost:3000';
 const instance=createApplication({dataDir:directory,origin,sso:{preview:true,previewEmail}});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));instance.close();await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=(path,method='GET',body,cookie='school_preview_out=1')=>new Promise((resolve,reject)=>{const req=httpRequest(base+'/api'+path,{method,headers:{Host:'localhost:3000',Origin:origin,'Content-Type':'application/json',Cookie:cookie}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:{get:key=>{const v=res.headers[key];return Array.isArray(v)?v.join(','):v;}},json:async()=>JSON.parse(Buffer.concat(chunks).toString())}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
 await setAdminPassword(instance.db,'admin','student-testing-password');
 const login=await request('/login','POST',{username:'admin',password:'student-testing-password'}),admin=login.headers.get('set-cookie').split(';')[0]+'; school_preview_out=1';
 const call=async(path,method='GET',body,cookie=admin,status=200)=>{const r=await request(path,method,body,cookie);const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;};
 return {call,request,admin,student:'',base};
}
test('manual seating creates stable students and infers cohort without changing published seating',async t=>{
 const {call}=await setup(t);
 await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 let batch=await call('/admin/exams','POST',source(),undefined,201);
 const students=await call('/admin/students');assert.equal(students.length,1);
 assert.equal(students[0].graduationYear,2029);assert.equal(students[0].pinyin,'wangxiaoming');assert.equal(students[0].email,'29wangxiaoming@school.edu.cn');
 assert.equal(batch.seats[0].studentId,students[0].id);
 batch=await call('/admin/exams/'+batch.id+'/publish','POST',{version:batch.version});
 batch=await call('/admin/exams/'+batch.id+'/publish-seats','POST',{version:batch.version});
 const before=await call('/exams/'+batch.id+'/seats');assert.equal(before.seats[0].name,'王小明');
 batch.seats[0].column=3;batch=await call('/admin/exams/'+batch.id,'PUT',batch);
 assert.equal((await call('/admin/students')).length,1);
 assert.equal((await call('/exams/'+batch.id+'/seats')).seats[0].column,2);
 assert.equal(batch.seats[0].studentId,students[0].id);
});

test('spreadsheet preview explains inferred identities without saving students',async t=>{
 const {call,base,admin}=await setup(t);
 await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 const batch=await call('/admin/exams','POST',{...source(),seats:[]},undefined,201);
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('座位数据');
 sheet.addRow(['考试编号','教室','排','列','班级','中文名','英文名','年级']);
 sheet.addRow(['math','A',1,1,'10.5','王小明','Ming',10]);
 sheet.addRow(['math','A',1,2,'9.1','李明','Li',10]);
 const response=await fetch(base+'/api/admin/exams/'+batch.id+'/import-preview',{method:'POST',headers:{Origin:'http://localhost:3000',Cookie:admin,'Content-Type':'application/octet-stream'},body:await workbook.xlsx.writeBuffer()});
 assert.equal(response.status,200);const preview=await response.json();
 assert.equal(preview.seats[0].student.email,'29wangxiaoming@school.edu.cn');
 assert.match(preview.seats[1].identityIssues.join(' '),/矛盾/);
 assert.equal((await call('/admin/students')).length,0);
 preview.seats[1].className='10.1';delete preview.seats[1].studentId;
 const checked=await call('/admin/exams/'+batch.id+'/student-preview','POST',{version:batch.version,seats:preview.seats});
 assert.equal(checked.seats[1].identityIssues.length,0);assert.equal((await call('/admin/students')).length,0);
 const saved=await call('/admin/exams/'+batch.id,'PUT',{...batch,seats:preview.seats});
 assert.equal((await call('/admin/students')).length,2);
 await call('/admin/exams/'+batch.id,'PUT',saved);
 assert.equal((await call('/admin/students')).length,2);
});

test('administrators resolve homophone conflicts without changing published identity snapshots',async t=>{
 const {call,request}=await setup(t,'29wangmingb@school.edu.cn');await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 const input=source();input.seats=[{...input.seats[0],name:'王明'},{...input.seats[0],name:'汪铭',column:3}];
 let batch=await call('/admin/exams','POST',input,undefined,201);
 let list=await call('/admin/students');assert.equal(list.length,2);assert.ok(list.every(s=>s.issues.some(i=>i.includes('冲突'))));
 batch=await call('/admin/exams/'+batch.id+'/publish','POST',{version:batch.version});batch=await call('/admin/exams/'+batch.id+'/publish-seats','POST',{version:batch.version});
 assert.deepEqual((await call('/exams/'+batch.id+'/seats','GET',undefined,'')).personal,{});
 const student=list.find(s=>s.name==='汪铭');
 const fixed=await call('/admin/students/'+student.id,'PATCH',{...student,pinyin:'wangmingb',actualEmail:'29wangmingb@school.edu.cn'});
 assert.equal(fixed.id,student.id);assert.equal(fixed.issues.length,0);
 assert.equal((await request('/admin/students/'+student.id,'PATCH',fixed,'')).status,403);
 await call('/admin/students/'+student.id,'PATCH',{...student,pinyin:'wrong'},undefined,409);
 assert.deepEqual((await call('/exams/'+batch.id+'/seats','GET',undefined,'')).personal,{});
 batch=await call('/admin/exams/'+batch.id+'/publish-seats','POST',{version:batch.version});
 assert.equal((await call('/exams/'+batch.id+'/seats','GET',undefined,'')).personal.math.column,3);
 const preview=await call('/admin/students/'+student.id+'/merge-preview?target='+list[0].id);
 assert.ok(preview.errors.length); // Two different seats in the same exam cannot silently collapse.
 await call('/admin/students/'+student.id+'/merge','POST',{targetId:list[0].id,version:fixed.version,targetVersion:list[0].version},undefined,422);
});

test('trusted school email initializes each batch once and respects deliberate empty choices',async t=>{
 const {call,student}=await setup(t);await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 let batch=await call('/admin/exams','POST',source(),undefined,201);
 const path='/admin/exams/'+batch.id,personal='/exams/'+batch.id;
 batch=await call(path+'/publish','POST',{version:batch.version});
 let sync=await call(personal+'/personal-sync','POST',{},student);assert.equal(sync.initialized,false);
 batch=await call(path+'/publish-seats','POST',{version:batch.version});
 sync=await call(personal+'/personal-sync','POST',{},student);
 assert.equal(sync.initialized,true);assert.deepEqual(sync.choices,['math']);assert.equal(sync.personal.math.room,'B');
 assert.equal(sync.changes.length,0);
 await call(personal+'/choices','PUT',{ids:[]},student);
 sync=await call(personal+'/personal-sync','POST',{},student);assert.deepEqual(sync.choices,[]);assert.equal(sync.newExams.length,0);
 const adminSync=await call(personal+'/personal-sync','POST',{});assert.equal(adminSync.status,'skipped');assert.deepEqual(adminSync.choices,[]);
});

test('seating response locates the signed-in student without hiding other rooms',async t=>{
 const {call,student}=await setup(t);await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 let batch=await call('/admin/exams','POST',source(),undefined,201),path='/admin/exams/'+batch.id;
 batch=await call(path+'/publish','POST',{version:batch.version});batch=await call(path+'/publish-seats','POST',{version:batch.version});
 const seating=await call('/exams/'+batch.id+'/seats','GET',undefined,student);
 assert.ok(seating.seats.every(s=>!('matchEmail' in s)));assert.equal(seating.personal.math.room,'B');assert.equal(seating.personal.math.column,2);assert.equal(seating.rooms.length,2);
 assert.deepEqual((await call('/exams/'+batch.id+'/seats')).personal,{});
});

async function publish(call,batch){const path='/admin/exams/'+batch.id;batch=await call(path+'/publish','POST',{version:batch.version});return call(path+'/publish-seats','POST',{version:batch.version});}
test('new related exams can be cancelled or selectively imported without repeated prompts',async t=>{
 const {call,student}=await setup(t);await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 let batch=await publish(call,await call('/admin/exams','POST',source(),undefined,201));const path='/exams/'+batch.id;
 await call(path+'/personal-sync','POST',{},student);
 for(const id of ['english','history']){batch.sessions.push({...batch.sessions[0],id,title:id,date:'2026-09-24',start:id==='english'?'08:00':'10:00',end:id==='english'?'09:00':'11:00'});batch.seats.push({...batch.seats[0],examId:id});}
 batch=await call('/admin/exams/'+batch.id,'PUT',batch);batch=await publish(call,batch);
 let sync=await call(path+'/personal-sync','POST',{},student);assert.deepEqual(sync.newExams.sort(),['english','history']);assert.deepEqual(sync.choices,['math']);
 await call(path+'/personal-import','POST',{offered:sync.newExams,ids:['english']},student);
 sync=await call(path+'/personal-sync','POST',{},student);assert.deepEqual(sync.newExams,[]);assert.deepEqual(sync.choices,['english','math']);
 await call(path+'/choices','PUT',{ids:['math']},student);assert.deepEqual((await call(path+'/personal-sync','POST',{},student)).newExams,[]);
 await call(path+'/personal-import','POST',{offered:['history'],ids:['history']},student);
 assert.deepEqual((await call(path+'/personal-sync','POST',{},student)).choices,['history','math']);
 await call(path+'/personal-import','POST',{offered:['invalid'],ids:['invalid']},student,409);
});

test('published seat changes are acknowledged by revision and never erase selections',async t=>{
 const {call,student}=await setup(t);await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 let batch=await publish(call,await call('/admin/exams','POST',source(),undefined,201)),admin='/admin/exams/'+batch.id,path='/exams/'+batch.id;
 await call(path+'/personal-sync','POST',{},student);
 batch.seats[0].column=3;batch=await call(admin,'PUT',batch);
 assert.equal((await call(path+'/personal-sync','POST',{},student)).changes.length,0);
 batch=await call(admin+'/publish-seats','POST',{version:batch.version});
 let sync=await call(path+'/personal-sync','POST',{},student);assert.equal(sync.changes.length,1);
 const first=sync.changes[0];assert.equal(first.kind,'changed');assert.equal(first.before.column,2);assert.equal(first.after.column,3);
 batch.seats[0].column=1;batch=await call(admin,'PUT',batch);batch=await call(admin+'/publish-seats','POST',{version:batch.version});
 sync=await call(path+'/personal-sync','POST',{},student);assert.notEqual(sync.changes[0].id,first.id);
 await call(path+'/personal-ack','POST',{ids:[first.id]},student);
 sync=await call(path+'/personal-sync','POST',{},student);assert.equal(sync.changes.length,1);assert.equal(sync.changes[0].after.column,1);
 await call(path+'/personal-ack','POST',{ids:sync.changes.map(c=>c.id)},student);
 assert.deepEqual((await call(path+'/personal-sync','POST',{},student)).changes,[]);
 batch=await call(admin+'/publish-seats','POST',{version:batch.version});assert.deepEqual((await call(path+'/personal-sync','POST',{},student)).changes,[]);
 batch.sessions[0].start='08:10';batch=await call(admin,'PUT',batch);batch=await call(admin+'/publish','POST',{version:batch.version});
 sync=await call(path+'/personal-sync','POST',{},student);assert.equal(sync.changes[0].kind,'unavailable');assert.deepEqual(sync.personal,{});
 await call(path+'/personal-ack','POST',{ids:sync.changes.map(c=>c.id)},student);
 batch=await call(admin+'/publish-seats','POST',{version:batch.version});
 sync=await call(path+'/personal-sync','POST',{},student);assert.equal(sync.changes[0].kind,'restored');
 await call(path+'/personal-ack','POST',{ids:sync.changes.map(c=>c.id)},student);
 batch.sessions[0].end='09:10';batch=await call(admin,'PUT',batch);batch=await call(admin+'/publish','POST',{version:batch.version});
 batch.seats=[];batch=await call(admin,'PUT',batch);batch=await call(admin+'/publish-seats','POST',{version:batch.version});
 sync=await call(path+'/personal-sync','POST',{},student);assert.equal(sync.changes[0].kind,'removed');assert.deepEqual(sync.choices,['math']);
 await call(path+'/choices','PUT',{ids:[]},student);assert.deepEqual((await call(path+'/personal-sync','POST',{},student)).changes,[]);
});

test('a changed academic year cannot publish a stale cohort identity',async t=>{
 const {call,student}=await setup(t);await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 let batch=await publish(call,await call('/admin/exams','POST',source(),undefined,201)),path='/admin/exams/'+batch.id;
 batch.academicYear=2027;batch=await call(path,'PUT',batch);batch=await call(path+'/publish-seats','POST',{version:batch.version});
 assert.deepEqual((await call('/exams/'+batch.id+'/seats','GET',undefined,student)).personal,{});
});

test('a manually selected exam reports a later first seat allocation',async t=>{
 const {call,student}=await setup(t);await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 const input=source();input.sessions.push({...input.sessions[0],id:'english',title:'英语',date:'2026-09-24'});
 let batch=await publish(call,await call('/admin/exams','POST',input,undefined,201)),path='/exams/'+batch.id;
 await call(path+'/personal-sync','POST',{},student);
 await call(path+'/choices','PUT',{ids:['math','english']},student);
 // No extra sync between the manual selection and the publication.
 batch.seats.push({...batch.seats[0],examId:'english'});batch=await call('/admin/exams/'+batch.id,'PUT',batch);batch=await call('/admin/exams/'+batch.id+'/publish-seats','POST',{version:batch.version});
 const sync=await call(path+'/personal-sync','POST',{},student);assert.equal(sync.changes[0]?.kind,'added');assert.equal(sync.changes[0].examId,'english');
});

test('stale import offers can always be cancelled after an association disappears',async t=>{
 const {call,student}=await setup(t);await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 let batch=await publish(call,await call('/admin/exams','POST',source(),undefined,201)),path='/exams/'+batch.id;
 await call(path+'/personal-sync','POST',{},student);
 batch.sessions.push({...batch.sessions[0],id:'english',date:'2026-09-25'});batch.seats.push({...batch.seats[0],examId:'english'});
 batch=await publish(call,await call('/admin/exams/'+batch.id,'PUT',batch));
 const offer=(await call(path+'/personal-sync','POST',{},student)).newExams;assert.deepEqual(offer,['english']);
 batch.seats=batch.seats.filter(s=>s.examId!=='english');batch=await call('/admin/exams/'+batch.id,'PUT',batch);await call('/admin/exams/'+batch.id+'/publish-seats','POST',{version:batch.version});
 const result=await call(path+'/personal-import','POST',{offered:offer,ids:[]},student);assert.deepEqual(result.choices,['math']);assert.deepEqual(result.newExams,[]);
});

test('restoring seating does not report removal for a student who never had a seat',async t=>{
 const {call,student}=await setup(t);await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 const input=source();input.sessions.push({...input.sessions[0],id:'english',date:'2026-09-25'});
 let batch=await publish(call,await call('/admin/exams','POST',input,undefined,201)),path='/exams/'+batch.id,admin='/admin/exams/'+batch.id;
 await call(path+'/personal-sync','POST',{},student);await call(path+'/choices','PUT',{ids:['english']},student);
 batch.sessions[0].start='08:10';batch=await call(admin,'PUT',batch);batch=await call(admin+'/publish','POST',{version:batch.version});
 const unavailable=await call(path+'/personal-sync','POST',{},student);await call(path+'/personal-ack','POST',{ids:unavailable.changes.map(c=>c.id)},student);
 await call(admin+'/publish-seats','POST',{version:batch.version});
 assert.ok((await call(path+'/personal-sync','POST',{},student)).changes.every(c=>c.kind!=='removed'));
});

test('a student retains identity when progressing to the next academic year',async t=>{
 const {call}=await setup(t);await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 const first=await call('/admin/exams','POST',source(),undefined,201);
 const next=source();next.academicYear=2027;next.start='2027-09-21';next.end='2027-10-04';next.sessions[0].date='2027-09-23';next.sessions[0].grades=['G11'];next.seats[0].className='11.5';
 const second=await call('/admin/exams','POST',next,undefined,201);assert.equal(second.seats[0].studentId,first.seats[0].studentId);
});

test('explicit merges preserve draft links and repeated imports use the retained identity',async t=>{
 const {call}=await setup(t);await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 const first=await call('/admin/exams','POST',source(),undefined,201),other=source();other.seats[0].name='王晓明';
 let second=await call('/admin/exams','POST',other,undefined,201);
 const list=await call('/admin/students'),keep=list.find(s=>s.name==='王小明'),remove=list.find(s=>s.name==='王晓明');
 const request={targetId:keep.id,version:remove.version,targetVersion:keep.version};
 assert.deepEqual((await call('/admin/students/'+remove.id+'/merge-preview?target='+keep.id)).errors,[]);
 await call('/admin/students/'+remove.id+'/merge','POST',request);
 await call('/admin/students/'+remove.id+'/merge','POST',request);
 second=(await call('/admin/exams')).find(b=>b.id===second.id);assert.equal(second.seats[0].studentId,keep.id);
 second=await call('/admin/exams/'+second.id,'PUT',{...second,seats:other.seats});assert.equal(second.seats[0].studentId,keep.id);assert.equal((await call('/admin/students')).length,1);
 assert.equal(first.seats[0].studentId,keep.id);
});

test('correcting the latest class is honored by a subsequent import',async t=>{
 const {call}=await setup(t);await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 const first=await call('/admin/exams','POST',source(),undefined,201),student=(await call('/admin/students'))[0];
 await call('/admin/students/'+student.id,'PATCH',{...student,className:'10.6'});
 const input=source();input.seats[0].className='10.6';
 const next=await call('/admin/exams','POST',input,undefined,201);assert.equal(next.seats[0].studentId,first.seats[0].studentId);assert.equal((await call('/admin/students')).length,1);
});

test('a seat moved during withdrawal reports both locations when published again',async t=>{
 const {call,student}=await setup(t);await call('/admin/students/settings','PUT',{domain:'school.edu.cn'});
 let batch=await publish(call,await call('/admin/exams','POST',source(),undefined,201)),path='/exams/'+batch.id,admin='/admin/exams/'+batch.id;
 await call(path+'/personal-sync','POST',{},student);
 batch.sessions[0].start='08:10';batch=await call(admin,'PUT',batch);batch=await call(admin+'/publish','POST',{version:batch.version});
 const unavailable=await call(path+'/personal-sync','POST',{},student);await call(path+'/personal-ack','POST',{ids:unavailable.changes.map(c=>c.id)},student);
 batch.seats[0].room='A';batch=await call(admin,'PUT',batch);await call(admin+'/publish-seats','POST',{version:batch.version});
 const change=(await call(path+'/personal-sync','POST',{},student)).changes[0];assert.equal(change.kind,'changed');assert.equal(change.before.room,'B');assert.equal(change.after.room,'A');
});
