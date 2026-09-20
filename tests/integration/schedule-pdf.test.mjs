import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {vectorSchedulePdf,schedulePdfSchema} from '../../server/schedule-pdf.mjs';
test('schedule PDF embeds searchable Chinese and English text across vector pages',async()=>{
 const text='中文 Non-DP · Computer Science 1 · 15:40–17:10';
 const page={width:1540,height:800,items:[{kind:'box',x:10,y:10,width:600,height:90,radius:7,color:[230,235,250]},{kind:'text',text,x:20,y:20,width:580,height:20,size:14,bold:true,color:[36,55,70]}]};
 const parsed=schedulePdfSchema.parse({pages:[page,{...page,height:1400}]});
 const buffer=await vectorSchedulePdf(parsed.pages);assert.equal(buffer.subarray(0,5).toString(),'%PDF-');assert.ok(!buffer.includes(Buffer.from('/Subtype /Image')));
 const task=getDocument({data:new Uint8Array(buffer),useSystemFonts:false});
 try{const pdf=await task.promise;assert.equal(pdf.numPages,2);for(let i=1;i<=2;i++){const p=await pdf.getPage(i);const content=await p.getTextContent();assert.equal(content.items.map(x=>x.str||'').join(''),text);}}
 finally{await task.destroy();}
 assert.equal(schedulePdfSchema.safeParse({pages:[{...page,width:0}]}).success,false);
 assert.equal(schedulePdfSchema.safeParse({pages:[{...page,items:[{...page.items[1],size:10000}]}]}).success,false);
});
test('dense timetable generation avoids repeated WOFF decompression',async()=>{
 const items=Array.from({length:600},(_,i)=>({kind:'text',text:['数学','Computer Science 1','08:10–09:40','G12','示例教室 2101'][i%5],x:20+(i%5)*280,y:20+Math.floor(i/5)*15,width:150,height:18,size:12,bold:i%2===0,color:[36,55,70]}));
 const start=performance.now();const pdf=await vectorSchedulePdf([{width:1540,height:2000,items}]);
 assert.ok(performance.now()-start<1500,'600 text runs should not spend seconds repeatedly inflating font tables');
 assert.ok(pdf.length>1000);
});
