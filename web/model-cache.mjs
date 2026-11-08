export const MODEL_CACHE = 'cantonese-transcriber-models-v2';

function timeoutError(){const e=new Error('模型載入暫時無回應，請檢查網絡後重試。');e.name='TimeoutError';return e;}
function bounded(promise,ms,signal,onTimeout=()=>{}) {
 return new Promise((resolve,reject)=>{
  let settled=false,timer;
  const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};
  const abort=()=>finish(reject,signal.reason??new DOMException('已取消','AbortError'));
  // Attach handlers even when already aborted: fetch may have rejected before
  // this wrapper is entered, and must not leave an unhandled rejection.
  Promise.resolve(promise).then(value=>finish(resolve,value),error=>finish(reject,error));
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{const error=timeoutError();onTimeout(error);finish(reject,error);},ms);
 });
}

async function verified(response,part,{signal,idleTimeoutMs,onTimeout=()=>{},onBytes=()=>{}}) {
 if(!response?.ok)throw new Error(`模型載入失敗（${response?.status??'網絡錯誤'}），請稍後重試。`);
 signal?.throwIfAborted();
 const data=new Uint8Array(part.bytes);let offset=0,lastReport=-Infinity;
 const reader=response.body?.getReader();
 if(reader){
  try {
   while(true){
    const {done,value}=await bounded(reader.read(),idleTimeoutMs,signal,onTimeout);
    if(done)break;
    if(offset+value.byteLength>data.length)throw new Error('模型檔案完整性驗證失敗，請重新載入。');
    data.set(value,offset);offset+=value.byteLength;
    const now=performance.now();
    if(now-lastReport>=120||offset===data.length){onBytes(offset);lastReport=now;}
   }
  }catch(error){void reader.cancel().catch(()=>{});throw error;}
  finally{try{reader.releaseLock();}catch{}}
 }else{
  const bytes=await bounded(response.arrayBuffer(),idleTimeoutMs,signal,onTimeout);
  if(bytes.byteLength!==data.length)throw new Error('模型檔案完整性驗證失敗，請重新載入。');
  data.set(new Uint8Array(bytes));offset=data.length;onBytes(offset);
 }
 if(offset!==part.bytes)throw new Error('模型檔案完整性驗證失敗，請重新載入。');
 const digest=await crypto.subtle.digest('SHA-256',data);signal?.throwIfAborted();
 const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
 if(hex!==part.sha256)throw new Error('模型檔案完整性驗證失敗，請重新載入。');
 return data.buffer;
}

export async function loadVerifiedParts(parts,options={}) {
 const {signal,onProgress=()=>{},fetchImpl=globalThis.fetch,cacheStorage=globalThis.caches,idleTimeoutMs=60000,cacheTimeoutMs=5000}=options;
 signal?.throwIfAborted();
 const total=parts.reduce((n,p)=>n+p.bytes,0);let loaded=0,cache=null;
 const report=(received,stage,cached=false)=>onProgress({loaded:loaded+received,total,stage,cached});
 report(0,'checking',true);
 try{cache=await bounded(cacheStorage?.open(MODEL_CACHE),cacheTimeoutMs,signal);}catch{signal?.throwIfAborted();}
 const combined=new Uint8Array(total);
 for(const part of parts){
  signal?.throwIfAborted();let bytes=null,cached=false;
  if(cache){
   report(0,'cache-reading',true);
   try{
    const response=await bounded(cache.match(part.url),cacheTimeoutMs,signal);
    if(response){
     bytes=await verified(response,part,{signal,idleTimeoutMs:cacheTimeoutMs,onBytes:n=>report(n,'cache-reading',true)});cached=true;
    }
   }catch(error){
    signal?.throwIfAborted();
    if(error.name==='TimeoutError')cache=null;
    else try{await bounded(cache.delete(part.url),cacheTimeoutMs,signal);}catch{signal?.throwIfAborted();cache=null;}
   }
  }
  if(!bytes){
   const request=new AbortController(),abort=()=>request.abort(signal.reason);
   signal?.addEventListener('abort',abort,{once:true});
   const timeout=error=>request.abort(error);
   try{
    report(0,'connecting');
    const response=await bounded(fetchImpl(part.url,{signal:request.signal,cache:'no-store',credentials:'omit'}),idleTimeoutMs,request.signal,timeout);
    report(0,'downloading');
    bytes=await verified(response,part,{signal:request.signal,idleTimeoutMs,onTimeout:timeout,onBytes:n=>report(n,'downloading')});
   }finally{signal?.removeEventListener('abort',abort);request.abort();}
   signal?.throwIfAborted();
   if(cache){
    report(part.bytes,'caching');
    try{await bounded(cache.put(part.url,new Response(bytes,{headers:{'Content-Type':'application/octet-stream'}})),cacheTimeoutMs,signal);}
    catch{signal?.throwIfAborted();cache=null;}
   }
  }
  combined.set(new Uint8Array(bytes),loaded);loaded+=part.bytes;
  onProgress({loaded,total,cached,stage:loaded===total?'complete':'verified'});
 }
 signal?.throwIfAborted();return combined.buffer;
}

/** Track every concurrent model/runtime request, including the slowest one. */
export function loadVerifiedResources(resources,options={}) {
 const {onProgress=()=>{},...loadOptions}=options;
 const state=new Map(Object.entries(resources).map(([key,parts])=>[key,{loaded:0,total:parts.reduce((n,p)=>n+p.bytes,0),stage:'checking',cached:true}]));
 const report=()=>{
  const all=[...state.values()],pending=all.filter(s=>s.stage!=='complete');
  const order=['downloading','connecting','cache-reading','caching','checking','verified'];
  const stage=pending.length?order.find(stage=>pending.some(s=>s.stage===stage))??'checking':'complete';
  onProgress({loaded:all.reduce((n,s)=>n+s.loaded,0),total:all.reduce((n,s)=>n+s.total,0),stage,cached:all.every(s=>s.cached)});
 };
 report();
 return Object.fromEntries(Object.entries(resources).map(([key,parts])=>[key,loadVerifiedParts(parts,{...loadOptions,onProgress:event=>{state.set(key,event);report();}})]));
}

export function modelLoadingProgress({loaded,total,stage},name='模型') {
 const action={checking:'檢查',connecting:'連接下載',downloading:'下載','cache-reading':'讀取快取',caching:'儲存快取',verified:'核對',complete:'已載入'}[stage]??'載入';
 return {type:'progress',phase:'loading',message:`${action} ${name} ${(loaded/1048576).toFixed(1)} / ${(total/1048576).toFixed(1)} MB`,progress:stage==='complete'?100:Math.min(99.9,total?100*loaded/total:0)};
}
