import PDFDocument from 'pdfkit';
import {getFontData} from './font-data.mjs';
import {examSlotRows,groupExamLevels} from '../public/exam-times.mjs';
import {examDatePages} from '../public/exam-dates.mjs';
import {gradeLabel} from '../public/grades.mjs';

// Modelled on ManageBac's timetable PDF: A4 landscape, a fixed black-line grid of time slots × exam dates;
// HEAD_H and ROW_H are its header and period row heights.
// BOLD is the frame, column and header line width; LABEL is the share of a cell a merged subject's name takes.
const PAGE=[841.89,595.28],MARGIN=30,TIME_W=56,HEAD_H=14.294,ROW_H=61.75,PAD=4,SIZE=8,FOOTER=7,LINE=0.5,BOLD=1.5,LABEL=0.4;
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
 doc.addPage();doc.fillColor('black').strokeColor('black').lineWidth(LINE);
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
  const dayW=(WIDTH-TIME_W)/days.length,week=sessions.filter(s=>days.includes(s.date)),labelW=dayW*LABEL;
  let gridTop=y;
  const line=(x1,y1,x2,y2,width)=>doc.moveTo(x1,y1).lineTo(x2,y2).lineWidth(width).stroke().lineWidth(LINE);
  // The frame, the column lines and the header row are drawn bold over the finished grid of a page.
  const frame=()=>{
   doc.lineWidth(BOLD).rect(MARGIN,gridTop,WIDTH,y-gridTop).stroke().lineWidth(LINE);
   line(MARGIN,gridTop+HEAD_H,MARGIN+WIDTH,gridTop+HEAD_H,BOLD);
   for(let i=0;i<days.length;i++)line(MARGIN+TIME_W+i*dayW,gridTop,MARGIN+TIME_W+i*dayW,y,BOLD);
  };
  const header=()=>{
   gridTop=y;doc.font('bold').fontSize(SIZE);
   const top=y+(HEAD_H-doc.currentLineHeight())/2;
   doc.rect(MARGIN,y,TIME_W,HEAD_H).stroke();doc.text(english?'Time':'时间',MARGIN,top,{width:TIME_W,align:'center',lineBreak:false});
   days.forEach((date,i)=>{const x=MARGIN+TIME_W+i*dayW;doc.rect(x,y,dayW,HEAD_H).stroke();doc.text(columnDate(date),x,top,{width:dayW,align:'center',lineBreak:false});});
   y+=HEAD_H;
  };
  header();let fresh=true;
  for(const row of examSlotRows(batch.timeSlots,week)){
   // A cell is a column of blocks: one exam, or (for whole-school and grade exports) one grade's levels of a subject,
   // named with their time on the left and split into a cell per level on the right.
   const cells=days.map(date=>{
    const day=row.sessions.filter(s=>s.date===date).sort((a,b)=>a.start.localeCompare(b.start)||examTitle(a).localeCompare(examTitle(b)));
    return (scope==='mine'?day.map(s=>[s]):groupExamLevels(day)).map(levels=>{
     if(levels.length===1){const s=levels[0];return {title:examTitle(s),details:[`${s.start}–${s.end}`,s.rooms.join(' / '),scope==='mine'?'':gradeList(s.grades)].filter(Boolean).join('\n')};}
     const first=levels[0],same=levels.every(s=>s.start===first.start&&s.end===first.end);
     const from=levels.map(s=>s.start).sort()[0],to=levels.map(s=>s.end).sort().at(-1);
     return {label:`${gradeList(first.grades)} ${english?(first.subjectEn||first.subject):first.subject}`,time:`${from}–${to}`,
      levels:levels.map(s=>({title:examTitle(s),details:[same?'':`${s.start}–${s.end}`,s.rooms.join(' / ')].filter(Boolean).join('\n')}))};
    });
   });
   const textHeight=(item,size,width)=>doc.font('bold').fontSize(size).heightOfString(item.title,{width})+(item.details?doc.font('regular').fontSize(size).heightOfString(item.details,{width}):0);
   const labelHeight=(block,size)=>doc.font('bold').fontSize(size).heightOfString(block.label,{width:labelW-2*PAD})+doc.font('regular').fontSize(size).heightOfString(block.time,{width:labelW-2*PAD});
   const levelHeights=(block,size)=>block.levels.map(level=>textHeight(level,size,dayW-labelW-2*PAD));
   const blockHeight=(block,size)=>block.levels?Math.max(labelHeight(block,size),levelHeights(block,size).reduce((h,l)=>h+l+PAD,-PAD)):textHeight(block,size,dayW-2*PAD);
   const measure=size=>Math.max(ROW_H,...cells.map(cell=>cell.reduce((h,block)=>h+blockHeight(block,size)+PAD,PAD)));
   // A row that does not fit moves to a new page; one taller than the space a page offers shrinks its text.
   let size=SIZE,height=measure(size);
   if(y+height>GRID_BOTTOM){
    if(!fresh){frame();doc.addPage();y=MARGIN;header();}
    while(y+height>GRID_BOTTOM){size*=0.9;height=measure(size);}
   }
   fresh=false;
   doc.rect(MARGIN,y,TIME_W,height).stroke();
   const time=`${row.start}\n–\n${row.end}`;
   doc.font('regular').fontSize(SIZE).text(time,MARGIN,y+(height-doc.heightOfString(time,{width:TIME_W}))/2,{width:TIME_W,align:'center'});
   const write=(item,x,top,width)=>{doc.font('bold').fontSize(size).text(item.title,x,top,{width});if(item.details)doc.font('regular').fontSize(size).text(item.details,x,doc.y,{width});};
   cells.forEach((cell,i)=>{
    const x=MARGIN+TIME_W+i*dayW;
    doc.rect(x,y,dayW,height).stroke();
    // Blocks share the row's height evenly, so a short column fills its cell; text stays centred in each block.
    const heights=cell.map(block=>blockHeight(block,size)),spare=(height-heights.reduce((a,b)=>a+b,0))/(cell.length||1);
    let top=y;
    cell.forEach((block,n)=>{
     const blockH=heights[n]+spare;
     if(n)line(x+PAD,top,x+dayW-PAD,top,0.25);
     if(!block.levels)write(block,x+PAD,top+(blockH-heights[n])/2,dayW-2*PAD);
     else{
      const labelTop=top+(blockH-labelHeight(block,size))/2;
      doc.font('bold').fontSize(size).text(block.label,x+PAD,labelTop,{width:labelW-2*PAD});
      doc.font('regular').fontSize(size).text(block.time,x+PAD,doc.y,{width:labelW-2*PAD});
      line(x+labelW,top+(n?0:PAD),x+labelW,top+blockH-(n<cell.length-1?0:PAD),0.25);
      const levels=levelHeights(block,size),slack=(blockH-levels.reduce((a,b)=>a+b,0))/levels.length;
      let levelTop=top;
      block.levels.forEach((level,m)=>{
       if(m)line(x+labelW,levelTop,x+dayW-PAD,levelTop,0.25);
       write(level,x+labelW+PAD,levelTop+slack/2,dayW-labelW-2*PAD);levelTop+=levels[m]+slack;
      });
     }
     top+=blockH;
    });
   });
   y+=height;
  }
  frame();
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
