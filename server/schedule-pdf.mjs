import PDFDocument from 'pdfkit';
import {getFontData} from './font-data.mjs';
export {pdfFonts} from './font-data.mjs';
import {z} from 'zod';
const number=z.number().finite().min(0).max(50000),rgb=z.tuple([z.number().int().min(0).max(255),z.number().int().min(0).max(255),z.number().int().min(0).max(255)]);
const position={x:number,y:number,width:number,height:number,color:rgb};
export const schedulePdfSchema=z.object({pages:z.array(z.object({width:number.min(320).max(5000),height:number.min(20).max(20000),items:z.array(z.discriminatedUnion('kind',[
 z.object({kind:z.literal('box'),...position,radius:number}),
 z.object({kind:z.literal('text'),...position,text:z.string().max(2000),size:z.number().positive().max(100),bold:z.boolean()})
])).max(15000)})).min(1).max(50)});
export async function vectorSchedulePdf(pages){
 const fontData=await getFontData();
 const doc=new PDFDocument({autoFirstPage:false,compress:true,info:{Title:'Exam schedule'}}),chunks=[];
 const result=new Promise((resolve,reject)=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.registerFont('regular',fontData.regular);doc.registerFont('bold',fontData.bold);
 for(const page of pages){
  const width=1190.55,margin=28.35,scale=(width-2*margin)/page.width;
  doc.addPage({size:[width,Math.max(841.89,page.height*scale+2*margin)],margin:0});
  doc.save().translate(margin,margin).scale(scale);
  for(const item of page.items){
   doc.fillColor(item.color);
   if(item.kind==='box'){
    if(item.radius)doc.roundedRect(item.x,item.y,item.width,item.height,Math.min(item.radius,item.width/2,item.height/2)).fill();
    else doc.rect(item.x,item.y,item.width,item.height).fill();
   }else{
    doc.font(item.bold?'bold':'regular').fontSize(item.size);
    // The browser uses these same embedded fonts; compensate tiny metric differences.
    const measured=doc.widthOfString(item.text),horizontalScaling=measured?item.width/measured*100:100;
    doc.text(item.text,item.x,item.y,{lineBreak:false,baseline:'top',horizontalScaling});
   }
  }
  doc.restore();
 }
 doc.end();return result;
}
