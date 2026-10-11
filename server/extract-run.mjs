// 提取任务的执行流程 (see docs/adr/0001-background-extraction-jobs.md). Shared by the in-process runner on Node and
// the Cloudflare Workflow: both call the job's `ops` (directly, or through the school's Durable Object) and differ
// only in how a step is retried. Imports nothing that needs the application database.
import {generate,retryable,INVALID} from './llm-stream.mjs';

const FLUSH_MS=1000,HEARTBEAT_MS=10000;
/** The error fields `ops.fail` needs to explain a failure to the administrator. */
export const describeError=error=>({name:error?.name||'Error',message:String(error?.message||''),status:error?.status});
// The parsed answer carries its malformed items under a Symbol, which does not survive JSON.
export const packAnswer=raw=>({...raw,__invalid:raw?.[INVALID]||[]});
export const unpackAnswer=packed=>{const {__invalid,...raw}=packed||{};return Object.assign(raw,{[INVALID]:__invalid||[]});};

/**
 * Collects progress messages and hands them to `record` at most once a second, and at least every ten seconds as a
 * heartbeat. `record` answers {stop:true} once the job was cancelled; the model request is then aborted.
 */
function progressSink(record,controller){
 let pending=[],flushing=Promise.resolve(),timer=null;
 const flush=()=>{
  clearTimeout(timer);timer=null;
  const batch=pending;pending=[];
  flushing=flushing.then(()=>record(batch)).then(answer=>{if(answer?.stop)controller.abort();}).catch(()=>{});
  return flushing;
 };
 const push=message=>{pending.push(message);if(!timer)timer=setTimeout(flush,FLUSH_MS);};
 const heartbeat=setInterval(flush,HEARTBEAT_MS);
 return {
  progress:{
   stage:(stage,detail={})=>push({type:'stage',stage,...detail}),
   item:(key,index,item)=>push({type:'item',key,index,item}),
   invalid:entry=>push({type:'invalid',...entry}),
   reset:()=>push({type:'reset'}),
   text(){},source(){}
  },
  close(){clearInterval(heartbeat);return flush();}
 };
}

/**
 * Runs one attempt of an extraction job. `step(name, retries, fn)` runs and retries a step: a local loop on Node, a
 * Workflow step on Cloudflare. The model call is retried once, and only for a network error or a 5xx; every other
 * failure is recorded on the job straight away.
 */
export async function runExtraction({jobId,run,ops,config,step}){
 try{
  const generated=await step('generate',1,async()=>{
   const begun=await ops.begin(jobId,run);if(!begun)return false;
   const controller=new AbortController(),sink=progressSink(events=>ops.record(jobId,run,events),controller);
   try{
    const raw=await generate(config,begun.request,sink.progress,controller.signal);
    await sink.close();
    await ops.generated(jobId,run,packAnswer(raw));
    return true;
   }catch(error){
    await sink.close();
    if(error.name==='AbortError')return false;
    if(retryable(error)&&begun.attempt<2)throw error;
    await ops.fail(jobId,run,describeError(error),error.items||null);
    return false;
   }
  });
  if(generated)await step('finalize',3,()=>ops.finalize(jobId,run));
 }catch(error){await ops.fail(jobId,run,describeError(error),error.items||null);}
}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** Node: steps run in this process, retried after a short pause. */
export const localStep=(pause=2000)=>async(name,retries,fn)=>{
 for(let tries=0;;tries++){
  try{return await fn();}
  catch(error){if(tries>=retries)throw error;await sleep(pause);}
 }
};
