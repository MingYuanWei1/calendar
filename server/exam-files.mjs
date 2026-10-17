import ExcelJS from 'exceljs';
import {seatSchema,seatErrors,adaptRooms} from './exam-model.mjs';
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
 const {rooms,changes}=adaptRooms(batch,seats);
 return {seats,roomChanges:changes,errors:[...errors,...seatErrors({...batch,rooms},seats)].slice(0,100)};
}
