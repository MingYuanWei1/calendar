import express from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {connection,respond,generate,lenientList} from './llm-stream.mjs';
import {sourceSchema} from './exam-extract.mjs';
import {MEDIA,readMaterials,materialsRequest,UPLOAD_LIMIT} from './materials.mjs';
import {inferAcademicYear,gradeNumber} from './students.mjs';

// 核验学生年级: the model only reads the administrator's reference (a class list, roster, screenshot or workbook) into rows;
// matching each row to a student and comparing cohort and class happens here, so the verdict never rests on the model.
const rowSchema=z.object({name:z.string().max(80).nullish(),englishName:z.string().max(120).nullish(),className:z.string().max(60).nullish(),grade:z.union([z.number(),z.string().max(30)]).nullish(),source:sourceSchema});
const MAX_ROWS=1500;
const norm=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
// "11.3", "11-3" and "G11 3" name the same class, so only a real difference is proposed as a change.
const sameClass=(a,b)=>{const key=value=>String(value||'').toUpperCase().replace(/^GRADE\s*/,'').replace(/^G(?=\d)/,'').replace(/[\s.\-_·/]/g,'');return key(a)===key(b);};
const pick=({id,version,name,englishName,className,graduationYear,pinyin,actualEmail,email})=>({id,version,name,englishName,className,graduationYear,pinyin,actualEmail,email});

/**
 * Compares reference rows with the stored students for `academicYear`. Each item has a status: ok, mismatch
 * (changes holds the corrected graduationYear and/or className), noGrade (matched, but the reference gives no grade),
 * ambiguous (namesakes: candidates) or missing (no such student).
 */
export function compareStudents(rows,students,academicYear){
 const items=[],warnings=[];
 for(const row of rows){
  const name=row.name?.trim()||'',englishName=row.englishName?.trim()||'',className=row.className?.trim()||'';
  if(!name&&!englishName){if(row.source?.quote)warnings.push(`“${row.source.quote}”没有姓名，已跳过。`);continue;}
  const grade=gradeNumber(row.grade)||gradeNumber(className);
  const expected=grade?academicYear+1+12-grade:null;
  let found=students.filter(s=>name?s.name===name:norm(s.englishName)===norm(englishName));
  // Namesakes are narrowed by English name, then class, then cohort; whatever is still tied is left to the administrator.
  const narrow=test=>{const kept=found.filter(test);if(kept.length)found=kept;};
  if(found.length>1&&name&&englishName)narrow(s=>norm(s.englishName)===norm(englishName));
  if(found.length>1&&className)narrow(s=>sameClass(s.className,className));
  if(found.length>1&&expected)narrow(s=>s.graduationYear===expected);
  const base={key:randomUUID(),row:{name,englishName,className,grade},expected,source:row.source||null};
  if(!found.length){items.push({...base,status:'missing',student:null,changes:{}});continue;}
  if(found.length>1){items.push({...base,status:'ambiguous',student:null,candidates:found.map(pick),changes:{}});continue;}
  const student=found[0],changes={};
  if(expected&&student.graduationYear!==expected)changes.graduationYear=expected;
  if(className&&!sameClass(student.className,className))changes.className=className;
  items.push({...base,status:Object.keys(changes).length?'mismatch':grade?'ok':'noGrade',student:pick(student),changes});
 }
 return {items,warnings};
}

/** `medium` is 'materials' (pasted text, images, PDF pages) or 'xlsx' (worksheet cells). */
export const checkInstruction=({academicYear,medium='materials'})=>`You read a school's reference list of students (a class list, roster, spreadsheet or document) from ${MEDIA[medium].from} so their grades can be checked. ${MEDIA[medium].untrusted}
Return ONLY JSON {"students":[],"warnings":[]}, one entry per student in the order they appear: {name (Chinese name, or empty string), englishName (or empty string), className (the class as written, e.g. "11.3", or empty string), grade (integer 1–12, or null), ${MEDIA[medium].source('this student (e.g. the name cell)')}}.
Grades are for the ${academicYear}–${academicYear+1} school year. Convert the school's labels to numbers: 一年级…六年级 = 1–6, 初一/七年级 = 7, 初二 = 8, 初三 = 9, 高一 = 10, 高二 = 11, 高三 = 12, G10/Grade 10 = 10. When a heading, title or worksheet name gives the grade for a whole list, apply it to every student under it. Give grade only when the material states it or a heading implies it; never guess it from a class name. When the material says it is for another school year, add a warning.
Copy names exactly; never translate or romanize them. Never include teachers or staff. Ignore columns that are not identity, class or grade. Warn about unreadable or ambiguous rows; write warnings in the material's language.`;

/** `list()` returns the stored students as the student page shows them. */
export function installStudentCheck(app,{requireSystemAdmin,llm,timeZone,quota,list}){
 const currentYear=()=>inferAcademicYear(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
 app.get('/api/admin/students/check',requireSystemAdmin,(req,res)=>{let configured=true;try{connection(llm);}catch{configured=false;}res.json({configured,academicYear:currentYear()});});
 // The reference comes as one multipart form of materials and workbooks, with the list's school year.
 app.post('/api/admin/students/check',requireSystemAdmin,express.raw({type:'multipart/form-data',limit:UPLOAD_LIMIT}),async(req,res)=>{
  let materials;
  try{materials=await readMaterials(req);}catch(error){return res.status(error.status||422).json({error:error.message});}
  const year=z.coerce.number().int().min(2000).max(2199).optional().safeParse(materials.fields.academicYear||undefined);
  if(!year.success)return res.status(422).json({error:'请填写名单所属学年。'});
  const academicYear=year.data??currentYear();
  let prepared;
  try{prepared=await materialsRequest(materials,{instruction:medium=>checkInstruction({academicYear,medium}),timeout:180000,idle:180000,empty:'工作簿没有可读取的文字名单。'});}catch(error){return res.status(422).json({error:error.message});}
  const refused=quota.take(req,'extract');if(refused)return res.status(429).json(refused);
  await respond(req,res,async progress=>{
   connection(llm);
   if(prepared.source)progress.source(prepared.source);
   const result=lenientList(await generate(llm,prepared.request,progress),'students',rowSchema,MAX_ROWS);
   progress.stage('validating');
   const compared=compareStudents(result.list,list(),academicYear);
   return {academicYear,items:compared.items,warnings:[...result.warnings,...compared.warnings],invalid:result.invalid};
  },error=>error.name==='TimeoutError'?'识别超时，请减少材料后重试。':error instanceof z.ZodError||error instanceof SyntaxError?'模型返回格式不正确，请重试。':/^(LLM Worker|请配置|模型)/.test(error.message||'')?error.message:'无法连接 LLM Worker，请检查环境配置或稍后重试。');
 });
}
