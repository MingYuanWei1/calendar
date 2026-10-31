// Shared by integration tests that send materials and follow extraction jobs.

/** The multipart form the console sends: materials and settings as JSON, plus each workbook ({name, buffer}). */
export function materialsForm({parts=[],workbooks=[]}={},fields={}){
 const form=new FormData();
 form.append('materials',JSON.stringify({...fields,parts}));
 for(const {name,buffer} of workbooks)form.append('workbook',new Blob([buffer]),name);
 return form;
}

/** One pasted text material. */
export const pasted=text=>({parts:[{kind:'text',text}]});

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
/**
 * Starts a job of `kind` for `batch` and waits for it to end. Resolves with {response} when it was refused, else
 * {job, status, result, partial, events} once it is done, failed or cancelled.
 */
export async function runJob(base,cookie,kind,batch,form){
 const headers={Origin:'http://calendar.test',Cookie:cookie};
 const response=await fetch(`${base}/admin/extract-jobs/${kind}?batch=${encodeURIComponent(batch)}`,{method:'POST',headers,body:form});
 if(response.status!==201)return {response};
 return followJob(base,cookie,(await response.json()).id);
}
export async function followJob(base,cookie,id){
 const headers={Origin:'http://calendar.test',Cookie:cookie};
 for(let tries=0;tries<500;tries++){
  const page=await (await fetch(`${base}/admin/extract-jobs/${id}/events`,{headers})).json();
  if(page.job.status!=='running'){
   const {result,partial}=await (await fetch(`${base}/admin/extract-jobs/${id}/result`,{headers})).json();
   return {job:page.job,status:page.job.status,result,partial,events:page.events};
  }
  await sleep(10);
 }
 throw new Error('job did not end');
}
