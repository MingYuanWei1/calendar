import {z} from 'zod';
import {sourceSchema} from './exam-extract.mjs';
import {MEDIA} from './materials.mjs';
import {inferAcademicYear,gradeNumber,namePinyin} from './students.mjs';

// 核验学生信息: the model only reads the administrator's reference (a class list, roster, screenshot or workbook) into
// rows; matching each row to a student and comparing name, English name, class, cohort and email happens here, so the
// verdict never rests on the model. Only a system administrator may use it, as on the students page.
const rowSchema=z.object({name:z.string().max(80).nullish(),englishName:z.string().max(120).nullish(),className:z.string().max(60).nullish(),grade:z.union([z.number(),z.string().max(30)]).nullish(),email:z.string().max(200).nullish(),source:sourceSchema});
const norm=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
// "11.3", "11-3" and "G11 3" name the same class, so only a real difference is proposed as a change.
const classKey=value=>String(value||'').toUpperCase().replace(/^GRADE\s*/,'').replace(/^G(?=\d)/,'').replace(/[\s.\-_·/]/g,'');
const sameClass=(a,b)=>classKey(a)===classKey(b);
const pick=({id,version,name,englishName,className,graduationYear,pinyin,actualEmail,email})=>({id,version,name,englishName,className,graduationYear,pinyin,actualEmail,email});
// The students page's edit form: every editable field with the record's version.
const editable=s=>({version:s.version,name:s.name||'',englishName:s.englishName||'',className:s.className||'',graduationYear:s.graduationYear??null,pinyin:s.pinyin||'',actualEmail:s.actualEmail||''});

/**
 * Compares reference rows with the stored students for `academicYear`. Rows are matched by email when they give one,
 * else by name (namesakes narrowed by English name, class and cohort; whatever is still tied is left to the
 * administrator). Each fact the row gives is compared; a field it leaves out is never judged. Students the reference
 * leaves out are listed as extra only within the classes and cohorts it covers, and never deleted here: they have
 * exam history.
 */
export function compareStudents(rows,students,academicYear){
 const items=[],warnings=[],matched=new Set(),classes=new Set(),years=new Set();
 rows.forEach((row,index)=>{
  const name=row.name?.trim()||'',englishName=row.englishName?.trim()||'',className=row.className?.trim()||'',email=norm(row.email);
  if(!name&&!englishName&&!email){if(row.source?.quote)warnings.push(`“${row.source.quote}”没有姓名，已跳过。`);return;}
  const grade=gradeNumber(row.grade)||gradeNumber(className);
  const expected=grade?academicYear+1+12-grade:null;
  if(className)classes.add(classKey(className));
  if(expected)years.add(expected);
  const byEmail=email?students.filter(s=>norm(s.email)===email||norm(s.actualEmail)===email):[];
  let found=byEmail.length?byEmail:students.filter(s=>name?s.name===name:englishName?norm(s.englishName)===norm(englishName):false);
  const narrow=test=>{const kept=found.filter(test);if(kept.length)found=kept;};
  if(found.length>1&&name&&englishName)narrow(s=>norm(s.englishName)===norm(englishName));
  if(found.length>1&&className)narrow(s=>sameClass(s.className,className));
  if(found.length>1&&expected)narrow(s=>s.graduationYear===expected);
  const base={key:`r${index}`,row:{name,englishName,className,grade,email},expected,source:row.source||null,changes:[],apply:null};
  if(!found.length)return items.push({...base,status:'missing',student:null});
  if(found.length>1)return items.push({...base,status:'ambiguous',student:null,candidates:found.map(pick)});
  const student=found[0],changes=[],fields={};
  matched.add(student.id);
  const change=(field,from,to,values)=>{changes.push({field,from,to});fields[field]=values;};
  if(expected&&student.graduationYear!==expected)change('graduationYear',student.graduationYear,expected,{graduationYear:expected});
  if(className&&!sameClass(student.className,className))change('className',student.className||'',className,{className});
  // A row found by email or English name may still spell the Chinese name differently.
  if(name&&student.name!==name)change('name',student.name||'',name,{name,pinyin:namePinyin(name)||student.pinyin||''});
  if(englishName&&norm(student.englishName)!==norm(englishName))change('englishName',student.englishName||'',englishName,{englishName});
  if(email&&norm(student.email)!==email)change('email',student.email||'',email,{actualEmail:email});
  const checked=expected||className||email||(englishName&&name);
  items.push({...base,student:pick(student),changes,status:changes.length?'mismatch':checked?'ok':'noValue',
   apply:changes.length?{method:'PATCH',path:`/admin/students/${encodeURIComponent(student.id)}`,body:editable(student),fields}:null});
 });
 if(classes.size||years.size)for(const student of students){
  if(matched.has(student.id))continue;
  if(classes.size&&!classes.has(classKey(student.className)))continue;
  if(years.size&&!years.has(student.graduationYear))continue;
  items.push({key:`s:${student.id}`,status:'extra',row:null,expected:null,source:null,student:pick(student),changes:[],apply:null});
 }
 return {items,warnings};
}

/** `medium` is 'materials' (pasted text, images, PDF pages) or 'xlsx' (worksheet cells). */
export const checkInstruction=({academicYear,medium='materials'})=>`You read a school's reference list of students (a class list, roster, spreadsheet or document) from ${MEDIA[medium].from} so the student records can be checked. ${MEDIA[medium].untrusted}
Return ONLY JSON {"rows":[],"warnings":[]}, one entry per student in the order they appear: {name (Chinese name, or empty string), englishName (or empty string), className (the class as written, e.g. "11.3", or empty string), grade (integer 1–12, or null), email (the student's email address as written, or empty string), ${MEDIA[medium].source('this student (e.g. the name cell)')}}.
Grades are for the ${academicYear}–${academicYear+1} school year. Convert the school's labels to numbers: 一年级…六年级 = 1–6, 初一/七年级 = 7, 初二 = 8, 初三 = 9, 高一 = 10, 高二 = 11, 高三 = 12, G10/Grade 10 = 10. When a heading, title or worksheet name gives the grade for a whole list, apply it to every student under it. Give grade only when the material states it or a heading implies it; never guess it from a class name. When the material says it is for another school year, add a warning.
Copy names and emails exactly; never translate, romanize or invent them. Never include teachers or staff. Ignore columns that are not identity, class, grade or email. Warn about unreadable or ambiguous rows; write warnings in the material's language.`;

/** `list()` returns the stored students as the student page shows them. */
export function registerStudentCheck(checks,{isSystemAdmin,timeZone,list}){
 const currentYear=()=>inferAcademicYear(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
 checks.register('students',{scope:()=>'students',allowed:isSystemAdmin,row:rowSchema,empty:'工作簿没有可读取的文字名单。',
  options(fields){
   const year=z.coerce.number().int().min(2000).max(2199).optional().safeParse(fields.academicYear||undefined);
   if(!year.success)throw new Error('请填写名单所属学年。');
   return {academicYear:year.data??currentYear()};
  },
  instruction:(medium,scope,{academicYear})=>checkInstruction({academicYear,medium}),
  compare:(rows,scope,{academicYear})=>({...compareStudents(rows,list(),academicYear),meta:{academicYear}})});
 // 自检: the students page's own 待核实 rules, for those who may see students.
 checks.selfCheck(req=>isSystemAdmin(req)?list().filter(s=>s.issues.length).map(s=>({area:'students',message:`${s.name||s.englishName||s.id}：${s.issues.join('；')}`,link:`#students?${new URLSearchParams({q:s.name||s.englishName||s.id,issues:'1'})}`})):[]);
 return {currentYear};
}
