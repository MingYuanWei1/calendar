// 核验: an administrator gives a complete reference (a roster, the official timetable or seating plan, the school
// calendar) and it is compared with what is stored, both ways. The model only reads the reference into rows, as an
// extraction job (kind `check-<kind>`); comparing them happens here, each time the result is opened or applied, so
// changes made while the job ran — or corrections already applied — always show as they are now.
//
// A kind's `compare(rows, scope, options)` returns {items, warnings?, meta?}. Each item has a key that stays the same
// from one comparison to the next, a status (STATUSES), the reference row, the stored record, its `changes`
// [{field, from, to}] and how to apply them: `apply` describes a request to the record's own API (with its version,
// so an edit made elsewhere conflicts instead of being overwritten), or is true when the kind applies chosen items
// itself (`apply(scope, items, options)`, e.g. one update of an exam draft).
//
// 自检 (`selfCheck(fn)`) needs no reference: each `fn(req)` returns the problems it finds in the stored data.
import {z} from 'zod';
import {lenientList} from './llm-stream.mjs';
import {materialsRequest} from './materials.mjs';

export const STATUSES=['mismatch','missing','extra','ambiguous','noValue','ok'];
const failure=error=>error.name==='TimeoutError'?'识别超时，请减少材料后重试。':error instanceof z.ZodError||error instanceof SyntaxError?'模型返回格式不正确，请重试。':/^(LLM Worker|请配置|模型|请|仅|Excel|最多|表格|工作簿)/.test(error.message||'')?error.message:'无法连接 LLM Worker，请检查环境配置或稍后重试。';

/**
 * A kind: {scope(req) → scope|null, missing, allowed?(req), options?(fields) → settings, instruction(medium, scope,
 * options) → the system prompt (its answer is {"<key>":[],"warnings":[]}, key 'rows' unless the kind names one),
 * row (zod schema), max?, context?(scope, options) → what normalize needs, normalize?(context, row), empty, compare,
 * apply?}.
 */
export function installChecks(app,{requireAdmin,jobs}){
 const kinds={},self=[];
 function register(kind,spec){
  const key=spec.key||'rows';
  kinds[kind]={...spec,key};
  const read=(context,list)=>list.map(row=>spec.normalize?spec.normalize(context,row):row);
  jobs.register(`check-${kind}`,{scope:spec.scope,missing:spec.missing,allowed:spec.allowed,itemKey:key,failure,
   options:fields=>spec.options?.(fields)??{},
   async prepare(materials,scope,options){
    const {request,source}=await materialsRequest(materials,{instruction:medium=>spec.instruction(medium,scope,options),timeout:180000,idle:180000,empty:spec.empty});
    return {request,...(source?{source}:{}),context:spec.context?spec.context(scope,options):{}};
   },
   finish(context,raw){const {list,warnings,invalid}=lenientList(raw,key,spec.row,spec.max||1500);return {[key]:read(context,list),warnings,invalid};},
   salvage(context,list){
    const rows=(Array.isArray(list)?list:[]).flatMap(row=>{const parsed=spec.row.safeParse(row);return parsed.success?[parsed.data]:[];});
    return rows.length?{[key]:read(context,rows),warnings:[]}:null;
   }});
 }
 // A check job's stored rows (a finished result, or what a failed job had read) with its kind.
 const load=(req,res)=>{
  const found=jobs.read(req,req.params.id),spec=found?.kind.startsWith('check-')&&kinds[found.kind.slice(6)];
  if(!spec){res.status(404).json({error:'核验任务不存在或已过期。'});return null;}
  const stored=found.result||found.partial;
  if(!stored){res.status(409).json({error:'核验尚未完成。'});return null;}
  return {...found,spec,stored,options:found.options||{}};
 };
 const compare=found=>found.spec.compare(found.stored[found.spec.key],found.scope,found.options);
 app.get('/api/admin/checks/self',requireAdmin,(req,res)=>res.json({issues:self.flatMap(fn=>fn(req))}));
 app.get('/api/admin/checks/:id',requireAdmin,(req,res)=>{
  const found=load(req,res);if(!found)return;
  let compared;
  try{compared=compare(found);}catch(error){return res.status(error.status||422).json({error:error.message});}
  res.json({job:found.job,scope:found.scope,options:found.options,partial:!found.result,items:compared.items,warnings:[...(found.stored.warnings||[]),...(compared.warnings||[])],invalid:found.stored.invalid||[],...compared.meta});
 });
 app.post('/api/admin/checks/:id/apply',requireAdmin,(req,res)=>{
  const found=load(req,res);if(!found)return;
  if(!found.spec.apply)return res.sendStatus(404);
  const keys=z.array(z.string().max(200)).max(5000).safeParse(req.body?.keys);
  if(!keys.success)return res.status(422).json({error:'请至少勾选一项。'});
  let chosen;
  try{chosen=compare(found).items.filter(item=>item.apply&&keys.data.includes(item.key));}catch(error){return res.status(error.status||422).json({error:error.message});}
  // Items that need nothing any more (applied elsewhere meanwhile) simply drop out.
  if(!chosen.length)return res.status(422).json({error:'勾选的项目已无需修正，请刷新结果。'});
  try{res.json({applied:chosen.map(item=>item.key),...found.spec.apply(found.scope,chosen,found.options)});}
  catch(error){res.status(error.status||422).json({error:error.message});}
 });
 return {register,selfCheck:fn=>{self.push(fn);}};
}
