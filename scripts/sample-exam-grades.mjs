import {DatabaseSync} from 'node:sqlite';
import {resolve,join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {batchSchema,seatErrors} from '../server/exam-model.mjs';
import {groupExamLevels} from '../public/exam-times.mjs';
const db=new DatabaseSync(join(resolve(process.env.DATA_DIR||'.data'),'calendar.sqlite'));
try{
 const id='sample-exam-levels-2026',record=db.prepare('SELECT * FROM exam_batches WHERE id=?').get(id);
 if(!record)throw new Error('HL / SL sample not found');
 mkdirSync('.scratch',{recursive:true});writeFileSync(`.scratch/level-sample-before-grades-${Date.now()}.json`,JSON.stringify(record));
 const draft=JSON.parse(record.draft),groups=groupExamLevels([...draft.sessions].sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.id.localeCompare(b.id)));
 const grades=new Map();groups.forEach((group,i)=>group.forEach(exam=>grades.set(exam.id,['G10','G11','G12'][i%3])));
 const update=data=>{
  for(const exam of data.sessions||[])exam.grades=[grades.get(exam.id)||exam.grades[0]];
  for(const seat of data.seats||[]){const grade=grades.get(seat.examId);if(grade)seat.className=seat.className.replace(/G1[012]/g,grade);}
  return data;
 };
 update(draft);batchSchema.parse(draft);const errors=seatErrors(draft);if(errors.length)throw new Error(errors.join(';'));
 const now=new Date().toISOString();draft.version=record.version+1;draft.updatedAt=now;
 const published=record.published?update(JSON.parse(record.published)):null;if(published){published.updatedAt=now;published.publishedAt=now;}
 const seating=record.seating?update(JSON.parse(record.seating)):null;if(seating)seating.publishedAt=now;
 db.prepare('UPDATE exam_batches SET version=?,draft=?,published=?,seating=? WHERE id=?').run(draft.version,JSON.stringify(draft),published?JSON.stringify(published):null,seating?JSON.stringify(seating):null,id);
 console.log(JSON.stringify(Object.fromEntries(['G10','G11','G12'].map(grade=>[grade,{cards:groups.filter(g=>grades.get(g[0].id)===grade).length,sessions:draft.sessions.filter(s=>s.grades.includes(grade)).length}]))));
}finally{db.close();}
