// Redirects are never followed (Workers support only "manual"); a 3xx counts as a failed request.
// Connection to the LLM Worker (an OpenAI-compatible gateway) shared by every AI feature.
export function connection(config){
 let url;try{url=new URL(config.url);}catch{throw new Error('请配置 .env 中的 LLM_WORKER_URL 和 LLM_WORKER_TOKEN，并重启服务。');}
 const local=url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(!config.token||(!local&&url.protocol!=='https:')||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('请配置 LLM_WORKER_URL（Worker 域名）和 LLM_WORKER_TOKEN。');
 return url.origin+'/v1';
}
// A gateway hiccup (network error, 429 or 5xx) is retried up to RETRY.times times, pausing longer each time.
export const RETRY={times:10,pause:tries=>Math.min(1000*2**tries,8000)};
const transient=status=>status===429||status>=500;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const failed=status=>new Error(`LLM Worker 请求失败（${status}）${transient(status)?`，已自动重试 ${RETRY.times} 次`:''}，请检查配置或稍后重试。`);
export async function worker(config,path,body,timeout){
 let response;
 for(let tries=0;;tries++){
  try{response=await fetch(connection(config)+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(timeout)});}
  catch(error){if(tries>=RETRY.times)throw error;await sleep(RETRY.pause(tries));continue;}
  if(tries>=RETRY.times||!transient(response.status))break;
  await response.body?.cancel();await sleep(RETRY.pause(tries));
 }
 if(!response.ok)throw failed(response.status);
 const reader=response.body.getReader();let bytes=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1024*1024){await reader.cancel();throw new Error('模型返回内容过大，请缩小提取范围。');}chunks.push(value);}
 return JSON.parse(Buffer.concat(chunks).toString());
}

// Streams a chat completion from the LLM Worker, calling onText with each text delta.
// A Worker that ignores `stream` and answers with plain JSON is accepted as a single delta.
// `timeout` bounds the wait for the first token; once the model is writing, only a silence longer than
// `idle` (IDLE_TIMEOUT by default) aborts, so long but steady outputs are never cut off midway.
// `onRetry(attempt, status)` reports each retry of a failing gateway; status is null for a network error.
const IDLE_TIMEOUT=45000;
export async function streamChat(config,body,timeout,onText,idle=IDLE_TIMEOUT,onRetry=()=>{}){
 const url=connection(config)+'/chat/completions',controller=new AbortController();
 let timer;
 const arm=ms=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),ms);};
 const alive=()=>arm(idle);
 try{return await read();}
 catch(error){if(controller.signal.aborted){const timedOut=new Error('timeout');timedOut.name='TimeoutError';throw timedOut;}throw error;}
 finally{clearTimeout(timer);}
 async function read(){
 const request=payload=>fetch(url,{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({...payload,stream:true}),redirect:'manual',signal:controller.signal});
 // Low reasoning effort cuts the silent wait before the first token from ~30 s to a few seconds;
 // a gateway that rejects the parameter is retried without it.
 // A gateway hiccup before any output is retried (see RETRY); each attempt gets the full first-token timeout.
 const attempt=async payload=>{
  for(let tries=0;;tries++){
   arm(timeout);
   try{
    const response=await request(payload);
    if(tries>=RETRY.times||!transient(response.status))return response;
    await response.body?.cancel();
    onRetry(tries+1,response.status);
   }catch(error){if(tries>=RETRY.times||controller.signal.aborted)throw error;onRetry(tries+1,null);}
   clearTimeout(timer);await sleep(RETRY.pause(tries));
  }
 };
 let response=await attempt({reasoning_effort:'low',...body});
 if(response.status===400&&!('reasoning_effort' in body)){await response.body?.cancel();response=await attempt(body);}
 if(!response.ok)throw failed(response.status);
 const reader=response.body.getReader(),decoder=new TextDecoder();
 let bytes=0,full='',buffer='';
 const emit=text=>{if(typeof text==='string'&&text){full+=text;onText(text);}};
 const plain=!(response.headers.get('content-type')||'').includes('text/event-stream');
 while(true){
  const {done,value}=await reader.read();if(done)break;
  alive();
  bytes+=value.length;if(bytes>4*1024*1024){await reader.cancel();throw new Error('模型返回内容过大，请缩小提取范围。');}
  buffer+=decoder.decode(value,{stream:true});
  if(plain)continue;
  let index;
  while((index=buffer.indexOf('\n'))>=0){
   const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);
   if(!line.startsWith('data:'))continue;
   const data=line.slice(5).trim();if(data==='[DONE]')continue;
   try{emit(JSON.parse(data).choices?.[0]?.delta?.content);}catch{}
  }
 }
 if(plain){
  try{emit(JSON.parse(buffer).choices?.[0]?.message?.content);}catch{throw new Error('模型未返回可解析的结果，请重试。');}
 }
 return full;
 }
}
export async function requireFlash(config){
 const capabilities=await worker(config,'/capabilities',null,5000);
 if(!capabilities.purposes?.flash?.enabled)throw new Error('LLM Worker 尚未启用 flash 能力。');
}

