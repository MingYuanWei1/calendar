import {env} from 'cloudflare:workers';
import {uncompressedWoff} from '../server/pdf-font.mjs';
export const pdfFonts={regular:'/vendor/exam-font-regular.woff',bold:'/vendor/exam-font-bold.woff',brand:'/vendor/exam-font-brand.woff',script:'/vendor/exam-font-script.woff'};
async function asset(path){
  const request=new Request(new URL(path,env.APP_ORIGIN));
  const response=env.ASSETS?await env.ASSETS.fetch(request):await fetch(request);
  if(!response.ok)throw new Error('PDF asset unavailable');
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength>2*1024*1024)throw new Error('PDF asset exceeds size limit');
  return Buffer.from(bytes);
}
export async function getFontData(){
  const [fonts,logo]=await Promise.all([
    Promise.all(Object.entries(pdfFonts).map(async([name,path])=>[name,uncompressedWoff(await asset(path))])),
    asset('/logo.png')
  ]);
  return {...Object.fromEntries(fonts),logo};
}
