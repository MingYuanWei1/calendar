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
const IDLE_TIMEOUT=45000,MAX_TEXT=2*1024*1024;
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
  // Each SSE token carries a few hundred bytes of envelope (and reasoning deltas), so the wire cap is loose;
  // the real limit is on the answer text itself.
  bytes+=value.length;if(bytes>64*1024*1024||full.length>MAX_TEXT){await reader.cancel();throw new Error('模型返回内容过大，请缩小提取范围。');}
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

/**
 * Emits each complete object inside top-level JSON arrays (e.g. {"sessions":[{…},{…}]}) as the text streams in.
 * An object that is not valid JSON goes to onInvalid(key, text, 'json') and scanning carries on with the next one;
 * a quote the model forgot to escape (one not followed by : , } or ]) is kept inside its string so the scan stays
 * in step. Call `end()` once the text is complete: an object still open then goes to onInvalid(key, text, 'cut').
 * `closed` names the arrays whose "]" arrived; `strings` collects top-level string arrays (e.g. warnings).
 */
export function jsonItems(onItem,onInvalid=()=>{}){
 let inString=false,escaped=false,key='',lastString='',arrayKey='',start=-1,stringStart=-1,text='',position=0,capturing=false,ended=false;
 const stack=[],closed=new Set(),strings={};
 const topLevel=()=>stack.length===2&&stack[0]==='{'&&stack[1]==='[';
 const feed=chunk=>{
  text+=chunk;
  for(;position<text.length;position++){
   const c=text[position];
   if(inString){
    if(escaped)escaped=false;
    else if(c==='\\')escaped=true;
    else if(c==='"'){
     let next=position+1;while(next<text.length&&/\s/.test(text[next]))next++;
     if(next===text.length&&!ended)return;// wait for the character that tells whether the string ends here
     if(next<text.length&&!':,}]'.includes(text[next])){if(!capturing)key+=c;continue;}
     inString=false;
     if(stringStart>=0){try{(strings[arrayKey]||=[]).push(JSON.parse(text.slice(stringStart,position+1)));}catch{}stringStart=-1;}
     if(!capturing)lastString=key;
    }
    else if(!capturing)key+=c;
    continue;
   }
   if(c==='"'){inString=true;if(!capturing){key='';if(topLevel())stringStart=position;}continue;}
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
     const item=text.slice(start,position+1);
     let value;try{value=JSON.parse(item);}catch{onInvalid(arrayKey,item,'json');continue;}
     onItem(arrayKey,value);
    }
    if(c===']'&&stack.length===1)closed.add(arrayKey);
   }
  }
 };
 return Object.assign(feed,{closed,strings,end(){
  ended=true;feed('');
  if(capturing){capturing=false;onInvalid(arrayKey,text.slice(start),'cut');}
 }});
}
export const stripFence=raw=>raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
/** Parses the model's JSON object, ignoring any prose or code fence the model wrote before or after it. */
export function parseAnswer(raw){
 const text=stripFence(raw);
 try{return JSON.parse(text);}
 catch(error){
  const start=text.indexOf('{');if(start<0)throw error;
  let depth=0,inString=false,escaped=false;
  for(let i=start;i<text.length;i++){
   const c=text[i];
   if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
   if(c==='"')inString=true;
   else if(c==='{')depth++;
   else if(c==='}'&&--depth===0)return JSON.parse(text.slice(start,i+1));
  }
  throw error;
 }
}

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
  invalid:entry=>send?.({type:'invalid',...entry}),
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
// Malformed JSON (a truncated or chatty answer) keeps every array item that parsed, and lists the broken ones under
// [INVALID] ({key, text, reason}) so the visitor can see what was left out; each is also streamed as it is found.
// An answer without a single usable item is regenerated once (the client is told to reset).
// A thrown error carries `items` ({key: [item…]}): the array items that were complete when it failed.
export const INVALID=Symbol('invalid items');
export async function streamJson(config,body,timeout,progress,idle){
 for(let tries=0;;tries++){
  const items={},invalid=[];
  const feed=jsonItems(
   (key,item)=>{(items[key]||=[]).push(item);progress.item(key,items[key].length-1,item);},
   (key,text,reason)=>{const entry={key,text:text.slice(0,4000),reason};invalid.push(entry);progress.invalid?.(entry);});
  let first=true,raw;
  const retry=(attempt,status)=>progress.stage('reconnecting',{attempt,of:RETRY.times,status});
  try{raw=await streamChat(config,body,timeout,delta=>{if(first){first=false;progress.stage('generating');}feed(delta);},idle,retry);}
  catch(error){throw Object.assign(error,{items});}
  try{return parseAnswer(raw);}
  catch(error){
   // Log the end of the answer so the cause (cut off, or stray text) can be told apart in the server log.
   console.error('LLM answer is not valid JSON:',raw.length,'chars, ends with',JSON.stringify(raw.slice(-200)));
   feed.end();
   if(Object.keys(items).length||(tries&&invalid.length))return {...feed.strings,...items,[INVALID]:invalid};
   if(tries)throw Object.assign(error,{items});
   progress.reset();progress.stage('retrying');
  }
 }
}

/**
 * Validates the answer's `key` array item by item: a malformed item is set aside instead of failing the whole
 * extraction. Returns {list, warnings, invalid}, where `invalid` ([{text, reason:'cut'|'json'|'schema', detail?}])
 * holds the items that were left out; an answer with neither the array nor any broken item throws a SyntaxError.
 */
export function lenientList(raw,key,schema,max){
 const broken=(raw?.[INVALID]||[]).filter(entry=>entry.key===key).map(({text,reason})=>({text,reason}));
 if(!Array.isArray(raw?.[key])&&!broken.length)throw new SyntaxError(`model answer has no ${key} array`);
 const list=[],invalid=[...broken];
 for(const value of (raw[key]||[]).slice(0,max)){
  const r=schema.safeParse(value);
  if(r.success)list.push(r.data);
  else invalid.push({text:JSON.stringify(value).slice(0,4000),reason:'schema',detail:r.error.issues.slice(0,3).map(i=>`${i.path.join('.')}: ${i.message}`).join('；')});
 }
 const warnings=(Array.isArray(raw.warnings)?raw.warnings:[]).filter(w=>typeof w==='string'&&w).map(w=>w.slice(0,1000)).slice(0,100);
 return {list,warnings,invalid};
}
