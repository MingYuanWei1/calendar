import {z} from 'zod';

// 学校规则: the school-specific part of AI exam extraction. The general instruction covers what every school
// shares (output shape, sources, never inventing facts); a school's own course naming lives here, so the same
// product serves another school by choosing or editing a template instead of changing code.
// `curriculum` also switches on the matching code-level clean-up of course names after extraction.
export const templates={
 ib:{
  name:['国际学校（IB 课程）','International school (IB)'],
  curriculum:'ib',
  subjects:[],
  rules:`- Grades are written G6–G12. Split HL/SL into separate sessions, retaining their own times and rooms.
- Chinese DP subjects: Chinese A (two distinct directions: Literature; Language & Literature), Chinese B, Chinese ab initio. All may have HL/SL: preserve the source HL/SL, never assume a level or reject ab initio HL. Map subject to 中文 A / 中文 B / 中文 ab initio and subjectEn to Chinese A / Chinese B / Chinese ab initio. For Chinese A, retain the direction in title AND in the displayed level (Literature HL, Literature SL, Language & Literature HL, Language & Literature SL) so directions remain distinguishable within the subject card.
- English DP subjects: English A and English B, both with source HL/SL; subject 英语 A or 英语 B, subjectEn English A or English B, level HL/SL.
- G10 Chinese has three course variants under subject 中文 (Chinese): Honor, Basic, Chinese B. Chinese Language and Literature has level Honor if there is NO Basic suffix; with Basic suffix level Basic. G10 Chinese B has title/titleEn/level "Chinese B" and subject 中文, subjectEn Chinese; do not classify it as the DP 中文 B subject or invent HL/SL. It is NOT Chinese A by default. The DP Chinese B subject remains separate for other grades.
- G10 Advanced / Intermediate / Standard Comprehensive English are all subject 英语 (English), NOT English A/B. Their title AND level for timetable display MUST be ACE / ICE / SCE respectively.
- G10 Pre-Calculus (Basic/Core/Advanced) is subject 数学 (Mathematics), level Basic/Core/Advanced exactly as specified. Title Mathematics Basic/Core/Advanced; do not create a Pre-Calculus subject or infer a missing level.
- G11/G12 Mathematics has three distinct tracks: AA, AI, AI经管. All belong to subject 数学, subjectEn Mathematics. Preserve the track in level and title: level AA / AI / AI经管, title Mathematics AA / Mathematics AI / Mathematics AI经管. If explicitly present in the source, append HL/SL to the track (e.g. AA HL, AI SL, AI经管 SL); never invent HL/SL. Keep AI经管 distinct from AI and do not classify it as Economics or Business Management. A standalone AA/AI/AI经管 course label in the mathematics context uses this same rule. Do not apply these tracks to G10 or confuse AI in other subjects with Mathematics.
- EXCEPTION with highest priority: G11 Chinese Language and Literature Advanced and G12 Chinese Language and Literature Extended are a separate course named 中文 Non-DP. Use subject/title="中文 Non-DP", subjectEn/titleEn="Chinese Non-DP", level Advanced for the G11 course and Extended for the G12 course. Keep their original grades and separate sessions. Never merge them into 中文 / 中文 A / 中文 B, and never rename them Chinese 2 / Chinese 3. This exception overrides the general non-dp numbering rule below.
- For other courses explicitly marked non-dp (case-insensitive, including non dp/non-DP), use the parent subject and number by grade: G10 => Course 1, G11 => Course 2, G12 => Course 3 (e.g. Physics non-dp G11 => subject 物理, subjectEn Physics, title and level Physics 2). Do not retain non-dp as its own subject or level. Missing/ambiguous grade requires warning, never guess. This rule applies to every other subject and takes priority over DP track naming.`
 },
 general:{
  name:['普通高中（新高考）','Public high school (gaokao)'],
  curriculum:null,
  subjects:[['语文','Chinese'],['思想政治','Politics'],['地理','Geography']],
  rules:`- Every exam belongs to division high. 高一 / 高二 / 高三 (also written G10 / G11 / G12, or 高2027级-style labels when the source makes it clear) are grades 10 / 11 / 12.
- Subjects: 语文 (Chinese), 数学 (Mathematics), 英语 (English), 物理 (Physics), 化学 (Chemistry), 生物 (Biology), 思想政治 (Politics), 历史 (History), 地理 (Geography). 政治 means 思想政治; 语文 is never 中文.
- A course marked 选考 or 等级考 has level 选考 (English: Elective); marked 学考 or 合格考 has level 学考 (English: Proficiency); otherwise leave level empty. Title is the subject followed by the level in full-width brackets when there is one, e.g. 物理（选考）; titleEn likewise, e.g. Physics (Elective).
- 物理类 / 历史类 streams are not subjects: mention the stream in note when the source limits a session to one stream.
- Combined papers such as 理综 or 文综 stay one session unless the source gives each subject its own time.`
 }
};

const schema=z.object({template:z.enum(Object.keys(templates)),rules:z.string().trim().max(6000)});

export function installSchoolRules(app,db,{requireAdmin,subjects}){
 db.exec('CREATE TABLE IF NOT EXISTS school_rules(id INTEGER PRIMARY KEY CHECK(id=1),template TEXT NOT NULL,rules TEXT NOT NULL)');
 /** The rules in force; a school that never chose one uses the IB template. */
 const get=()=>{
  const row=db.prepare('SELECT template,rules FROM school_rules WHERE id=1').get();
  const template=row&&templates[row.template]?row.template:'ib';
  return {template,rules:row?row.rules:templates[template].rules,curriculum:templates[template].curriculum};
 };
 const set=({template,rules})=>{
  db.prepare('INSERT INTO school_rules VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET template=excluded.template,rules=excluded.rules').run(template,rules);
  // A template's own subjects join the catalog so its courses get stable names and colours.
  subjects.register(templates[template].subjects.map(([subject,subjectEn])=>({subject,subjectEn})));
 };
 const catalog=()=>Object.fromEntries(Object.entries(templates).map(([id,t])=>[id,{name:t.name,rules:t.rules,curriculum:t.curriculum}]));
 app.get('/api/admin/school-rules',requireAdmin,(req,res)=>res.json({...get(),templates:catalog()}));
 app.put('/api/admin/school-rules',requireAdmin,(req,res)=>{
  const parsed=schema.safeParse(req.body);
  if(!parsed.success)return res.status(422).json({error:'请选择学校模板，规则最多 6000 字。'});
  set(parsed.data);res.json({...get(),templates:catalog()});
 });
 return {get,set};
}
