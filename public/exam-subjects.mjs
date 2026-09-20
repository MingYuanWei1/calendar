export const presetSubjects=[
 ['数学','Mathematics'],['中文','Chinese'],['英语','English'],['哲学','Philosophy'],['心理','Psychology'],['历史','History'],['物理','Physics'],['化学','Chemistry'],['生物','Biology'],['计算机','Computer Science'],['经济','Economics'],['商管','Business Management'],
 ['中文 A','Chinese A'],['中文 B','Chinese B'],['中文 ab initio','Chinese ab initio'],['英语 A','English A'],['英语 B','English B'],['中文 Non-DP','Chinese Non-DP']
].map(([name,english],i)=>({name,english,hue:i<12?i*30:(i-12)*30+15}));
const aliases={'语文Non-DP':'中文 Non-DP','计算机科学':'计算机','商务管理':'商管','心理学':'心理'};
export function subjectName(exam,subjects){
 const raw=exam.subject?.trim();
 const match=subjects.find(s=>s.name===raw||s.name===aliases[raw]||s.english.toLowerCase()===raw?.toLowerCase());
 if(match)return match.name;
 if(raw)return raw;
 return subjects.find(s=>[s.name,s.english,...Object.keys(aliases).filter(a=>aliases[a]===s.name)].some(n=>n&&(exam.title||'').toLowerCase().includes(n.toLowerCase())))?.name||exam.title||exam.id;
}
// Allocate the midpoint of the largest unused hue gap; existing subjects never change color.
export function nextHue(subjects){
 if(!subjects.length)return 260;
 const hues=subjects.map(s=>s.hue).sort((a,b)=>a-b);
 let gap=-1,hue=0;
 hues.forEach((v,i)=>{const end=hues[i+1]??hues[0]+360;if(end-v>gap){gap=end-v;hue=(v+gap/2)%360;}});
 return hue;
}
export function subjectColors(sessions,subjects){
 const colors=new Map(subjects.map(s=>[s.name,s.hue]));
 for(const name of [...new Set(sessions.map(s=>subjectName(s,subjects)))].sort())if(!colors.has(name))colors.set(name,nextHue([...colors].map(([name,hue])=>({name,hue}))));
 return exam=>{const hue=colors.get(subjectName(exam,subjects));return `--exam-bg:hsl(${hue} 55% 95%);--exam-border:hsl(${hue} 27% 50%);--exam-line:hsl(${hue} 30% 82%);--exam-selected:hsl(${hue} 48% 88%);--exam-ink:hsl(${hue} 36% 32%)`;};
}

