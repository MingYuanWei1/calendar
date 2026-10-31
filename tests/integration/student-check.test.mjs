import ExcelJS from 'exceljs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';
import {materialsForm} from '../helpers.mjs';

const origin='http://calendar.test';

// A gateway that streams whatever `state.students` holds as the model's reading of the reference list.
async function gateway(){
 const state={calls:[],students:[],warnings:[]};
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  if(req.url==='/v1/capabilities'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({purposes:{flash:{enabled:true}}}));}
  state.calls.push(JSON.parse(body));
  res.setHeader('Content-Type','text/event-stream');
  const content=JSON.stringify({students:state.students,warnings:state.warnings});
  res.end(`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\ndata: [DONE]\n\n`);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {state,server,url:`http://127.0.0.1:${server.address().port}`};
}

async function setup(t){
 const llm=await gateway(),directory=await mkdtemp(join(tmpdir(),'student-check-'));
 const instance=createApplication({dataDir:directory,origin,llm:{url:llm.url,token:'fixture-token'}});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>llm.server.close(r));instance.close();await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}/api`;
 // The check takes its reference as a multipart form; every other call is JSON.
 const call=(path,method='GET',body,cookie='',accept='application/json')=>{
  if(path==='/admin/students/check'&&method==='POST'){const {parts,...fields}=body;return fetch(base+path,{method,headers:{Origin:origin,Accept:accept,Cookie:cookie},body:materialsForm({parts},fields)});}
  return fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',Accept:accept,Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 };
 await setAdminPassword(instance.db,'admin','check-testing-password');
 const admin=(await call('/login','POST',{username:'admin',password:'check-testing-password'})).headers.get('set-cookie').split(';')[0];
 const json=async(path,method,body,status=200)=>{const r=await call(path,method,body,admin);assert.equal(r.status,status,await r.clone().text());return r.json();};
 return {llm,call,admin,json,base};
}
// Students are created from exam seating: grade 11 in 2026–27 is the class of 2028.
const seat=(column,className,name,englishName)=>({examId:'math',room:'A',row:1,column,className,name,englishName});
const batch=seats=>({title:'期中考试',start:'2026-11-02',end:'2026-11-06',academicYear:2026,rooms:[{name:'A',rows:2,columns:6}],sessions:[{id:'math',title:'数学',division:'high',grades:[10,11,12],date:'2026-11-03',start:'08:00',end:'10:00',rooms:['A']}],seats});

test('a reference list is compared with the stored students by name, class and cohort',async t=>{
 const {llm,json}=await setup(t);
 await json('/admin/exams','POST',batch([seat(1,'11.3','王小明','Ming'),seat(2,'11.3','李华','Hua'),seat(3,'10.1','张伟','Wei A'),seat(4,'11.2','张伟','Wei B'),seat(5,'11.1','陈晨','')]),201);
 const before=await json('/admin/students');
 assert.equal(before.find(s=>s.name==='王小明').graduationYear,2028);

 llm.state.students=[
  {name:'王小明',englishName:'Ming',className:'12-3',grade:12,source:{page:1,quote:'王小明'}},
  {name:'李华',englishName:'Hua',className:'G11 3',grade:'11'},
  {name:'张伟',englishName:'',className:'',grade:11},
  {name:'刘洋',englishName:'Yang',className:'11.4',grade:11},
  {name:'陈晨',englishName:'',className:'',grade:null},
  {name:'',englishName:'',className:'11.1',source:{page:1,quote:'缺名'}}
 ];
 const status=await json('/admin/students/check');
 assert.equal(status.configured,true);assert.equal(typeof status.academicYear,'number');

 const {items,warnings,academicYear}=await json('/admin/students/check','POST',{parts:[{kind:'text',text:'高三(3)班 王小明 …'}],academicYear:2026});
 assert.equal(academicYear,2026);
 const by=name=>items.find(i=>i.row.name===name);
 // Grade 12 in 2026–27 is the class of 2027; "12-3" is a different class from "11.3".
 assert.equal(by('王小明').status,'mismatch');assert.deepEqual(by('王小明').changes,{graduationYear:2027,className:'12-3'});
 assert.deepEqual(by('王小明').source,{page:1,quote:'王小明'});
 // "G11 3" and "11.3" name the same class, and a grade given as text still counts.
 assert.equal(by('李华').status,'ok');
 // The namesake in grade 11 is told apart by cohort.
 assert.equal(by('张伟').status,'ok');assert.equal(by('张伟').student.englishName,'Wei B');
 assert.equal(by('刘洋').status,'missing');
 // A class such as "11.1" already names the grade; with neither there is nothing to check.
 assert.equal(by('陈晨').status,'noGrade');
 assert.equal(items.length,5);assert.ok(warnings.some(w=>/缺名/.test(w)));
 assert.match(llm.state.calls[0].messages[0].content,/2026–2027 school year/);

 // Namesakes that nothing tells apart are left to the administrator.
 llm.state.students=[{name:'张伟',englishName:'',className:'',grade:null}];
 const tied=(await json('/admin/students/check','POST',{parts:[{kind:'text',text:'张伟'}],academicYear:2026})).items[0];
 assert.equal(tied.status,'ambiguous');assert.equal(tied.candidates.length,2);

 // Saving goes through the usual student edit, so the cohort and the derived email change together.
 const ming=by('王小明').student;
 const saved=await json('/admin/students/'+ming.id,'PATCH',{...ming,graduationYear:2027,version:ming.version});
 assert.equal(saved.graduationYear,2027);
});

test('the check needs a system admin and a reference',async t=>{
 const {call,json,admin}=await setup(t);
 assert.equal((await call('/admin/students/check','POST',{parts:[{kind:'text',text:'x'}]})).status,401);
 assert.equal((await call('/admin/students/check','POST',{parts:[]},admin)).status,422);
 await json('/admin/students/check','GET');
});

test('an Excel roster is read sheet by sheet and compared the same way',async t=>{
 const {llm,json,admin,base}=await setup(t);
 await json('/admin/exams','POST',batch([seat(1,'11.3','王小明','Ming')]),201);
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('高三');
 sheet.addRow(['班级','姓名','英文名']);sheet.addRow(['12.3','王小明','Ming']);
 llm.state.students=[{name:'王小明',englishName:'Ming',className:'12.3',grade:12,source:{sheet:'高三',cell:'B2'}}];
 const upload=(buffer,name='名单.xlsx')=>fetch(base+'/admin/students/check',{method:'POST',headers:{Origin:origin,Cookie:admin,Accept:'application/x-ndjson'},body:materialsForm({workbooks:[{name,buffer}]},{academicYear:2026})});
 const r=await upload(await book.xlsx.writeBuffer());
 assert.equal(r.status,200);
 const lines=(await r.text()).trim().split('\n').map(line=>JSON.parse(line));
 // The sheets come back first so the review can show the workbook beside the results.
 assert.equal(lines.find(l=>l.type==='source').workbooks[0].sheets[0].name,'高三');
 const {items,academicYear}=lines.at(-1).result;
 assert.equal(academicYear,2026);
 assert.equal(items[0].status,'mismatch');assert.deepEqual(items[0].changes,{graduationYear:2027,className:'12.3'});
 assert.deepEqual(items[0].source,{sheet:'高三',cell:'B2',workbook:'名单.xlsx'});
 const prompt=llm.state.calls.at(-1).messages;
 assert.match(prompt[0].content,/XLSX cell text/);assert.match(prompt[1].content,/王小明/);
 // Only a real workbook is read.
 assert.equal((await upload(Buffer.from('not a workbook'))).status,422);
 assert.equal((await upload(await book.xlsx.writeBuffer(),'list.csv')).status,422);
});
