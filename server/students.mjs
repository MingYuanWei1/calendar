import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {pinyin} from 'pinyin-pro';

export const inferAcademicYear=date=>Number(date.slice(0,4))-(Number(date.slice(5,7))<9?1:0);
const gradeNumber=value=>{const match=String(value??'').trim().match(/^(?:G|Grade\s*)?(\d{1,2})(?:\.\d+|[A-Z])?$/i);const n=match?Number(match[1]):0;return n>=1&&n<=12?n:null;};
const namePinyin=name=>/^[\p{Script=Han}]+$/u.test(name)?pinyin(name,{toneType:'none',type:'array',surname:'head'}).join('').replaceAll('ü','v'):'';
const normalizeEmail=value=>typeof value==='string'?value.trim().toLowerCase():'';
export function installStudents(app,db,requireAdmin){
 db.exec(`CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS student_merges(source_id TEXT PRIMARY KEY,target_id TEXT NOT NULL,source_body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS student_settings(id INTEGER PRIMARY KEY CHECK(id=1),domain TEXT NOT NULL);`);
 const domain=()=>db.prepare('SELECT domain FROM student_settings WHERE id=1').get()?.domain||'';
 const validEmail=email=>{const value=normalizeEmail(email),parts=value.split('@');return !!domain()&&parts.length===2&&parts[1]===domain()&&/^\d{2}[a-z]+$/.test(parts[0]);};
 const rawList=()=>db.prepare('SELECT body FROM students').all().map(r=>JSON.parse(r.body));
 const put=student=>db.prepare('INSERT INTO students VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(student.id,JSON.stringify(student));
 const get=id=>{const row=db.prepare('SELECT body FROM students WHERE id=?').get(id);return row?JSON.parse(row.body):null;};
 function describe(list=rawList()){
  const result=list.map(s=>({...s,email:s.actualEmail|| (s.graduationYear&&s.pinyin&&domain()?`${String(s.graduationYear).slice(-2)}${s.pinyin}@${domain()}`:''),issues:[]}));
  const emails=new Map();for(const s of result){if(s.email){const group=emails.get(s.email)||[];group.push(s);emails.set(s.email,group);}}
  for(const s of result){
   if(!s.name||!s.graduationYear||!s.pinyin)s.issues.push('姓名、年级或拼音待补充');
   if(s.actualEmail&&s.graduationYear&&!s.actualEmail.startsWith(String(s.graduationYear).slice(-2)))s.issues.push('实际邮箱年份与毕业年份不一致');
   if(!validEmail(s.email))s.issues.push('学校邮箱未配置或不符合规则');
   if(emails.get(s.email)?.length>1)s.issues.push('邮箱匹配冲突，请核实同音姓名或重复学生');
  }
  return result;
 }
 function infer(batch,seat){
  const session=batch.sessions.find(s=>s.id===seat.examId);
  const classGrade=gradeNumber(seat.className),sessionGrades=(session?.grades||[]).map(gradeNumber).filter(Boolean);
  const explicit=seat.grade||null,grade=explicit||classGrade||(sessionGrades.length===1?sessionGrades[0]:null);
  const issues=[];
  if(explicit&&classGrade&&explicit!==classGrade)issues.push('个人年级与班级矛盾');
  if(grade&&sessionGrades.length&& !sessionGrades.includes(grade))issues.push('个人年级与考试适用年级矛盾');
  const graduationYear=grade?(batch.academicYear??inferAcademicYear(batch.start))+1+12-grade:null;
  return {grade,graduationYear,issues,pinyin:namePinyin(seat.name)};
 }
 function organize(batch,persist=true){
  const list=rawList(),byId=new Map(list.map(s=>[s.id,s])),byIdentity=new Map();
  const year=batch.academicYear??inferAcademicYear(batch.start);
  const key=(name,englishName,graduationYear)=>JSON.stringify([name,englishName,graduationYear]);
  const index=s=>{const k=key(s.name,s.englishName,s.graduationYear),group=byIdentity.get(k)||[];group.push(s);byIdentity.set(k,group);};
  for(const s of list)index(s);
  for(const r of db.prepare('SELECT target_id,source_body FROM student_merges').all())if(byId.has(r.target_id))index({...JSON.parse(r.source_body),retainedId:r.target_id});
  const seats=batch.seats.map(seat=>{
   const inferred=infer(batch,seat);
   let student=seat.studentId&&byId.get(seat.studentId);
   if(!student){
    const matches=(byIdentity.get(key(seat.name,seat.englishName,inferred.graduationYear))||[]).filter(s=>s.enrollments?(!s.enrollments[year]||s.enrollments[year]===seat.className):s.className===seat.className);
    const unique=[...new Set(matches.map(s=>s.retainedId||s.id))];
    if(unique.length===1)student=byId.get(unique[0]);
    else {student={id:randomUUID(),version:1,name:seat.name,englishName:seat.englishName,className:seat.className,graduationYear:inferred.graduationYear,pinyin:inferred.pinyin,actualEmail:'',enrollments:{[year]:seat.className}};list.push(student);byId.set(student.id,student);index(student);if(persist)put(student);}
   }
   if(!student.enrollments?.[year]){student.enrollments={...student.enrollments,[year]:seat.className};student.className=student.enrollments[Math.max(...Object.keys(student.enrollments).map(Number))];student.version++;if(persist)put(student);}
   if(inferred.graduationYear!==student.graduationYear)inferred.issues.push('学生毕业年份与本批次学年、年级不一致，请核实');
   return {...seat,grade:inferred.grade,studentId:student.id,identityIssues:inferred.issues};
  });
  const details=new Map(describe(list).map(s=>[s.id,s]));
  return {...batch,academicYear:batch.academicYear??inferAcademicYear(batch.start),seats:seats.map(seat=>({...seat,student:details.get(seat.studentId),identityIssues:[...seat.identityIssues,...details.get(seat.studentId).issues]}))};
 }
 function publishSeats(batch){
  const details=new Map(describe().map(s=>[s.id,s]));
  return batch.seats.map(({student,identityIssues,...seat})=>{
   const record=details.get(seat.studentId),inferred=infer(batch,seat),issues=inferred.issues;
   if(record?.graduationYear!==inferred.graduationYear)issues.push('毕业年份不一致');
   return {...seat,matchEmail:record&&!record.issues.length&&!issues.length?record.email:''};
  });
 }
 app.get('/api/admin/students/settings',requireAdmin,(req,res)=>res.json({domain:domain()}));
 app.put('/api/admin/students/settings',requireAdmin,(req,res)=>{
  const value=String(req.body.domain||'').trim().toLowerCase();
  if(value.length>253||!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(value))return res.status(422).json({error:'请填写有效学校邮箱域名。'});
  db.prepare('INSERT INTO student_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET domain=excluded.domain').run(value);res.json({domain:value});
 });
 function referenceIndex(){
  const index=new Map(),records=new Map(rawList().map(s=>[s.id,s]));
  for(const r of db.prepare('SELECT id,draft,seating FROM exam_batches').all())for(const kind of ['draft','seating']){
   if(!r[kind])continue;const batch=JSON.parse(r[kind]);
   for(const seat of batch.seats){if(!seat.studentId)continue;const refs=index.get(seat.studentId)||[];refs.push({batchId:r.id,kind,examId:seat.examId,room:seat.room,row:seat.row,column:seat.column,className:seat.className,grade:seat.grade,academicYear:batch.academicYear,issues:kind==='draft'?[...infer(batch,seat).issues,...(infer(batch,seat).graduationYear!==records.get(seat.studentId)?.graduationYear?['学生毕业年份与本批次学年、年级不一致']:[])]:[]});index.set(seat.studentId,refs);}
  }
  return index;
 }
 app.get('/api/admin/students',requireAdmin,(req,res)=>{const index=referenceIndex();res.json(describe().map(s=>({...s,issues:[...new Set([...s.issues,...(index.get(s.id)||[]).flatMap(r=>r.issues)])],references:index.get(s.id)||[]})));});
 const editSchema=z.object({version:z.number().int(),name:z.string().trim().max(80),englishName:z.string().trim().max(120),className:z.string().trim().max(60),graduationYear:z.number().int().min(2000).max(2299).nullable(),pinyin:z.string().trim().max(160).regex(/^[a-z]*$/),actualEmail:z.string().trim().max(254)});
 app.patch('/api/admin/students/:id',requireAdmin,(req,res)=>{
  const current=get(req.params.id);if(!current)return res.status(404).json({error:'学生不存在。'});
  const parsed=editSchema.safeParse(req.body);if(!parsed.success)return res.status(422).json({error:'请检查学生姓名、毕业年份、拼音与邮箱。'});
  if(parsed.data.version!==current.version)return res.status(409).json({error:'学生信息已更新，请刷新后再试。'});
  const actualEmail=normalizeEmail(parsed.data.actualEmail);
  if(actualEmail&&!validEmail(actualEmail))return res.status(422).json({error:'实际邮箱不符合学校邮箱规则。'});
  const next={...current,...parsed.data,actualEmail,version:current.version+1};
  const latest=Math.max(...Object.keys(current.enrollments||{}).map(Number));if(Number.isFinite(latest)&&next.className!==current.className)next.enrollments={...current.enrollments,[latest]:next.className};
  put(next);res.json(describe().find(s=>s.id===next.id));
 });
 function mergePreview(sourceId,targetId){
  const source=get(sourceId),target=get(targetId),errors=[];
  if(!source||!target||sourceId===targetId)return {errors:['请选择两个不同的有效学生。']};
  const index=referenceIndex(),refs=[...(index.get(sourceId)||[]),...(index.get(targetId)||[])];
  for(const kind of ['draft','seating']){
   const seen=new Map();for(const r of refs.filter(r=>r.kind===kind)){const key=r.batchId+'|'+r.examId,place=JSON.stringify([r.room,r.row,r.column]);if(seen.has(key)&&seen.get(key)!==place)errors.push('同一场考试有不同座位，请先修正并发布。');seen.set(key,place);}
  }
  return {source,target,references:refs,errors:[...new Set(errors)]};
 }
 app.get('/api/admin/students/:id/merge-preview',requireAdmin,(req,res)=>res.json(mergePreview(req.params.id,req.query.target)));
 app.post('/api/admin/students/:id/merge',requireAdmin,(req,res)=>{
  const previous=db.prepare('SELECT target_id FROM student_merges WHERE source_id=?').get(req.params.id);
  if(previous?.target_id===req.body.targetId)return res.json({student:describe().find(s=>s.id===previous.target_id),message:'学生已合并。'});
  const preview=mergePreview(req.params.id,req.body.targetId);if(preview.errors.length)return res.status(422).json({error:preview.errors.join('；')});
  if(preview.source.version!==req.body.version||preview.target.version!==req.body.targetVersion)return res.status(409).json({error:'学生信息已更新，请重新预览。'});
  db.transactionSync(()=>{
   for(const r of db.prepare('SELECT id,version,draft FROM exam_batches').all()){
    const draft=JSON.parse(r.draft);if(!draft.seats.some(s=>s.studentId===preview.source.id))continue;
    draft.seats=draft.seats.map(s=>s.studentId===preview.source.id?{...s,studentId:preview.target.id}:s);
    draft.version=r.version+1;db.prepare('UPDATE exam_batches SET version=?,draft=? WHERE id=?').run(draft.version,JSON.stringify(draft),r.id);
   }
   db.prepare('INSERT INTO student_merges VALUES(?,?,?)').run(preview.source.id,preview.target.id,JSON.stringify(preview.source));
   db.prepare('UPDATE student_merges SET target_id=? WHERE target_id=?').run(preview.target.id,preview.source.id);
   put({...preview.target,version:preview.target.version+1});db.prepare('DELETE FROM students WHERE id=?').run(preview.source.id);
  });
  res.json({student:describe().find(s=>s.id===preview.target.id),message:'学生已合并；请重新发布相关批次座位。'});
 });
 return {organize,publishSeats,validEmail,normalizeEmail};
}
