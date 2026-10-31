import ExcelJS from 'exceljs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';
import {materialsForm,followJob} from '../helpers.mjs';

const origin='http://calendar.test';

// A gateway that streams whatever `state.rows` holds as the model's reading of the reference list.
async function gateway(){
 const state={calls:[],rows:[],warnings:[]};
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  if(req.url==='/v1/capabilities'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({purposes:{flash:{enabled:true}}}));}
  state.calls.push(JSON.parse(body));
  res.setHeader('Content-Type','text/event-stream');
  const content=JSON.stringify({rows:state.rows,warnings:state.warnings});
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
 const call=(path,method='GET',body,cookie='')=>fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 const signIn=async(username,password)=>(await call('/login','POST',{username,password})).headers.get('set-cookie').split(';')[0];
 await setAdminPassword(instance.db,'admin','check-testing-password');
 const admin=await signIn('admin','check-testing-password');
 const json=async(path,method,body,status=200,cookie=admin)=>{const r=await call(path,method,body,cookie);assert.equal(r.status,status,await r.clone().text());return r.status===204?null:r.json();};
 // A check runs as a job; once it has read the reference, its comparison is read (and re-read) separately.
 const start=(materials,fields,cookie=admin)=>fetch(base+'/admin/extract-jobs/check-students',{method:'POST',headers:{Origin:origin,Cookie:cookie},body:materialsForm(materials,fields)});
 const check=async(materials={parts:[{kind:'text',text:'名单'}]},fields={academicYear:2026})=>{
  const r=await start(materials,fields);assert.equal(r.status,201,await r.clone().text());
  const run=await followJob(base,admin,(await r.json()).id);assert.equal(run.status,'done');
  return {run,compared:await json('/admin/checks/'+run.job.id)};
 };
 return {llm,call,signIn,admin,json,base,start,check};
}
// Students are created from exam seating: grade 11 in 2026–27 is the class of 2028.
const seat=(column,className,name,englishName)=>({examId:'math',room:'A',row:1,column,className,name,englishName});
const batch=seats=>({title:'期中考试',start:'2026-11-02',end:'2026-11-06',academicYear:2026,rooms:[{name:'A',rows:2,columns:8}],sessions:[{id:'math',title:'数学',division:'high',grades:[10,11,12],date:'2026-11-03',start:'08:00',end:'10:00',rooms:['A']}],seats});
// Applies an item the way the console does: its request, with the ticked fields' values.
const applyItem=(json,item,fields=Object.keys(item.apply.fields||{}))=>json(item.apply.path,item.apply.method,{...item.apply.body,...Object.assign({},...fields.map(f=>item.apply.fields[f]))});

test('a reference list is compared with the stored students by name, class, cohort and email',async t=>{
 const {llm,json,check}=await setup(t);
 await json('/admin/exams','POST',batch([seat(1,'11.3','王小明','Ming'),seat(2,'11.3','李华','Hua'),seat(3,'10.1','张伟','Wei A'),seat(4,'11.2','张伟','Wei B'),seat(5,'11.1','陈晨',''),seat(6,'11.3','赵六','Six')]),201);
 const before=await json('/admin/students');
 assert.equal(before.find(s=>s.name==='王小明').graduationYear,2028);

 llm.state.rows=[
  {name:'王小明',englishName:'Ming',className:'12-3',grade:12,source:{page:1,quote:'王小明'}},
  {name:'李华',englishName:'Hua',className:'G11 3',grade:'11'},
  {name:'张伟',englishName:'',className:'',grade:11},
  {name:'刘洋',englishName:'Yang',className:'11.4',grade:11},
  {name:'陈晨',englishName:'',className:'',grade:null},
  {name:'',englishName:'',className:'11.1',source:{page:1,quote:'缺名'}}
 ];
 const status=await json('/admin/checks');
 assert.equal(status.configured,true);assert.equal(typeof status.academicYear,'number');

 const {compared:{items,warnings,academicYear}}=await check();
 assert.equal(academicYear,2026);
 const by=name=>items.find(i=>i.row?.name===name);
 // Grade 12 in 2026–27 is the class of 2027; "12-3" is a different class from "11.3".
 assert.equal(by('王小明').status,'mismatch');
 assert.deepEqual(by('王小明').changes,[{field:'graduationYear',from:2028,to:2027},{field:'className',from:'11.3',to:'12-3'}]);
 assert.deepEqual(by('王小明').source,{page:1,quote:'王小明'});
 // "G11 3" and "11.3" name the same class, and a grade given as text still counts.
 assert.equal(by('李华').status,'ok');assert.equal(by('李华').apply,null);
 // The namesake in grade 11 is told apart by cohort.
 assert.equal(by('张伟').status,'ok');assert.equal(by('张伟').student.englishName,'Wei B');
 assert.equal(by('刘洋').status,'missing');
 // A class such as "11.1" already names the grade; with neither there is nothing to check.
 assert.equal(by('陈晨').status,'noValue');
 // A student of a class the list covers but leaves out is extra — reported, never deleted.
 const extra=items.filter(i=>i.status==='extra');
 assert.deepEqual(extra.map(i=>i.student.name),['赵六']);assert.equal(extra[0].apply,null);
 assert.equal(items.length,6);assert.ok(warnings.some(w=>/缺名/.test(w)));
 assert.match(llm.state.calls[0].messages[0].content,/2026–2027 school year/);

 // Namesakes that nothing tells apart are left to the administrator.
 llm.state.rows=[{name:'张伟',englishName:'',className:'',grade:null}];
 const tied=(await check()).compared.items[0];
 assert.equal(tied.status,'ambiguous');assert.equal(tied.candidates.length,2);

 // An email finds its student even under another name, and every field the row gives is compared.
 await json('/admin/students/settings','PUT',{domain:'school.test'});
 const hua=(await json('/admin/students')).find(s=>s.name==='李华');
 llm.state.rows=[{name:'李桦',englishName:'Hua Li',className:'11.3',grade:11,email:hua.email.toUpperCase()}];
 const renamed=(await check()).compared.items[0];
 assert.equal(renamed.student.id,hua.id);
 assert.deepEqual(renamed.changes.map(c=>c.field),['name','englishName']);
 // Ticking only one field saves only that one.
 await applyItem(json,renamed,['englishName']);
 const saved=(await json('/admin/students')).find(s=>s.id===hua.id);
 assert.equal(saved.englishName,'Hua Li');assert.equal(saved.name,'李华');
});

