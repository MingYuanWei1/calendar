// 学部与年级: grades are numbered 1–12; each division covers a fixed range of them.
// An audience is a set of divisions plus, optionally, some of their grades. A division with none of its
// grades listed (or all of them) means the whole division.
// Shared by the server (validation, exams, feeds), the public calendar and the admin console.

export const DIVISION_GRADES={primary:[1,2,3,4,5,6],middle:[7,8,9],high:[10,11,12]};
export const divisionOf=grade=>Object.keys(DIVISION_GRADES).find(d=>DIVISION_GRADES[d].includes(grade));

/** "10年级" (lang 0) or "G10" (lang 1). */
export const gradeLabel=(grade,lang=0)=>lang?`G${grade}`:`${grade}年级`;

const CHINESE={一:1,二:2,三:3,四:4,五:5,六:6};
/**
 * The grade number a school's own label stands for: 10, "G10", "Grade 10", "10年级", "高一", "初二",
 * "三年级", "10.3" (a class) or "高2027级"-style labels are not grades and give null.
 */
export function parseGrade(label){
 if(Number.isInteger(label))return label>=1&&label<=12?label:null;
 const text=String(label??'').trim().replace(/\s+/g,'');
 let match=text.match(/^(?:G|Grade|Y|Year)?(\d{1,2})(?:年级)?$/i);
 if(match){const n=Number(match[1]);return n>=1&&n<=12?n:null;}
 match=text.match(/^([初高])([一二三])(?:年级)?$/);
 if(match)return (match[1]==='初'?6:9)+CHINESE[match[2]];
 match=text.match(/^(?:小学)?([一二三四五六])年级$/);
 return match?CHINESE[match[1]]:null;
}

/** Keeps only grades of the chosen divisions and drops a division's grades when all of them are chosen. */
export function normalizeGrades(scope,grades=[]){
 const kept=[...new Set(grades)].filter(g=>scope.includes(divisionOf(g))).sort((a,b)=>a-b);
 return kept.filter(g=>!DIVISION_GRADES[divisionOf(g)].every(x=>kept.includes(x)));
}

/** Every grade an audience reaches; school-wide reaches all twelve. */
export function audienceGrades(scope,grades=[]){
 if(scope.includes('schoolwide'))return Object.values(DIVISION_GRADES).flat();
 return scope.flatMap(d=>{const own=(DIVISION_GRADES[d]||[]).filter(g=>grades.includes(g));return own.length?own:DIVISION_GRADES[d]||[];});
}

/** The audience in words, e.g. ["初中部 · 8年级", "高中部"]; `names` maps a scope key to its name. */
export function audienceParts(scope,grades=[],names,lang=0){
 return scope.map(d=>{
  const own=(DIVISION_GRADES[d]||[]).filter(g=>grades.includes(g));
  return own.length?`${names(d)} · ${own.map(g=>gradeLabel(g,lang)).join(lang?', ':'、')}`:names(d);
 });
}
