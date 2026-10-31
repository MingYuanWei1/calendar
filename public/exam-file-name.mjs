import {gradeLabel} from './grades.mjs';
/**
 * The exam schedule PDF's file name, by export scope:
 *  mine   → <email handle>-<zh|en>-<series>.pdf, e.g. xiaoming-en-Autumn Midterms.pdf
 *  grades → G10_G11-<zh|en>-<series>.pdf (a file name cannot hold "/", so grades join with "_")
 *  all    → <zh|en>-<series>.pdf
 */
export function examPdfName(batch,{scope='all',grades=[],email='',english=false}={}){
 const clean=value=>String(value||'').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'-').trim();
 const series=english?(batch.titleEn||batch.title):batch.title;
 const who=scope==='mine'?clean(String(email||'').split('@')[0]):scope==='grades'?[...new Set(grades)].sort((a,b)=>a-b).map(g=>gradeLabel(g,1)).join('_'):'';
 return [who,english?'en':'zh',clean(series)].filter(Boolean).join('-')+'.pdf';
}
