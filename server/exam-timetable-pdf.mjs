import PDFDocument from 'pdfkit';
import {getFontData} from './font-data.mjs';
import {examSlotRows} from '../public/exam-times.mjs';
import {examDatePages} from '../public/exam-dates.mjs';
import {gradeLabel} from '../public/grades.mjs';

// Modelled on ManageBac's timetable PDF: A4 landscape, a fixed black-line grid of time slots × exam dates;
// HEAD_H and ROW_H are its header and period row heights.
const PAGE=[841.89,595.28],MARGIN=30,TIME_W=56,HEAD_H=14.294,ROW_H=61.75,PAD=4,SIZE=8,FOOTER=7;
const WIDTH=PAGE[0]-2*MARGIN,GRID_BOTTOM=PAGE[1]-MARGIN-FOOTER-6;
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const day=date=>new Date(date+'T12:00:00Z');

/**
 * The exam timetable PDF for one published batch.
 * scope: 'mine' (headed by the student's name), 'all', or 'grades' (headed by the chosen grades).
 * sessions are the ones to show: the caller leaves out cancelled exams.
 */
export async function examTimetablePdf(batch,sessions,{scope,grades,name,english,timeZone}){
 const fonts=await getFontData();
 const batchTitle=english?(batch.titleEn||batch.title):batch.title,grade=g=>gradeLabel(g,1),gradeList=list=>[...list].sort((a,b)=>a-b).map(grade).join(' / ');
 const doc=new PDFDocument({size:PAGE,margin:0,bufferPages:true,autoFirstPage:false,compress:true,info:{Title:batchTitle}}),chunks=[];
 const result=new Promise((resolve,reject)=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.registerFont('regular',fonts.regular);doc.registerFont('bold',fonts.bold);
 // Dates are spelled out by hand: ICU builds disagree on month abbreviations ("Sep" vs "Sept").
 const parts=date=>{const d=day(date);return {y:d.getUTCFullYear(),m:d.getUTCMonth(),d:d.getUTCDate(),w:d.getUTCDay()};};
 const longDate=date=>{const p=parts(date);return english?`${p.d} ${MONTHS[p.m]} ${p.y}`:`${p.y}年${p.m+1}月${p.d}日`;};
 const columnDate=date=>{const p=parts(date);return english?`${WEEKDAYS[p.w]} ${p.d} ${MONTHS[p.m]}`:`${p.m+1}月${p.d}日 周${'日一二三四五六'[p.w]}`;};
 const stamp=value=>{const at=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));return `${longDate(`${at.year}-${at.month}-${at.day}`)} ${at.hour}:${at.minute}`;};
 const examTitle=s=>{const title=english?(s.titleEn||s.title):s.title;return title+(s.level&&!title.includes(s.level)?' '+s.level:'');};

 // The heading sits on the first page only.
 doc.addPage();doc.fillColor('black').strokeColor('black').lineWidth(0.5);
 const titles=scope==='mine'?[english?`${name}'s Timetable`:`${name} 的考试安排`,batchTitle]:[scope==='grades'?`${batchTitle} · ${gradeList(grades)}`:batchTitle];
 const range=`${longDate(batch.start)} – ${longDate(batch.end)}`,room=WIDTH-doc.font('regular').fontSize(12).widthOfString(range)-12;
 // A long name or batch title shrinks rather than run into the dates.
 const fitted=(text,size)=>Math.min(size,size*room/doc.fontSize(size).widthOfString(text));
 doc.fontSize(fitted(titles[0],18)).text(titles[0],MARGIN,MARGIN,{lineBreak:false});
 if(titles[1])doc.fontSize(fitted(titles[1],12)).text(titles[1],MARGIN,MARGIN+24,{lineBreak:false});
 doc.fontSize(12).text(range,MARGIN,MARGIN+4,{width:WIDTH,align:'right',lineBreak:false});
 let y=MARGIN+(titles[1]?50:34);

 for(const [index,days] of examDatePages(sessions).entries()){
  if(index){doc.addPage();y=MARGIN;}
  const dayW=(WIDTH-TIME_W)/days.length,week=sessions.filter(s=>days.includes(s.date));
  const header=()=>{
   doc.font('bold').fontSize(SIZE);
   const top=y+(HEAD_H-doc.currentLineHeight())/2;
   doc.rect(MARGIN,y,TIME_W,HEAD_H).stroke();doc.text(english?'Time':'时间',MARGIN,top,{width:TIME_W,align:'center',lineBreak:false});
   days.forEach((date,i)=>{const x=MARGIN+TIME_W+i*dayW;doc.rect(x,y,dayW,HEAD_H).stroke();doc.text(columnDate(date),x,top,{width:dayW,align:'center',lineBreak:false});});
   y+=HEAD_H;
  };
  header();let fresh=true;
  for(const row of examSlotRows(batch.timeSlots,week)){
   const cells=days.map(date=>row.sessions.filter(s=>s.date===date).sort((a,b)=>a.start.localeCompare(b.start)||examTitle(a).localeCompare(examTitle(b))).map(s=>({
    title:examTitle(s),
    details:[`${s.start}–${s.end}`,s.rooms.join(' / '),scope==='mine'?'':gradeList(s.grades)].filter(Boolean).join('\n')
   })));
   const content=(cell,size)=>cell.reduce((h,exam,i)=>h+(i?PAD:0)+doc.font('bold').fontSize(size).heightOfString(exam.title,{width:dayW-2*PAD})+(exam.details?doc.font('regular').fontSize(size).heightOfString(exam.details,{width:dayW-2*PAD}):0),0);
   const measure=size=>Math.max(ROW_H,...cells.map(cell=>content(cell,size)+2*PAD));
   // A row that does not fit moves to a new page; one taller than the space a page offers shrinks its text.
   let size=SIZE,height=measure(size);
   if(y+height>GRID_BOTTOM){
    if(!fresh){doc.addPage();y=MARGIN;header();}
    while(y+height>GRID_BOTTOM){size*=0.9;height=measure(size);}
   }
   fresh=false;
   doc.rect(MARGIN,y,TIME_W,height).stroke();
   // Every cell's text sits in the middle of its row.
   const time=`${row.start}\n–\n${row.end}`;
   doc.font('regular').fontSize(SIZE).text(time,MARGIN,y+(height-doc.heightOfString(time,{width:TIME_W}))/2,{width:TIME_W,align:'center'});
   cells.forEach((cell,i)=>{
    const x=MARGIN+TIME_W+i*dayW;let top=y+(height-content(cell,size))/2;
    doc.rect(x,y,dayW,height).stroke();
    cell.forEach((exam,n)=>{
     if(n){doc.moveTo(x+PAD,top+PAD/2).lineTo(x+dayW-PAD,top+PAD/2).lineWidth(0.25).stroke().lineWidth(0.5);top+=PAD;}
     doc.font('bold').fontSize(size).text(exam.title,x+PAD,top,{width:dayW-2*PAD});top=doc.y;
     if(exam.details){doc.font('regular').fontSize(size).text(exam.details,x+PAD,top,{width:dayW-2*PAD});top=doc.y;}
    });
   });
   y+=height;
  }
 }

 const {start,count}=doc.bufferedPageRange();
 const footer=`${english?'Generated':'生成于'} ${stamp(Date.now())} · ${english?'Schedule updated':'考试安排更新于'} ${stamp(batch.publishedAt)}`;
 for(let i=start;i<start+count;i++){
  doc.switchToPage(i);doc.font('regular').fontSize(FOOTER).fillColor('black');
  doc.text(footer,MARGIN,PAGE[1]-MARGIN-FOOTER,{width:WIDTH*0.8,lineBreak:false});
  doc.text(`${i-start+1} / ${count}`,MARGIN,PAGE[1]-MARGIN-FOOTER,{width:WIDTH,align:'right',lineBreak:false});
 }
 doc.end();return result;
}
