// Render the same table DOM, including current filters, week, levels and palettes.
export async function downloadExamView(filename,panels=[document.querySelector('.schedule-panel')]){
 const {html2canvas,jspdf}=/** @type {any} */(window);
 if(!html2canvas||!jspdf)throw new Error('PDF libraries are unavailable');
 await document.fonts.ready;
 let pdf;
 for(const [index,panel] of panels.entries()){
 const exportId='pdf-export-page-'+index;panel.setAttribute('data-export-id',exportId);
 const table=/** @type {HTMLElement} */(panel.querySelector('.exam-time-grid'));
 const width=Math.ceil(table.scrollWidth+2);
 // Expand both axes in the isolated clone so off-screen dates and slots are included.
 const canvas=await html2canvas(panel,{
  scale:2,backgroundColor:'#ffffff',logging:false,windowWidth:Math.max(innerWidth,width+240),
  onclone:doc=>{
   doc.querySelector('link[href="exams-print.css"]').setAttribute('media','all');
   const clone=/** @type {HTMLElement} */(doc.querySelector(`[data-export-id="${exportId}"]`));
   doc.body.replaceChildren(clone);
   clone.style.width=width+'px';
   clone.querySelectorAll('input[type=checkbox]').forEach(input=>input.remove());
  }
 });
 // Keep a complete week on one sheet; grow the sheet for unusually dense weeks.
 const pageWidth=420,margin=10,contentWidth=pageWidth-2*margin;
 const contentHeight=canvas.height/canvas.width*contentWidth;
 const pageHeight=Math.max(297,contentHeight+2*margin);
 const orientation=pageWidth>=pageHeight?'landscape':'portrait';
 if(!pdf)pdf=new jspdf.jsPDF({orientation,unit:'mm',format:[pageWidth,pageHeight],compress:true});
 else pdf.addPage([pageWidth,pageHeight],orientation);
 pdf.addImage(canvas,'PNG',margin,margin,contentWidth,contentHeight,undefined,'FAST');
 panel.removeAttribute('data-export-id');
 }
 pdf.save(filename);
}
