import {resolve} from 'node:path';
import {createApplication} from '../server/app.mjs';
import {batchSchema,schedule} from '../server/exam-model.mjs';
const app=createApplication({dataDir:resolve(process.env.DATA_DIR||'.data'),origin:'http://localhost:3000'});
const id='sample-exam-levels-2026';
try{
 if(app.db.prepare('SELECT id FROM exam_batches WHERE id=?').get(id)){console.log('Level sample already exists; preserved.');}
 else{
  const rooms=[{name:'2101',rows:5,columns:5},{name:'2102',rows:5,columns:5},{name:'3101',rows:5,columns:5}];
  const sessions=[
   {id:'math-hl',subject:'数学',subjectEn:'Mathematics',level:'HL',paper:'Paper 1',date:'2026-09-21',start:'08:10',end:'09:40',rooms:['2101','2102']},
   {id:'math-sl',subject:'数学',subjectEn:'Mathematics',level:'SL',paper:'Paper 1',date:'2026-09-21',start:'08:10',end:'09:10',rooms:['3101']},
   {id:'physics-hl',subject:'物理',subjectEn:'Physics',level:'HL',paper:'Paper 1',date:'2026-09-22',start:'11:00',end:'12:30',rooms:['2101']},
   {id:'physics-sl',subject:'物理',subjectEn:'Physics',level:'SL',paper:'Paper 1',date:'2026-09-22',start:'11:00',end:'12:30',rooms:['2102']},
  ].map(s=>({...s,title:`[示例] ${s.subject} ${s.level} · ${s.paper}`,titleEn:`[Sample] ${s.subjectEn} ${s.level} · ${s.paper}`,division:'high',grades:['G12'],note:'虚构示例，仅用于 Level 分组预览。'}));
  const seats=sessions.flatMap(s=>s.rooms.flatMap(room=>Array.from({length:4},(_,i)=>({examId:s.id,room,row:1,column:i+1,className:'G12 '+s.level,name:'示例学生'+(i+1),englishName:'Sample '+(i+1)}))));
  const batch={...batchSchema.parse({title:'[示例] HL / SL 分组考试',titleEn:'[Sample] HL / SL exams',start:'2026-09-21',end:'2026-09-25',rooms,sessions,seats}),id,version:1,updatedAt:new Date().toISOString()};
  app.db.prepare('INSERT INTO exam_batches VALUES(?,?,?,?,?)').run(id,1,JSON.stringify(batch),JSON.stringify({...schedule(batch),publishedAt:batch.updatedAt}),JSON.stringify({rooms,seats,publishedAt:batch.updatedAt}));
  console.log('Created separate fictional HL / SL series.');
 }
}finally{app.close();}
