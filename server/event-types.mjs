import {z} from 'zod';
import {randomBytes} from 'node:crypto';

// 事件类型: the school's own list of event categories and the colour each is drawn in.
// 考试 (exam batches), 活动 (the fallback) and 截止日 (the deadline time format) carry meaning in code,
// so they can be renamed and recoloured but never deleted.
export const FIXED_TYPES=['exam','activity','deadline'];
export const DEFAULT_TYPES=[
 {id:'exam',name:['考试','Exam'],color:'#7055a2'},
 {id:'competition',name:['比赛','Competition'],color:'#b56e1c'},
 {id:'activity',name:['活动','Activity'],color:'#3265a8'},
 {id:'deadline',name:['截止日','Deadline'],color:'#b24c55'}
];
const label=z.string().trim().max(20);
const schema=z.object({name:z.tuple([label,label]).refine(([zh,en])=>zh||en),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value=>value.toLowerCase())});

export function installEventTypes(app,db,{requireAdmin}){
 db.exec('CREATE TABLE IF NOT EXISTS event_types(id TEXT PRIMARY KEY,name TEXT NOT NULL,color TEXT NOT NULL,position INTEGER NOT NULL)');
 if(!db.prepare('SELECT COUNT(*) AS n FROM event_types').get().n)DEFAULT_TYPES.forEach((t,i)=>db.prepare('INSERT INTO event_types VALUES(?,?,?,?)').run(t.id,JSON.stringify(t.name),t.color,i));
 const list=()=>db.prepare('SELECT id,name,color FROM event_types ORDER BY position,id').all().map(row=>({...row,name:JSON.parse(row.name),fixed:FIXED_TYPES.includes(row.id)}));
 const has=id=>Boolean(db.prepare('SELECT 1 FROM event_types WHERE id=?').get(id));
 /** A name already used by another type in either language, ignoring case. */
 const taken=(name,except)=>list().some(t=>t.id!==except&&name.some((part,i)=>part&&part.toLowerCase()===t.name[i].toLowerCase()));
 const invalid=res=>res.status(422).json({error:'请填写类型名称（最多 20 字）并选择颜色。'});
 app.get('/api/event-types',(req,res)=>res.json(list()));
 app.post('/api/admin/event-types',requireAdmin,(req,res)=>{
  const parsed=schema.safeParse(req.body);if(!parsed.success)return invalid(res);
  const {name,color}=parsed.data;
  if(taken(name))return res.status(409).json({error:'已有同名的事件类型。'});
  const position=(db.prepare('SELECT MAX(position) AS n FROM event_types').get().n??-1)+1;
  db.prepare('INSERT INTO event_types VALUES(?,?,?,?)').run('t'+randomBytes(4).toString('hex'),JSON.stringify(name),color,position);
  res.status(201).json(list());
 });
 app.put('/api/admin/event-types/:id',requireAdmin,(req,res)=>{
  if(!has(req.params.id))return res.status(404).json({error:'事件类型不存在。'});
  const parsed=schema.safeParse(req.body);if(!parsed.success)return invalid(res);
  const {name,color}=parsed.data;
  if(taken(name,req.params.id))return res.status(409).json({error:'已有同名的事件类型。'});
  db.prepare('UPDATE event_types SET name=?,color=? WHERE id=?').run(JSON.stringify(name),color,req.params.id);
  res.json(list());
 });
 // Events of a deleted type become 活动, school events and 个人事件 alike, so none is left without a type.
 app.delete('/api/admin/event-types/:id',requireAdmin,(req,res)=>{
  const id=req.params.id;
  if(!has(id))return res.status(404).json({error:'事件类型不存在。'});
  if(FIXED_TYPES.includes(id))return res.status(422).json({error:'考试、活动和截止日是系统类型，只能修改名称和颜色。'});
  const now=new Date().toISOString(),moved=db.prepare("SELECT COUNT(*) AS n FROM events WHERE json_extract(body,'$.type')=?").get(id).n;
  db.transactionSync(()=>{
   for(const table of ['events','personal_events'])db.prepare(`UPDATE ${table} SET version=version+1,body=json_set(body,'$.type','activity','$.version',version+1,'$.updatedAt',?) WHERE json_extract(body,'$.type')=?`).run(now,id);
   db.prepare('DELETE FROM event_types WHERE id=?').run(id);
  });
  res.json({types:list(),moved});
 });
 return {list,has};
}
