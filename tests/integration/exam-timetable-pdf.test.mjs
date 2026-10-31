import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword,digest} from '../../server/store.mjs';

const exam=(id,fields)=>({id,titleEn:'',division:'high',grades:[10],rooms:['2101'],...fields});
const source=()=>({title:'秋季期中考试',titleEn:'Autumn Midterms',start:'2026-09-21',end:'2026-10-09',rooms:[{name:'2101',rows:5,columns:5},{name:'2102',rows:5,columns:5}],seats:[],sessions:[
 exam('math',{title:'数学',titleEn:'Mathematics',date:'2026-09-21',start:'08:10',end:'09:40'}),
 exam('physics-hl',{title:'物理',titleEn:'Physics',subject:'物理',subjectEn:'Physics',level:'HL',grades:[11],date:'2026-09-21',start:'08:10',end:'09:40',rooms:['2102']}),
 exam('early',{title:'化学',titleEn:'Chemistry',date:'2026-09-22',start:'07:30',end:'09:00'}),
 exam('dropped',{title:'历史',titleEn:'History',date:'2026-09-22',start:'11:00',end:'12:30',cancelled:true}),
 exam('english',{title:'英语',titleEn:'English',division:'middle',grades:[8],date:'2026-09-23',start:'11:00',end:'12:30'}),
 exam('biology',{title:'生物',titleEn:'Biology',grades:[11],date:'2026-09-24',start:'13:40',end:'15:10'}),
 exam('art',{title:'美术',titleEn:'Art',grades:[12],date:'2026-09-25',start:'13:40',end:'15:10'}),
 exam('music',{title:'音乐',titleEn:'Music',grades:[10],date:'2026-09-29',start:'08:10',end:'09:40'})
]});

let server,instance,directory,base,admin,batch;
const call=(path,cookie='')=>fetch(base+'/api'+path,{headers:{Origin:'http://calendar.test',...(cookie?{Cookie:cookie}:{})}});
const student='school_session=student-a';
async function pages(response){
 assert.equal(response.status,200,await response.clone().text());
 assert.equal(response.headers.get('content-type'),'application/pdf');
 const task=getDocument({data:new Uint8Array(await response.arrayBuffer()),useSystemFonts:false});
 try{
  const pdf=await task.promise,texts=[];
  for(let i=1;i<=pdf.numPages;i++){const content=await (await pdf.getPage(i)).getTextContent();texts.push(content.items.map(x=>x.str||'').join(' ').replace(/\s+/g,' '));}
  return texts;
 }finally{await task.destroy();}
}

before(async()=>{
 directory=await mkdtemp(join(tmpdir(),'calendar-timetable-'));instance=createApplication({dataDir:directory,origin:'http://calendar.test'});server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 base=`http://127.0.0.1:${server.address().port}`;
 const json={Origin:'http://calendar.test','Content-Type':'application/json'};
 await setAdminPassword(instance.db,'admin','exam-testing-password');
 admin=(await fetch(base+'/api/login',{method:'POST',headers:json,body:JSON.stringify({username:'admin',password:'exam-testing-password'})})).headers.get('set-cookie').split(';')[0];
 let res=await fetch(base+'/api/admin/exams',{method:'POST',headers:{...json,Cookie:admin},body:JSON.stringify(source())});assert.equal(res.status,201,await res.clone().text());batch=await res.json();
 res=await fetch(base+'/api/admin/exams/'+batch.id+'/publish',{method:'POST',headers:{...json,Cookie:admin},body:JSON.stringify({version:batch.version})});assert.equal(res.status,200);batch=await res.json();
 instance.db.prepare('INSERT INTO school_sessions VALUES(?,?,?,?)').run(digest('student-a'),'tenant:student-a','Mingyuan Wei',Date.now()+60000);
 res=await fetch(base+'/api/exams/'+batch.id+'/choices',{method:'PUT',headers:{...json,Cookie:student},body:JSON.stringify({ids:['math','early','dropped']})});assert.equal(res.status,200);
});
after(async()=>{server?.close();instance?.db.close();await rm(directory,{recursive:true,force:true});});

test('all exams in English: batch title and series dates head the first page only',async()=>{
 const texts=await pages(await call('/exams/'+batch.id+'/pdf?scope=all&lang=en'));
 assert.match(texts[0],/Autumn Midterms/);
 assert.match(texts[0],/21 Sep 2026 – 9 Oct 2026/);
 assert.ok(texts.length>=2);
 for(const later of texts.slice(1))assert.doesNotMatch(later,/Autumn Midterms|21 Sep 2026/);
});

