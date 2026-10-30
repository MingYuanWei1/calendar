// 材料输入框: a text box for pasted text plus screenshots, photos and PDFs (dropped, chosen or pasted), shared by
// 从通知生成日程, LLM 提取考试场次 and LLM 提取座位表. Each material gets a number — pasted text first, then each
// image and each PDF page — that the model cites as source.page and the review's source pane is keyed by.
import {esc,T,toast,fail} from './console-core.js';
import {readExamPdf} from './exam-pdf-input.js';
import {pagePane,textPane,stackPane} from './ai-review.js';

export const MAX_MATERIALS=12;
const isXlsx=file=>/\.xlsx$/i.test(file.name);

/** Downscales an image file to a JPEG data URL (long side ≤ 1800 px), like the PDF page renders. */
export async function imageData(file){
 const bitmap=await createImageBitmap(file),scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
 const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
 canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 return canvas.toDataURL('image/jpeg',.85);
}

/** The box's markup. With `xlsx`, one .xlsx workbook may be chosen instead of the other materials. */
export function materialFields({placeholder,drop,label,xlsx=false}){
 const accept=`image/png,image/jpeg,image/webp,.pdf,application/pdf${xlsx?',.xlsx':''}`;
 return `<textarea class="input" rows="7" data-text placeholder="${esc(placeholder)}" aria-label="${esc(label)}"></textarea>
 <label class="dropzone" data-drop><span>${esc(drop)}</span><input type="file" multiple accept="${accept}" aria-label="${esc(label)}"></label>
 <div class="list-box" data-files hidden></div>`;
}

/** The source pane for materials already read, e.g. a job's stored input. */
export const materialPane=parts=>stackPane(parts.map((part,i)=>part.kind==='text'
 ?textPane(part.text,{page:i+1,label:T(`材料 ${i+1} · 粘贴的文字`,`Material ${i+1} · Pasted text`)})
 :pagePane([{image:part.image,items:part.items||[]}],{first:i+1,label:n=>T(`材料 ${n}`,`Material ${n}`)})));

/**
 * Wires the box inside `body`. `collect(progress)` reads everything into {parts, pane, name}, or {xlsx} when a
 * workbook was chosen; it fails when nothing was given.
 * @param {any} body
 * @param {{xlsx?:boolean,onChange?:(state:{xlsx:File|null})=>void}} [options]
 */
export function bindMaterials(body,{xlsx=false,onChange=_=>{}}={}){
 let files=[];
 const text=/** @type {HTMLTextAreaElement} */(body.querySelector('[data-text]')),zone=body.querySelector('[data-drop]'),list=body.querySelector('[data-files]');
 const workbook=()=>files.find(isXlsx)||null;
 const sync=()=>{
  list.hidden=!files.length;
  list.innerHTML=files.map((f,i)=>`<div><span>${esc(f.name)}</span><button type="button" class="btn btn-ghost" data-remove="${i}">${T('移除','Remove')}</button></div>`).join('');
  // A workbook is read on its own, so the text box is set aside while one is chosen.
  text.disabled=Boolean(workbook());
  onChange({xlsx:workbook()});
 };
 const add=chosen=>{
  for(const file of chosen){
   const supported=/^image\/(png|jpeg|webp)$/.test(file.type)||/\.pdf$/i.test(file.name)||(xlsx&&isXlsx(file));
   if(!supported){toast(T(`不支持的文件：${file.name}`,`Unsupported file: ${file.name}`),{bad:true});continue;}
   if(file.size>20*1024*1024){toast(T(`${file.name} 超过 20 MB。`,`${file.name} is larger than 20 MB.`),{bad:true});continue;}
   if(isXlsx(file)?files.length||text.value.trim():workbook()){toast(T('Excel 工作簿需单独提取，不能与文字、图片或 PDF 一起使用。','An Excel workbook is extracted on its own, not together with text, images or PDFs.'),{bad:true});continue;}
   files.push(file);
  }
  sync();
 };
 zone.querySelector('input').onchange=e=>{add([...e.target.files]);e.target.value='';};
 zone.ondragover=e=>{e.preventDefault();zone.classList.add('over');};zone.ondragleave=()=>zone.classList.remove('over');
 zone.ondrop=e=>{e.preventDefault();zone.classList.remove('over');add([...e.dataTransfer.files]);};
 // A copied screenshot pastes as a file, anywhere in the dialog. Copied web content can carry text and an
 // image together: the text still lands in the box and the image is added beside it.
 let pastedImages=0;
 body.addEventListener('paste',event=>{
  const images=[...event.clipboardData?.files||[]].filter(file=>file.type.startsWith('image/'));
  if(!images.length)return;
  if(!event.clipboardData.getData('text/plain'))event.preventDefault();
  const before=files.length;
  add(images.map(file=>{
   const n=++pastedImages,extension=file.type==='image/jpeg'?'jpg':file.type.slice(6);
   return new File([file],T(`粘贴的图片 ${n}`,`Pasted image ${n}`)+'.'+extension,{type:file.type});
  }));
  const added=files.length-before;
  if(added)toast(T(`已加入 ${added} 张粘贴的图片。`,`Added ${added} pasted image${added===1?'':'s'}.`));
 });
 list.onclick=e=>{const button=e.target.closest('[data-remove]');if(button){files.splice(Number(button.dataset.remove),1);sync();}};
 /** @param {(message:string)=>void} [progress] @returns {Promise<{xlsx?:File,parts?:any[],pane?:any,name?:string}>} */
 async function collect(progress=_=>{}){
  const book=workbook();if(book)return {xlsx:book};
  const pasted=text.value.trim();
  if(!pasted&&!files.length)fail(T('请粘贴文字或添加文件。','Paste some text or add a file.'));
  /** @type {any[]} */
  const parts=[],panes=[];
  if(pasted){parts.push({kind:'text',text:pasted});panes.push(textPane(pasted,{page:1,label:T('材料 1 · 粘贴的文字','Material 1 · Pasted text')}));}
  try{
   for(const file of files){
    const first=parts.length+1;
    if(/\.pdf$/i.test(file.name)){
     const pdf=await readExamPdf(file,message=>progress(`${file.name} · ${message}`));
     pdf.pages.forEach(page=>parts.push({kind:'image',image:page.image,text:page.items.map(item=>item.str).join(' ').slice(0,20000),items:page.items}));
     panes.push(pagePane(pdf.pages,{first,label:n=>T(`材料 ${n} · ${file.name} 第 ${n-first+1} 页`,`Material ${n} · ${file.name} p.${n-first+1}`)}));
    }else{
     progress(T(`正在读取 ${file.name}…`,`Reading ${file.name}…`));
     const image=await imageData(file);parts.push({kind:'image',image,text:''});
     panes.push(pagePane([{image,items:[]}],{first,label:n=>T(`材料 ${n} · ${file.name}`,`Material ${n} · ${file.name}`)}));
    }
    if(parts.length>MAX_MATERIALS)fail(T(`最多 ${MAX_MATERIALS} 份材料（PDF 每页算一份），请减少文件。`,`At most ${MAX_MATERIALS} materials (each PDF page counts); remove some files.`));
   }
  }finally{progress('');}
  const name=files.length===1&&!pasted?files[0].name:files.length?T(`${files.length+(pasted?1:0)} 份材料`,`${files.length+(pasted?1:0)} materials`):T('粘贴的文字','Pasted text');
  return {parts,pane:stackPane(panes),name};
 }
 return {collect};
}