test('the comparison is made again each time it is read, and an applied correction then shows as matching',async t=>{
 const {llm,json,check}=await setup(t);
 await json('/admin/exams','POST',batch([seat(1,'11.3','王小明','Ming')]),201);
 llm.state.rows=[{name:'王小明',englishName:'Ming',className:'12.3',grade:12}];
 const {run,compared}=await check();
 const [item]=compared.items;
 assert.equal(item.status,'mismatch');
 // Saving goes through the usual student edit, with the version the comparison read.
 await applyItem(json,item,['graduationYear']);
 let again=(await json('/admin/checks/'+run.job.id)).items[0];
 assert.deepEqual(again.changes.map(c=>c.field),['className']);
 await applyItem(json,again);
 again=(await json('/admin/checks/'+run.job.id)).items[0];
 assert.equal(again.status,'ok');
 // An edit made elsewhere in between conflicts instead of being overwritten.
 const stale=item.apply;
 assert.equal((await json(stale.path,stale.method,{...stale.body,...stale.fields.className},409)).error.length>0,true);
 // The result stays until it is discarded.
 assert.equal((await json('/admin/checks/'+run.job.id)).items.length,1);
 await json('/admin/extract-jobs/'+run.job.id,'DELETE',undefined,204);
 assert.equal((await json('/admin/checks/'+run.job.id,'GET',undefined,404)).error.length>0,true);
});

test('the student check needs a system admin and a reference',async t=>{
 const {json,start,signIn,admin}=await setup(t);
 assert.equal((await start({parts:[{kind:'text',text:'x'}]},{},'')).status,401);
 assert.equal((await start({parts:[]},{})).status,422);
 assert.equal((await start({parts:[{kind:'text',text:'x'}]},{academicYear:'abc'})).status,422);
 await json('/admin/accounts','POST',{username:'editor',password:'editor-testing-password',name:'Editor',role:2},201);
 const editor=await signIn('editor','editor-testing-password');
 assert.equal((await start({parts:[{kind:'text',text:'x'}]},{},editor)).status,403);
 // An editor never sees the school's student checks or their students in 自检.
 const r=await start({parts:[{kind:'text',text:'x'}]},{academicYear:2026});assert.equal(r.status,201);
 assert.deepEqual(await json('/admin/extract-jobs','GET',undefined,200,editor),[]);
 assert.equal((await json('/admin/extract-jobs','GET',undefined,200,admin)).length,1);
 // The grade check's old streaming endpoint is gone.
 assert.equal((await json('/admin/students/check','POST',{},404,admin)).error!==undefined,true);
});

test('an Excel roster is read sheet by sheet and compared the same way',async t=>{
 const {llm,json,check}=await setup(t);
 await json('/admin/exams','POST',batch([seat(1,'11.3','王小明','Ming')]),201);
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('高三');
 sheet.addRow(['班级','姓名','英文名']);sheet.addRow(['12.3','王小明','Ming']);
 llm.state.rows=[{name:'王小明',englishName:'Ming',className:'12.3',grade:12,source:{sheet:'高三',cell:'B2'}}];
 const {run,compared}=await check({workbooks:[{name:'名单.xlsx',buffer:Buffer.from(await book.xlsx.writeBuffer())}]});
 // The sheets come with the job so the review can show the workbook beside the results.
 assert.equal(run.events.find(e=>e.type==='source').workbooks[0].sheets[0].name,'高三');
 const [item]=compared.items;
 assert.equal(item.status,'mismatch');assert.deepEqual(item.changes.map(c=>c.to),[2027,'12.3']);
 assert.deepEqual(item.source,{sheet:'高三',cell:'B2',workbook:'名单.xlsx'});
 const prompt=llm.state.calls.at(-1).messages;
 assert.match(prompt[0].content,/XLSX cell text/);assert.match(prompt[1].content,/王小明/);
});