/** Emits each complete object inside top-level JSON arrays (e.g. {"sessions":[{…},{…}]}) as the text streams in. */
export function jsonItems(onItem){
 let inString=false,escaped=false,key='',lastString='',arrayKey='',start=-1,text='',position=0,capturing=false;
 const stack=[];
 return chunk=>{
  text+=chunk;
  for(;position<text.length;position++){
   const c=text[position];
   if(inString){
    if(escaped)escaped=false;
    else if(c==='\\')escaped=true;
    else if(c==='"'){inString=false;if(!capturing)lastString=key;}
    else if(!capturing)key+=c;
    continue;
   }
   if(c==='"'){inString=true;if(!capturing)key='';continue;}
   if(c==='{'||c==='['){
    if(c==='['&&stack.length===1&&stack[0]==='{')arrayKey=lastString;
    stack.push(c);
    if(c==='{'&&stack.length===3&&stack[1]==='['&&stack[0]==='{'){start=position;capturing=true;}
    continue;
   }
   if(c==='}'||c===']'){
    stack.pop();
    if(capturing&&stack.length===2){
     capturing=false;
     try{onItem(arrayKey,JSON.parse(text.slice(start,position+1)));}catch{}
    }
   }
  }
 };
}
export const stripFence=raw=>raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');

/** NDJSON responder: one JSON message per line, flushed immediately. */
export function ndjson(res){
 res.status(200).set({'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
 res.flushHeaders?.();
 return message=>{if(!res.writableEnded)res.write(JSON.stringify(message)+'\n');};
}
export const wantsStream=req=>(req.get('Accept')||'').includes('application/x-ndjson');

/**
 * Runs an LLM task and answers either as NDJSON ({type:'stage'|'item'|'done'|'error'}) when the client
 * asks for a stream, or as a single JSON body otherwise. `failure` maps an error to a user-facing message.
 */
export async function respond(req,res,task,failure,status=502){
 const send=wantsStream(req)?ndjson(res):null;
 const started=Date.now();
 const progress={
  stage:(stage,detail={})=>send?.({type:'stage',stage,elapsed:Date.now()-started,...detail}),
  item:(key,index,item)=>send?.({type:'item',key,index,item}),
  text:delta=>send?.({type:'text',delta}),
  source:data=>send?.({type:'source',...data}),
  reset:()=>send?.({type:'reset'})
 };
 // While the model thinks silently, a keep-alive line stops proxies (e.g. the nginx relay) from closing the stream.
 const heartbeat=send&&setInterval(()=>send({type:'ping',elapsed:Date.now()-started}),20000);
 try{
  const result=await task(progress);
  if(send){send({type:'done',result,elapsed:Date.now()-started});res.end();}else res.json(result);
 }catch(error){
  // Keep the real cause in the server log; the visitor only sees the friendly message.
  console.error('AI request failed:',error?.name,error?.message,`after ${Math.round((Date.now()-started)/1000)} s`);
  // `error.partial` holds the results finished before the failure, so the visitor can keep them.
  const message=failure(error),partial=error?.partial?{partial:error.partial}:{};
  if(send){send({type:'error',error:message,...partial});res.end();}else res.status(status).json({error:message,...partial});
 }finally{if(heartbeat)clearInterval(heartbeat);}
}

/** Streams a JSON-returning completion, reporting each finished array item, and returns the parsed object. */
// Malformed JSON (a truncated or chatty answer) is retried once; the client is told to drop what it has shown.
// A thrown error carries `items` ({key: [item…]}): the array items that were complete when it failed.
export async function streamJson(config,body,timeout,progress,idle){
 for(let tries=0;;tries++){
  const items={};
  const feed=jsonItems((key,item)=>{(items[key]||=[]).push(item);progress.item(key,items[key].length-1,item);});
  let first=true,raw;
  const retry=(attempt,status)=>progress.stage('reconnecting',{attempt,of:RETRY.times,status});
  try{raw=await streamChat(config,body,timeout,delta=>{if(first){first=false;progress.stage('generating');}feed(delta);},idle,retry);}
  catch(error){throw Object.assign(error,{items});}
  try{return JSON.parse(stripFence(raw));}
  catch(error){if(tries)throw Object.assign(error,{items});progress.reset();progress.stage('retrying');}
 }
}
