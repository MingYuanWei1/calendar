/**
 * The exam schedule PDF's file name: exam-schedule-<email handle>-<zh|en>-<series name>.pdf, e.g.
 * exam-schedule-xiaoming-en-Autumn Midterms.pdf. The handle is left out when nobody with an email is signed in.
 */
export function examPdfName(batch,{email='',english=false}={}){
 const clean=value=>String(value||'').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'-').trim();
 const series=english?(batch.titleEn||batch.title):batch.title;
 return ['exam-schedule',clean(email.split('@')[0]),english?'en':'zh',clean(series)].filter(Boolean).join('-')+'.pdf';
}
