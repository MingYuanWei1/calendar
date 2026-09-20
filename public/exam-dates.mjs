// Short series stay together even across a weekend; longer series page by calendar week.
export function examDatePages(sessions){
 const days=[...new Set(sessions.map(s=>s.date))].sort();
 if(!days.length)return [];
 if(days.length<=5)return [days];
 const weeks=new Map();
 for(const day of days){
  const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
  const key=d.toISOString().slice(0,10);
  if(!weeks.has(key))weeks.set(key,[]);
  weeks.get(key).push(day);
 }
 return [...weeks.values()];
}
