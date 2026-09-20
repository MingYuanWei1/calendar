let fontsReady;
export function prepareExamPdf(){
 return fontsReady??=Promise.all([document.fonts.load('14px ExamPdf'),document.fonts.load('700 14px ExamPdf')]).catch(error=>{fontsReady=null;throw error;});
}
// Capture the table's layout, not a bitmap: PDF text stays selectable/searchable.
function color(value){
 const match=value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
 return match&&Number(match[4]??1)>0?match.slice(1,4).map(Number):null;
}
function layout(panel){
 const origin=panel.getBoundingClientRect(),items=[];
 const visit=element=>{
  const style=getComputedStyle(element),rect=element.getBoundingClientRect();
  if(style.display==='none'||style.visibility==='hidden'||!rect.width||!rect.height)return;
  const x=rect.x-origin.x,y=rect.y-origin.y,fill=color(style.backgroundColor);
  if(fill)items.push({kind:'box',x,y,width:rect.width,height:rect.height,color:fill,radius:parseFloat(style.borderTopLeftRadius)||0});
  for(const [edge,bx,by,w,h] of [['Top',x,y,rect.width,parseFloat(style.borderTopWidth)],['Bottom',x,y+rect.height-parseFloat(style.borderBottomWidth),rect.width,parseFloat(style.borderBottomWidth)],['Left',x,y,parseFloat(style.borderLeftWidth),rect.height],['Right',x+rect.width-parseFloat(style.borderRightWidth),y,parseFloat(style.borderRightWidth),rect.height]]){
   const border=color(style['border'+edge+'Color']);if(border&&w&&h&&style['border'+edge+'Style']!=='none')items.push({kind:'box',x:bx,y:by,width:w,height:h,color:border,radius:0});
  }
  for(const child of element.childNodes){
   if(child.nodeType===Node.ELEMENT_NODE){visit(child);continue;}
   if(child.nodeType!==Node.TEXT_NODE||!child.textContent.trim())continue;
   const range=document.createRange();range.selectNodeContents(child);
   if(range.getClientRects().length===1){
    const r=range.getBoundingClientRect();items.push({kind:'text',text:child.textContent,x:r.x-origin.x,y:r.y-origin.y,width:r.width,height:r.height,size:parseFloat(style.fontSize),bold:Number(style.fontWeight)>=600,color:color(style.color)||[36,55,70]});continue;
   }
   let line=null;
   for(let i=0;i<child.textContent.length;){
    const char=String.fromCodePoint(child.textContent.codePointAt(i));range.setStart(child,i);i+=char.length;range.setEnd(child,i);const r=range.getBoundingClientRect();if(!r.width)continue;
    if(!line||Math.abs(line.y-(r.y-origin.y))>1){line={kind:'text',text:'',x:r.x-origin.x,y:r.y-origin.y,width:0,height:r.height,size:parseFloat(style.fontSize),bold:Number(style.fontWeight)>=600,color:color(style.color)||[36,55,70]};items.push(line);}
    line.text+=char;line.width=r.right-origin.x-line.x;
   }
  }
 };
 visit(panel);return {width:origin.width,height:origin.height,items};
}
export async function downloadExamView(filename,panels=[document.querySelector('.schedule-panel')],onProgress=(_stage)=>{}){
 onProgress('fonts');await prepareExamPdf();
 onProgress('layout');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const host=document.createElement('div');host.className='pdf-export-host pdf-vector-export';host.setAttribute('aria-hidden','true');document.body.append(host);
 try{
  const pages=panels.map(panel=>{
   const clone=/** @type {HTMLElement} */(panel.cloneNode(true));host.append(clone);clone.querySelectorAll('input[type=checkbox]').forEach(input=>input.remove());
   return layout(clone);
  });
  onProgress('generate');
  const response=await fetch('/api/exam-schedule-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pages})});
  if(!response.ok)throw new Error('PDF export failed');
  const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }finally{host.remove();}
}