// Course numbers belong to a subject, never to the subject catalog itself.
export function normalizeCourse(exam,subjects=presetSubjects){
 const clean=value=>(value||'').trim().replace(/^\[[^\]]*\]\s*/,'');
 const raw=[exam.title,exam.titleEn,exam.subject,exam.subjectEn,exam.level].filter(Boolean).join(' ').replace(/[_–—]/g,'-');
 const grade=(exam.grades||[]).length===1?exam.grades[0]:'';
 const named=(name,english,level,title)=>({...exam,subject:name,subjectEn:english,level,title,titleEn:title});
 const chineseNonDPLevel={G11:'Advanced',G12:'Extended'}[grade];
 if(chineseNonDPLevel&&(/(?:语文|中文)\s*Non[ -]?DP|\bChinese\s+Non[ -]?DP\b/i.test(raw)||(/\bChinese\s+Language\s*(?:and|&)\s*Literature\b/i.test(raw)&&new RegExp(`\\b${chineseNonDPLevel}\\b`,'i').test(raw)))){
  return {...named('中文 Non-DP','Chinese Non-DP',chineseNonDPLevel,'中文 Non-DP'),titleEn:'Chinese Non-DP'};
 }
 if(/\bnon[ -]?dp\b/i.test(raw)){
  const number={G10:1,G11:2,G12:3}[grade];
  const parent=subjects.find(s=>[s.english,s.name].filter(Boolean).some(label=>raw.toLowerCase().includes(label.toLowerCase())));
  if(number&&parent)return named(parent.name,parent.english,`${parent.english||parent.name} ${number}`,`${parent.english||parent.name} ${number}`);
  return exam;
 }
 if(grade==='G10'){
  if(/\bChinese\s+B\b/i.test(raw)||/中文\s*B\b/i.test(raw))return named('中文','Chinese','Chinese B','Chinese B');
  const comprehensive=raw.match(/\b(Advanced|Intermediate|Standard)\s+Comprehensive\s+English\b/i);
  const abbreviation=raw.match(/\b(ACE|ICE|SCE)\b/i);
  if(comprehensive||abbreviation){const level=comprehensive?({advanced:'ACE',intermediate:'ICE',standard:'SCE'}[comprehensive[1].toLowerCase()]):abbreviation[1].toUpperCase();return named('英语','English',level,level);}
  if(/\bChinese\s+Language\s*(?:and|&)\s*Literature\b/i.test(raw)){
   const level=/\bBasic\b/i.test(raw)?'Basic':'Honor';return named('中文','Chinese',level,`Chinese Language and Literature ${level}`);
  }
  if(/\bPre[ -]?Calculus\b/i.test(raw)){
   const level=raw.match(/\b(Basic|Core|Advanced)\b/i)?.[1];
   if(level){const canonical=level[0].toUpperCase()+level.slice(1).toLowerCase();return named('数学','Mathematics',canonical,`Mathematics ${canonical}`);}
   return {...exam,subject:'数学',subjectEn:'Mathematics'};
  }
 }
 if(['G11','G12'].includes(grade)&&(/数学|\b(?:Maths?|Mathematics)\b/i.test(raw)||/^(?:AA|AI)(?:\s*经管)?(?:\s+(?:HL|SL))?$/i.test(clean(exam.title)))){
  const track=/\bAI\s*经管/i.test(raw)?'AI经管':raw.match(/\b(AA|AI)\b/i)?.[1].toUpperCase();
  if(track){const hlSl=raw.match(/\b(HL|SL)\b/i)?.[1].toUpperCase();const level=[track,hlSl].filter(Boolean).join(' ');return named('数学','Mathematics',level,`Mathematics ${level}`);}
 }
 const language=raw.match(/\b(Chinese|English)\s+(ab\s+initio|A|B)\b/i);
 if(language){
  const chinese=language[1].toLowerCase()==='chinese',track=/ab/i.test(language[2])?'ab initio':language[2].toUpperCase();
  if(!chinese&&track==='ab initio')return exam;
  const english=`${chinese?'Chinese':'English'} ${track}`,name=`${chinese?'中文':'英语'} ${track}`;
  const hlSl=raw.match(/\b(HL|SL)\b/i)?.[1].toUpperCase()||'';
  const direction=chinese&&track==='A'?(/Language\s*(?:and|&)\s*Literature/i.test(raw)?'Language & Literature':/\bLiterature\b/i.test(raw)?'Literature':''):'';
  return named(name,english,[direction,hlSl].filter(Boolean).join(' '),[english,direction,hlSl].filter(Boolean).join(' '));
 }
 const candidates=[clean(exam.title),clean(exam.titleEn),clean(exam.subject)];
 let match,number;
 for(const subject of subjects){
  for(const label of [subject.name,subject.english].filter(Boolean)){
   for(const text of candidates){
    if(!text.toLowerCase().startsWith(label.toLowerCase()))continue;
    const suffix=text.slice(label.length).trim();
    if(/^\d+$/.test(suffix)){match=subject;number=suffix;break;}
   }
   if(match)break;
  }
  if(match)break;
 }
 if(!match){
  const subject=subjects.find(s=>s.name===exam.subject||s.english.toLowerCase()===(exam.subject||'').toLowerCase());
  const numeric=[clean(exam.level),clean(exam.title)].find(s=>/^\d+$/.test(s));
  if(subject&&numeric){match=subject;number=numeric;}
 }
 if(!match)return exam;
 const course=`${match.english||match.name} ${number}`;
 return {...exam,subject:match.name,subjectEn:match.english,title:course,titleEn:course,level:course};
}
