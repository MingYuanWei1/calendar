import {DIVISION_GRADES,audienceGrades,divisionOf} from './grades.mjs';

// 校历筛选: which events pass the 适用学部 and 事件类型 filters, shared by the calendar page and the
// filtered subscription links (?hide=<type ids>&grades=<grades>). School-wide and 个人事件 always pass.
// Shared by the server (feeds) and the public calendar.

/** Whether an event reaches any of the shown grades; no shown grades (null) means no division filter. */
export function audienceMatches(event,shown){
 if(!shown||event.personal||event.scope?.includes('schoolwide'))return true;
 return audienceGrades(event.scope||[],event.grades).some(g=>shown.includes(g));
}

/** A link's filters: the hidden type ids and the shown grades (null when the link names no valid grade). */
export function readFeedFilter(query){
 const list=value=>String(value??'').split(',').map(s=>s.trim()).filter(Boolean);
 const grades=[...new Set(list(query.grades).map(Number).filter(g=>divisionOf(g)))].sort((a,b)=>a-b);
 return {hide:new Set(list(query.hide)),grades:grades.length?grades:null};
}

/** Whether an event belongs in a filtered feed; 个人事件 are never filtered out. */
export function feedMatches(event,{hide,grades}){
 return Boolean(event.personal)||!hide.has(event.type)&&audienceMatches(event,grades);
}

/** The query string for a link's filters, e.g. "hide=deadline&grades=10,11"; empty when nothing is filtered. */
export function feedQuery({hide=[],grades=null}={}){
 const params=[];
 if(hide.length)params.push('hide='+hide.map(encodeURIComponent).join(','));
 if(grades?.length)params.push('grades='+grades.join(','));
 return params.join('&');
}

const SHORT={primary:'PS',middle:'MS',high:'HS'};
/** The shown grades in short, the same in both languages: "HS", "HS G10-11", "PS G1-2, G4", "MS, HS G10". */
export function gradesSummary(grades){
 return Object.entries(DIVISION_GRADES).flatMap(([d,all])=>{
  const own=all.filter(g=>grades.includes(g));
  if(!own.length)return [];
  if(own.length===all.length)return [SHORT[d]];
  const runs=[];
  for(const g of own){const last=runs.at(-1);if(last&&last[1]===g-1)last[1]=g;else runs.push([g,g]);}
  return [`${SHORT[d]} ${runs.map(([a,b])=>a===b?`G${a}`:`G${a}-${b}`).join(', ')}`];
 }).join(', ');
}
