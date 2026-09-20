import {resolve} from 'node:path';
import {createApplication} from '../server/app.mjs';
import {batchSchema,seatErrors} from '../server/exam-model.mjs';
const app=createApplication({dataDir:resolve(process.env.DATA_DIR||'.data'),origin:'http://localhost:3000'});
try{
 const id='sample-exam-levels-2026',row=app.db.prepare('SELECT * FROM exam_batches WHERE id=?').get(id);
 if(!row)throw new Error('Run sample-exam-levels.mjs first.');
 const additions=[
  {id:'concurrent-chemistry-hl',subject:'化学',subjectEn:'Chemistry',level:'HL',paper:'Paper 1',rooms:['3201']},
  {id:'concurrent-chemistry-sl',subject:'化学',subjectEn:'Chemistry',level:'SL',paper:'Paper 1',rooms:['3202']},
  {id:'concurrent-english',subject:'英语',subjectEn:'English',level:'',paper:'',rooms:['3203']},
 ].map(s=>({...s,title:`[示例] ${s.subject}${s.level?' '+s.level+' · '+s.paper:'阅读与写作'}`,titleEn:`[Sample] ${s.subjectEn}${s.level?' '+s.level+' · '+s.paper:' Reading and Writing'}`,...(!s.level?{subject:'',subjectEn:''}:{}),division:'high',grades:['G12'],date:'2026-09-21',start:'08:10',end:'09:40',cancelled:false,note:'虚构示例，用于查看同一时段多场考试。'}));
 const rooms=additions.map(s=>({name:s.rooms[0],rows:5,columns:5}));
 const seats=additions.flatMap(s=>Array.from({length:4},(_,i)=>({examId:s.id,room:s.rooms[0],row:1,column:i+1,className:'G12',name:'示例学生'+(i+1),englishName:'Sample '+(i+1)})));
 const append=(old,extra,key)=>[...old,...extra.filter(item=>!old.some(existing=>key(existing)===key(item)))];
 const draft=JSON.parse(row.draft),published=JSON.parse(row.published),seating=JSON.parse(row.seating);
 draft.sessions=append(draft.sessions,additions,s=>s.id);draft.rooms=append(draft.rooms,rooms,r=>r.name);draft.seats=append(draft.seats,seats,s=>s.examId+'|'+s.room+'|'+s.row+'|'+s.column);
 published.sessions=append(published.sessions,additions,s=>s.id);published.rooms=append(published.rooms,rooms,r=>r.name);
 seating.rooms=append(seating.rooms,rooms,r=>r.name);seating.seats=append(seating.seats,seats,s=>s.examId+'|'+s.room+'|'+s.row+'|'+s.column);
 batchSchema.parse(draft);const errors=seatErrors(draft);if(errors.length)throw new Error(errors.join(';'));
 const now=new Date().toISOString();draft.version=row.version+1;draft.updatedAt=now;published.updatedAt=now;published.publishedAt=now;seating.publishedAt=now;
 app.db.prepare('UPDATE exam_batches SET version=?,draft=?,published=?,seating=? WHERE id=?').run(draft.version,JSON.stringify(draft),JSON.stringify(published),JSON.stringify(seating),id);
 console.log('Added chemistry HL / SL and English in Monday 08:10–09:40; existing exams and selections preserved.');
}finally{app.close();}
