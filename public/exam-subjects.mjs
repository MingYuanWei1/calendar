export const presetSubjects=[
 ['数学','Mathematics'],['中文','Chinese'],['英语','English'],['哲学','Philosophy'],['心理','Psychology'],['历史','History'],['物理','Physics'],['化学','Chemistry'],['生物','Biology'],['计算机','Computer Science'],['经济','Economics'],['商管','Business Management']
].map(([name,english],i)=>({name,english,hue:i*30}));
const aliases={'计算机科学':'计算机','商务管理':'商管','心理学':'心理'};
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
