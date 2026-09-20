import {resolve} from 'node:path';
import {createApplication} from '../server/app.mjs';
import {batchSchema,schedule} from '../server/exam-model.mjs';
const app=createApplication({dataDir:resolve(process.env.DATA_DIR||'.data'),origin:'http://localhost:3000'}),id='sample-exams-autumn-2026';
try{
 if(app.db.prepare('SELECT id FROM exam_batches WHERE id=?').get(id)){console.log('Exam sample already exists; preserved.');}
 else{
 const rooms=[{name:'2101',rows:5,columns:5},{name:'2102',rows:6,columns:4},{name:'3101',rows:5,columns:6}];
 const specs=[['math-p1','数学 Extended · Paper 1','Mathematics Extended · Paper 1','high','G10','2026-09-21','08:15','09:45',['2101','2102']],['math-core','数学 Core · Paper 1','Mathematics Core · Paper 1','high','G10','2026-09-21','08:15','09:15',['2101']],['english','英语阅读与写作','English reading and writing','high','G10','2026-09-22','09:00','11:00',['2101']],['physics','物理 · Paper 1','Physics · Paper 1','high','G11','2026-09-23','08:30','10:00',['3101']],['chemistry','化学 · Paper 1','Chemistry · Paper 1','high','G11','2026-09-23','09:30','11:00',['2102']],['math-p2','数学 Extended · Paper 2','Mathematics Extended · Paper 2','high','G10','2026-09-28','13:30','15:30',['2101','2102']],['middle-math','初中数学','Middle school mathematics','middle','G8','2026-09-21','08:30','10:00',['3101']],['primary-language','语文综合测评','Chinese assessment','primary','G5','2026-09-22','09:00','10:00',['3101']]];
 const sessions=specs.map(([id,title,titleEn,division,grade,date,start,end,rooms])=>({id,title:'[示例] '+title,titleEn:'[Sample] '+titleEn,division,grades:[grade],date,start,end,rooms,note:'虚构示例，仅用于功能预览。',cancelled:false}));
 const seats=[];for(const s of sessions)for(let i=0;i<8;i++)seats.push({examId:s.id,room:s.rooms[0],row:Math.floor(i/4)+1,column:s.id==='math-core'?5:i%4+1,className:s.grades[0]+'A',name:'示例学生'+(i+1),englishName:'Sample '+(i+1)});
 // The Core group occupies a separate column in the shared room.
 const validSeats=seats.filter(s=>s.examId!=='math-core');for(let i=0;i<5;i++)validSeats.push({examId:'math-core',room:'2101',row:i+1,column:5,className:'G10B',name:'示例乙'+(i+1),englishName:'Example '+(i+1)});
 const batch={...batchSchema.parse({title:'[示例] 秋季阶段考试',titleEn:'[Sample] Autumn assessments',start:'2026-09-21',end:'2026-10-02',rooms,sessions,seats:validSeats}),id,version:1,updatedAt:new Date().toISOString()};
 app.db.prepare('INSERT INTO exam_batches VALUES(?,?,?,?,?)').run(id,1,JSON.stringify(batch),JSON.stringify({...schedule(batch),publishedAt:batch.updatedAt}),JSON.stringify({rooms,seats:validSeats,publishedAt:batch.updatedAt}));console.log('Created fictional exam series with 8 exams and '+validSeats.length+' sample seats.');
 }
}finally{app.close();}
