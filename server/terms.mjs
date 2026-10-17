import {termSchema} from './validation.mjs';
import {randomUUID} from 'node:crypto';

// 学期: the date ranges whose weeks the calendar numbers (see public/terms.mjs). Saving takes effect at once,
// like day plans; each term carries a version so two admins cannot silently overwrite each other.
const MAX_TERMS=40;
export function installTerms(app,db,{requireAdmin}){
  db.exec('CREATE TABLE IF NOT EXISTS terms(id TEXT PRIMARY KEY,version INTEGER NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,name TEXT NOT NULL)');
  const list=()=>db.prepare('SELECT id,version,start_date AS start,end_date AS "end",name FROM terms ORDER BY start_date').all().map(row=>({...row,name:JSON.parse(row.name)}));
  const overlapping=(term,id)=>list().find(other=>other.id!==id&&other.start<=term.end&&other.end>=term.start);
  // The term to save, or null once a 422 has been sent.
  const accept=(res,body,id)=>{
    const parsed=termSchema.safeParse(body);
    if(!parsed.success){res.status(422).json({error:'请填写学期名称，并选择有效的起止日期（不超过 366 天）。'});return null;}
    const clash=overlapping(parsed.data,id);
    if(clash){res.status(422).json({error:`与学期“${clash.name[0]||clash.name[1]}”（${clash.start} 至 ${clash.end}）的日期重叠。`});return null;}
    return parsed.data;
  };
  app.get('/api/terms',(req,res)=>res.json(list()));
  app.post('/api/admin/terms',requireAdmin,(req,res)=>{
    const term=accept(res,req.body);if(!term)return;
    if(list().length>=MAX_TERMS)return res.status(422).json({error:`最多保存 ${MAX_TERMS} 个学期，请先删除不再需要的旧学期。`});
    const id=randomUUID();
    db.prepare('INSERT INTO terms VALUES(?,1,?,?,?)').run(id,term.start,term.end,JSON.stringify(term.name));
    res.status(201).json(list().find(t=>t.id===id));
  });
  app.put('/api/admin/terms/:id',requireAdmin,(req,res)=>{
    const current=db.prepare('SELECT version FROM terms WHERE id=?').get(req.params.id);
    if(!current)return res.status(404).json({error:'该学期已被删除。'});
    const term=accept(res,req.body,req.params.id);if(!term)return;
    if(term.version!==current.version)return res.status(409).json({error:'该学期已在其他窗口更新，请刷新后再编辑。',code:'CONFLICT'});
    db.prepare('UPDATE terms SET version=?,start_date=?,end_date=?,name=? WHERE id=?').run(current.version+1,term.start,term.end,JSON.stringify(term.name),req.params.id);
    res.json(list().find(t=>t.id===req.params.id));
  });
  app.delete('/api/admin/terms/:id',requireAdmin,(req,res)=>{
    db.prepare('DELETE FROM terms WHERE id=?').run(req.params.id);res.status(204).end();
  });
  return {list};
}
