import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {getFontData} from './font-data.mjs';
import {seatSchema,seatErrors,divisionNames} from './exam-model.mjs';
import unzipper from 'unzipper';
const columns=['考试编号','教室','排','列','班级','中文名','英文名'];
export async function seatTemplate(batch){
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('座位数据');
 sheet.addRow([...columns,'年级']);sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
 [26,18,8,8,16,18,24].forEach((width,i)=>sheet.getColumn(i+1).width=width);
 const reference=book.addWorksheet('考试及教室参考');reference.addRow(['考试编号','考试名称','日期','开始','结束','教室']);
 for(const s of batch.sessions)reference.addRow([s.id,s.title,s.date,s.start,s.end,s.rooms.join('、')]);
 reference.columns.forEach(c=>c.width=25);
 const help=book.addWorksheet('填写说明');
 ['每行一个座位，勿修改座位数据表第一行。','考试编号使用参考页中的编号；教室须与考试配置一致。','排从讲台向后、列从左到右，从 1 开始。','班级必填；中文名和英文名至少填一个。','仅填写已安排学生的座位；导入将替换本批次全部草稿座位，请先预览。','可在网站继续编辑。发布前检查同一时段重复占座。'].forEach(v=>help.addRow([v]));help.getColumn(1).width=95;
 return book.xlsx.writeBuffer();
}
export async function parseSeats(buffer,batch){
 const zip=await unzipper.Open.buffer(buffer);
 if(zip.files.length>100||zip.files.reduce((n,f)=>n+f.uncompressedSize,0)>12*1024*1024)throw new Error('Excel 解压后过大，请拆分文件。');
 const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
 const sheet=book.getWorksheet('座位数据');if(!sheet)throw new Error('请使用标准模板的「座位数据」工作表。');
 if(sheet.rowCount>20001)throw new Error('最多导入 20000 个座位。');
 if(columns.some((name,i)=>sheet.getRow(1).getCell(i+1).text.trim()!==name))throw new Error('模板列名不匹配，请重新下载模板。');
 const seats=[],errors=[];
 sheet.eachRow((row,n)=>{
  if(n===1)return;
  const values=columns.map((_,i)=>row.getCell(i+1).value);
  if(values.every(v=>v==null||v===''))return;
  if(values.some(v=>v!=null&&typeof v==='object')){errors.push(`第 ${n} 行：请使用普通文字或数字，不支持公式和富文本`);return;}
  const [examId,room,r,c,className,name,englishName]=values.map(v=>v==null?'':String(v).trim());
  const parsed=seatSchema.safeParse({examId,room,row:Number(r),column:Number(c),className,name,englishName,grade:row.getCell(8).text.trim()?Number(row.getCell(8).text):null});
  if(!parsed.success)errors.push(`第 ${n} 行：${parsed.error.issues.map(i=>i.message).join('；')}`);else seats.push(parsed.data);
 });
 return {seats,errors:[...errors,...seatErrors(batch,seats)].slice(0,100)};
}
export async function makeSchedulePdf(batch,sessions,{schoolName,timeZone,scope,english=false}){
 const doc=new PDFDocument({size:'A4',margin:40,info:{Title:batch.title,Author:schoolName}}),buffers=[];
 const result=new Promise((resolve,reject)=>{doc.on('data',b=>buffers.push(b));doc.on('end',()=>resolve(Buffer.concat(buffers)));doc.on('error',reject);});
 doc.font((await getFontData()).regular);
 const widths=[76,76,185,83,95],labels=english?['Date','Time','Exam','Division / Grade','Rooms']:['日期','时间','考试','学部 / 年级','教室'];
 const tableHeader=()=>{const top=doc.y;doc.rect(40,top,515,25).fill('#e4eff4');let x=40;doc.fontSize(9).fillColor('#243746');labels.forEach((label,i)=>{doc.text(label,x+5,top+6,{width:widths[i]-10,lineBreak:false});x+=widths[i];});doc.y=top+25;};
 const header=()=>{doc.fontSize(18).fillColor('#243746').text(english?(batch.titleEn||batch.title):batch.title);doc.fontSize(9).fillColor('#607581').text(`${schoolName} · ${batch.start} — ${batch.end}`).text(scope).text(`${english?'Generated':'生成于'} ${new Intl.DateTimeFormat(english?'en-GB':'zh-CN',{timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date())} · ${timeZone}`).moveDown();tableHeader();};
 header();
 if(!sessions.length)doc.fontSize(12).text(english?'No exams selected.':'当前范围没有考试。',40,doc.y+15);
 for(const s of sessions){
  const title=(s.cancelled?(english?'[Cancelled] ':'[已取消] '):s.changed?(english?'[Updated] ':'[已变更] '):'')+(english?(s.titleEn||s.title):s.title);
  const examTitle=title+[s.level].filter(value=>value&&!title.includes(value)).map(value=>' · '+value).join('');
  const values=[s.date,`${s.start}–${s.end}`,examTitle,`${english?s.division:divisionNames[s.division]}\n${s.grades.join(' / ')}`,s.rooms.join(' / ')];
  doc.fontSize(10);const height=Math.max(36,...values.map((value,i)=>doc.heightOfString(value,{width:widths[i]-10})+16));
  if(doc.y+height>doc.page.height-45){doc.addPage();header();}
  const y=doc.y;let x=40;doc.fillColor('#243746').fontSize(10);
  values.forEach((value,i)=>{doc.text(value,x+5,y+8,{width:widths[i]-10});x+=widths[i];});
  doc.strokeColor('#dce5eb').moveTo(40,y+height).lineTo(555,y+height).stroke();doc.y=y+height;
 }
 doc.end();return result;
}
