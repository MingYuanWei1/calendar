import {z} from 'zod';
import {presetSubjects,nextHue,subjectName} from '../public/exam-subjects.mjs';
export function installSubjects(app,db,requireAdmin){
 db.exec('CREATE TABLE IF NOT EXISTS exam_subjects(name TEXT PRIMARY KEY,english TEXT NOT NULL,hue REAL NOT NULL UNIQUE)');
 const insert=db.prepare('INSERT OR IGNORE INTO exam_subjects VALUES(?,?,?)');
 for(const s of presetSubjects)insert.run(s.name,s.english,s.hue);
 const list=()=>db.prepare('SELECT name,english,hue FROM exam_subjects ORDER BY rowid').all();
 const schema=z.object({name:z.string().trim().min(1).max(100),english:z.string().trim().max(100).default('')});
 const register=sessions=>{for(const s of sessions){if(!s.subject)continue;const subjects=list(),name=subjectName(s,subjects);if(!subjects.some(s=>s.name===name))insert.run(name,s.subjectEn||'',nextHue(subjects));}};
 app.get('/api/exam-subjects',(req,res)=>res.json(list()));
 app.post('/api/admin/exam-subjects',requireAdmin,(req,res)=>{
  const parsed=schema.safeParse(req.body);if(!parsed.success)return res.status(422).json({error:'请填写有效的学科名称（最多 100 字）。'});
  const s=parsed.data,subjects=list();
  if(subjects.some(x=>x.name.toLowerCase()===s.name.toLowerCase()||(s.english&&x.english.toLowerCase()===s.english.toLowerCase())))return res.status(409).json({error:'该学科已存在。'});
  insert.run(s.name,s.english,nextHue(subjects));res.status(201).json(list());
 });
 app.put('/api/admin/exam-subjects',requireAdmin,(req,res)=>{
  const parsed=schema.safeParse(req.body);if(!parsed.success)return res.status(422).json({error:'学科信息无效。'});
  const s=parsed.data;
  if(!list().some(x=>x.name===s.name))return res.status(404).json({error:'学科不存在。'});
  if(s.english&&list().some(x=>x.name!==s.name&&x.english.toLowerCase()===s.english.toLowerCase()))return res.status(409).json({error:'英文名称重复。'});
  db.prepare('UPDATE exam_subjects SET english=? WHERE name=?').run(s.english,s.name);res.json(list());
 });
 return {list,register};
}
