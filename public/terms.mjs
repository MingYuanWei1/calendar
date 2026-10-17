// 学期与周次: each term numbers Monday–Sunday weeks from the week holding its first day. Holiday weeks still
// count, so a week's number never shifts when a day plan changes. Odd weeks are 单周, even weeks 双周.
const DAY=86400000;
const time=iso=>Date.parse(iso+'T00:00:00Z');
const toIso=ms=>new Date(ms).toISOString().slice(0,10);
/** The Monday of the week holding a civil date. */
export const mondayOf=iso=>{const ms=time(iso);return toIso(ms-((new Date(ms).getUTCDay()+6)%7)*DAY);};

/**
 * The term week a date falls in, or null outside every term. A week belongs to a term when any of its seven days
 * lies within the term; should a week touch two terms, the later term (the one just starting) wins.
 * @param {{id:string,name:[string,string],start:string,end:string}[]} terms
 * @param {string} iso
 */
export function termWeek(terms,iso){
  const monday=mondayOf(iso),sunday=toIso(time(monday)+6*DAY);
  const term=terms.filter(t=>t.start<=sunday&&t.end>=monday).sort((a,b)=>b.start.localeCompare(a.start))[0];
  if(!term)return null;
  const week=Math.round((time(monday)-time(mondayOf(term.start)))/(7*DAY))+1;
  return {term,week,odd:week%2===1,monday};
}

/** Every week of a term, first to last. */
export function termWeeks(term){
  const weeks=[];
  for(let monday=mondayOf(term.start),week=1;monday<=term.end;monday=toIso(time(monday)+7*DAY),week++)
    weeks.push({week,odd:week%2===1,monday,sunday:toIso(time(monday)+6*DAY)});
  return weeks;
}

/** "第 6 周 · 单周" / "Week 6 · Odd". */
export const weekLabel=(info,lang=0)=>lang?`Week ${info.week} · ${info.odd?'Odd':'Even'}`:`第 ${info.week} 周 · ${info.odd?'单周':'双周'}`;
/** The short parity under W6 in a month row. */
export const parityLabel=(info,lang=0)=>lang?(info.odd?'Odd':'Even'):(info.odd?'单':'双');
