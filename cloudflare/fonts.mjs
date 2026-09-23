import {env} from 'cloudflare:workers';
import {uncompressedWoff} from '../server/pdf-font.mjs';
export const pdfFonts={regular:'/vendor/exam-font-regular.woff',bold:'/vendor/exam-font-bold.woff'};
export async function getFontData(){
  const entries=await Promise.all(Object.entries(pdfFonts).map(async([name,path])=>{
    const request=new Request(new URL(path,env.APP_ORIGIN));
    const response=env.ASSETS?await env.ASSETS.fetch(request):await fetch(request);
    if(!response.ok)throw new Error('PDF font unavailable');
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength>2*1024*1024)throw new Error('PDF font exceeds size limit');
    return [name,uncompressedWoff(Buffer.from(bytes))];
  }));
  return Object.fromEntries(entries);
}
