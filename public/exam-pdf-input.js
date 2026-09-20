export async function readExamPdf(file,onProgress=(message)=>{}){
 if(!file||!file.name.toLowerCase().endsWith('.pdf'))throw new Error('请上传 PDF 格式的考试日程表。');
 if(file.size>20*1024*1024)throw new Error('PDF 不能超过 20 MB。');
 const moduleUrl='/vendor/pdfjs/build/pdf.mjs';
 const pdfjs=await import(moduleUrl);pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/build/pdf.worker.mjs';
 const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/'});
 try{
  const pdf=await task.promise;if(pdf.numPages>10)throw new Error('单次最多提取 10 页，请拆分 PDF 后上传。');
  const images=[],texts=[];let total=0;
  for(let i=1;i<=pdf.numPages;i++){
   onProgress(`正在读取 PDF：${i}/${pdf.numPages} 页…`);
   const page=await pdf.getPage(i),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,1800/Math.max(base.width,base.height))});
   const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
   await page.render({canvas,viewport}).promise;
   const image=canvas.toDataURL('image/jpeg',.85);total+=image.length;if(total>14000000)throw new Error('PDF 页面内容过大，请分成更小的文件。');images.push(image);
   const text=await page.getTextContent();texts.push(`Page ${i}: `+text.items.map(item=>'str' in item?item.str:'').join(' '));canvas.width=0;canvas.height=0;
  }
  return {images,text:texts.join('\n').slice(0,30000)};
 }catch(error){if(error.name==='PasswordException')throw new Error('请先解除 PDF 密码保护后上传。');if(error.name==='InvalidPDFException')throw new Error('PDF 无法读取，请检查文件是否完整。');throw error;}finally{await task.destroy();}
}