test('cells list each exam with its level, own time, rooms and grades; cancelled exams are left out',async()=>{
 const [first,second]=await pages(await call('/exams/'+batch.id+'/pdf?scope=all&lang=en'));
 assert.match(first,/Mathematics 08:10–09:40 2101 G10/,'an exam that fills its slot still shows its time');
 assert.match(first,/Physics HL 08:10–09:40 2102 G11/);
 assert.match(first,/Chemistry 07:30–09:00 2101 G10/);
 assert.doesNotMatch(first+second,/History|Cancelled|Updated/);
 assert.match(second,/Music/);
});

test('a long series pages by week, each page heads its date columns and keeps empty slots',async()=>{
 const texts=await pages(await call('/exams/'+batch.id+'/pdf?scope=all&lang=en'));
 assert.equal(texts.length,2);
 assert.match(texts[0],/Time Mon 21 Sep Tue 22 Sep Wed 23 Sep Thu 24 Sep Fri 25 Sep/);
 assert.match(texts[1],/Time Tue 29 Sep/);
 for(const page of texts)for(const slot of ['08:10 – 09:40','11:00 – 12:30','13:40 – 15:10','15:40 – 17:10','19:00 – 20:00'])assert.ok(page.includes(slot),slot);
});

test('my exams need a school sign-in and are headed by the student name without grades',async()=>{
 assert.equal((await call('/exams/'+batch.id+'/pdf?scope=mine&lang=en')).status,401);
 const texts=await pages(await call('/exams/'+batch.id+'/pdf?scope=mine&lang=en',student));
 assert.equal(texts.length,1,'two chosen exams in one week fit one page');
 assert.match(texts[0],/^Keydion Calendar Mingyuan Wei's Timetable Autumn Midterms 21 Sep 2026 – 9 Oct 2026/);
 assert.match(texts[0],/Mathematics 08:10–09:40 2101/);
 assert.match(texts[0],/Chemistry 07:30–09:00 2101/);
 assert.doesNotMatch(texts[0],/G10|Physics|History/);
});

test('selected grades are named in the heading and filter the exams',async()=>{
 const [page,...rest]=await pages(await call('/exams/'+batch.id+'/pdf?scope=grades&grades=12,11&lang=en'));
 assert.equal(rest.length,0);
 assert.match(page,/^Keydion Calendar Autumn Midterms · G11 \/ G12 /);
 assert.match(page,/Physics HL 08:10–09:40 2102 G11/);
 assert.match(page,/Art 13:40–15:10 2101 G12/);
 assert.doesNotMatch(page,/Mathematics|English|Music/);
 assert.equal((await call('/exams/'+batch.id+'/pdf?scope=grades&lang=en')).status,422);
});

test('Chinese export uses Chinese headings, dates and footer; grades stay as G10',async()=>{
 const [page]=await pages(await call('/exams/'+batch.id+'/pdf?scope=mine&lang=zh',student));
 assert.match(page,/^Keydion Calendar Mingyuan Wei 的考试安排 秋季期中考试 2026年9月21日 – 2026年10月9日/);
 assert.match(page,/时间 9月21日 周一 9月22日 周二/);
 assert.match(page,/数学 08:10–09:40 2101/);
 const [all]=await pages(await call('/exams/'+batch.id+'/pdf?scope=all&lang=zh'));
 assert.match(all,/物理 HL 08:10–09:40 2102 G11/);
 assert.match(all,/生成于 \d{4}年\d{1,2}月\d{1,2}日 \d\d:\d\d · 考试安排更新于 \d{4}年\d{1,2}月\d{1,2}日 \d\d:\d\d 1 \/ 2$/);
});

test('every page carries the generated and published times and its page number',async()=>{
 const texts=await pages(await call('/exams/'+batch.id+'/pdf?scope=all&lang=en'));
 texts.forEach((page,i)=>assert.match(page,new RegExp(`Generated \\d{1,2} [A-Z][a-z]{2} \\d{4} \\d\\d:\\d\\d · Schedule updated \\d{1,2} [A-Z][a-z]{2} \\d{4} \\d\\d:\\d\\d ${i+1} / ${texts.length}$`)));
});

test('crowded rows move to a new page with the date header, and an oversized cell shrinks without losing exams',async()=>{
 const json={Origin:'http://calendar.test','Content-Type':'application/json',Cookie:admin};
 const slots=[['08:10','09:40'],['11:00','12:30'],['13:40','15:10'],['15:40','17:10']];
 const sessions=[...slots.flatMap(([start,end],row)=>Array.from({length:8},(_,i)=>exam(`r${row}-${i}`,{title:`Row${row} Exam${i}`,date:'2026-09-21',start,end}))),
  ...Array.from({length:60},(_,i)=>exam(`big-${i}`,{title:`Crowd${i}`,date:'2026-09-22',start:'19:00',end:'20:00'}))];
 let res=await fetch(base+'/api/admin/exams',{method:'POST',headers:json,body:JSON.stringify({...source(),title:'拥挤',titleEn:'Crowded',sessions})});assert.equal(res.status,201,await res.clone().text());let crowded=await res.json();
 res=await fetch(base+'/api/admin/exams/'+crowded.id+'/publish',{method:'POST',headers:json,body:JSON.stringify({version:crowded.version})});assert.equal(res.status,200);crowded=await res.json();
 const texts=await pages(await call('/exams/'+crowded.id+'/pdf?scope=all&lang=en'));
 assert.ok(texts.length>=2);
 for(const page of texts)assert.match(page,/Time Mon 21 Sep Tue 22 Sep /);
 const all=texts.join(' ');
 for(const s of sessions)assert.ok(new RegExp(`${s.title} ${s.start}–${s.end} 2101`).test(all),s.title);
});

test('only a published batch exports, and the scope must be named',async()=>{
 assert.equal((await call('/exams/no-such-batch/pdf?scope=all&lang=en')).status,404);
 const json={Origin:'http://calendar.test','Content-Type':'application/json',Cookie:admin};
 const draft=await (await fetch(base+'/api/admin/exams',{method:'POST',headers:json,body:JSON.stringify({...source(),title:'草稿'})})).json();
 assert.equal((await call('/exams/'+draft.id+'/pdf?scope=all&lang=en')).status,404);
 assert.equal((await call('/exams/'+batch.id+'/pdf?lang=en')).status,422);
});

test('the downloaded file name carries the PDF language and the series name in that language',async()=>{
 let response=await call('/exams/'+batch.id+'/pdf?scope=all&lang=en');assert.equal(response.status,200);
 assert.equal(response.headers.get('content-disposition'),`attachment; filename="en-Autumn Midterms.pdf"; filename*=UTF-8''${encodeURIComponent('en-Autumn Midterms.pdf')}`);
 response=await call('/exams/'+batch.id+'/pdf?scope=all&lang=zh');assert.equal(response.status,200);
 assert.match(response.headers.get('content-disposition'),new RegExp(`filename\\*=UTF-8''${encodeURIComponent('zh-秋季期中考试.pdf')}$`));
 response=await call('/exams/'+batch.id+'/pdf?scope=grades&grades=11,10&lang=en');assert.equal(response.status,200);
 assert.match(response.headers.get('content-disposition'),/filename="G10_G11-en-Autumn Midterms\.pdf"/);
 response=await call('/exams/'+batch.id+'/pdf?scope=all&lang=en',student);assert.equal(response.status,200);
 assert.match(response.headers.get('content-disposition'),/filename="en-Autumn Midterms\.pdf"/);
});

test('whole-school and grade exports merge one grade\'s levels of a subject; my exams keep each exam whole',async()=>{
 const json={Origin:'http://calendar.test','Content-Type':'application/json',Cookie:admin};
 const level=(id,level,grades,start,end,rooms)=>exam(id,{title:`Biology ${level}`,titleEn:`Biology ${level}`,subject:'生物',subjectEn:'Biology',level,grades,date:'2026-09-21',start,end,rooms});
 const sessions=[level('bio-1','1',[10],'08:10','09:40',['2101']),level('bio-honor','Honor',[10],'08:10','09:40',['2102']),
  level('bio-hl','HL',[11],'08:10','09:40',['2101']),level('bio-sl','SL',[11],'08:30','09:40',['2102'])];
 let res=await fetch(base+'/api/admin/exams',{method:'POST',headers:json,body:JSON.stringify({...source(),title:'生物',titleEn:'Biology',sessions})});assert.equal(res.status,201,await res.clone().text());let bio=await res.json();
 res=await fetch(base+'/api/admin/exams/'+bio.id+'/publish',{method:'POST',headers:json,body:JSON.stringify({version:bio.version})});assert.equal(res.status,200);bio=await res.json();
 const [all]=await pages(await call('/exams/'+bio.id+'/pdf?scope=all&lang=en'));
 assert.match(all,/G10 Biology 08:10–09:40 Biology 1 2101 Biology Honor 2102/,'shared time sits beside the subject only');
 assert.match(all,/G11 Biology 08:10–09:40 Biology HL 08:10–09:40 2101 Biology SL 08:30–09:40 2102/,'differing times stay on each level');
 const [grade]=await pages(await call('/exams/'+bio.id+'/pdf?scope=grades&grades=10&lang=en'));
 assert.match(grade,/G10 Biology 08:10–09:40 Biology 1 2101 Biology Honor 2102/);
 res=await fetch(base+'/api/exams/'+bio.id+'/choices',{method:'PUT',headers:{...json,Cookie:student},body:JSON.stringify({ids:['bio-1','bio-honor']})});assert.equal(res.status,200);
 const [mine]=await pages(await call('/exams/'+bio.id+'/pdf?scope=mine&lang=en',student));
 assert.match(mine,/Biology 1 08:10–09:40 2101 Biology Honor 08:10–09:40 2102/);
});
