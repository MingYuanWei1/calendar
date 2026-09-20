import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createApplication} from '../server/app.mjs';
import {batchSchema,seatErrors,schedule} from '../server/exam-model.mjs';
import {defaultExamSlots,groupExamLevels} from '../public/exam-times.mjs';
const app=createApplication({dataDir:resolve(process.env.DATA_DIR||'.data'),origin:'http://localhost:3000'});
try{
 const id='sample-exam-levels-2026',record=app.db.prepare('SELECT * FROM exam_batches WHERE id=?').get(id);
 if(!record)throw new Error('HL / SL sample not found');
 mkdirSync('.scratch',{recursive:true});writeFileSync(`.scratch/level-sample-before-fill-${Date.now()}.json`,JSON.stringify(record));
 const batch=JSON.parse(record.draft);
 batch.timeSlots=structuredClone(defaultExamSlots);
 // Keep original exam IDs and personal choices; move the third Monday card to the next slot.
 const english=batch.sessions.find(s=>s.id==='concurrent-english');
 if(english&&english.date==='2026-09-21'&&english.start==='08:10')Object.assign(english,{start:'11:00',end:'12:30'});
 for(const name of ['示例 A-HL','示例 A-SL','示例 B-HL','示例 B-SL'])if(!batch.rooms.some(r=>r.name===name))batch.rooms.push({name,rows:5,columns:5});
 const subjects=[['生物','Biology'],['经济','Economics'],['计算机科学','Computer Science'],['地理','Geography'],['历史','History'],['商务管理','Business Management'],['数学','Mathematics'],['化学','Chemistry']];
 let added=0;
 for(let d=0;d<5;d++)for(let t=0;t<5;t++){
  const date=`2026-09-${21+d}`,slot=defaultExamSlots[t];
  const inCell=()=>batch.sessions.filter(s=>s.date===date&&s.start>=slot.start&&s.start<slot.end);
  let groups=groupExamLevels(inCell());
  if(groups.length>2)throw new Error(`More than two existing cards in ${date} ${slot.start}`);
  while(groups.length<2){
   const lane=groups.length;
   let n=d*5+t+lane;
   while(groups.some(g=>g[0].subject===subjects[n%subjects.length][0]))n++;
   const [subject,subjectEn]=subjects[n%subjects.length],paper=`Paper ${t+1}`;
   for(const level of ['HL','SL']){
    const examId=`filled-${d}-${t}-${lane}-${level.toLowerCase()}`,room=`示例 ${lane?'B':'A'}-${level}`;
    batch.sessions.push({id:examId,subject,subjectEn,level,paper,title:`[示例] ${subject} ${level} · ${paper}`,titleEn:`[Sample] ${subjectEn} ${level} · ${paper}`,division:'high',grades:['G12'],date,start:slot.start,end:slot.end,rooms:[room],cancelled:false,note:'虚构示例，仅用于满表布局及交互预览。'});
    for(let c=1;c<=4;c++)batch.seats.push({examId,room,row:1,column:c,className:'G12 '+level,name:'示例学生'+c,englishName:'Sample '+c});
    added++;
   }
   groups=groupExamLevels(inCell());
  }
 }
 const value=batchSchema.parse(batch),errors=seatErrors(value);if(errors.length)throw new Error(errors.join(';'));
 const now=new Date().toISOString(),next={...value,id,version:record.version+1,updatedAt:now};
 app.db.prepare('UPDATE exam_batches SET version=?,draft=?,published=?,seating=? WHERE id=?').run(next.version,JSON.stringify(next),JSON.stringify({...schedule(next),publishedAt:now}),JSON.stringify({rooms:next.rooms,seats:next.seats,publishedAt:now}),id);
 console.log(JSON.stringify({days:5,slotsPerDay:5,cardsPerCell:2,totalCards:50,addedSessions:added,totalSessions:next.sessions.length,seatErrors:errors.length}));
}finally{app.close();}
