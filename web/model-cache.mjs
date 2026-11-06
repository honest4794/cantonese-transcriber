export const MODEL_CACHE = 'cantonese-transcriber-models-v2';

async function verified(response, part) {
  if (!response?.ok) throw new Error(`模型載入失敗（${response?.status ?? '網絡錯誤'}），請稍後重試。`);
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==part.bytes) throw new Error('模型檔案完整性驗證失敗，請重新載入。');
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(hex!==part.sha256) throw new Error('模型檔案完整性驗證失敗，請重新載入。');
  return bytes;
}

export async function loadVerifiedParts(parts, options={}) {
  const {signal,onProgress=()=>{},fetchImpl=globalThis.fetch,cacheStorage=globalThis.caches}=options;
  signal?.throwIfAborted();
  let cache=null;
  try {cache=await cacheStorage?.open(MODEL_CACHE);} catch { /* Private mode or quota limits must not prevent inference. */ }
  const total=parts.reduce((n,p)=>n+p.bytes,0),combined=new Uint8Array(total);
  let loaded=0;
  for(const part of parts) {
    signal?.throwIfAborted();
    let bytes=null,cached=false;
    if(cache) {
      try {
        const response=await cache.match(part.url);
        if(response) {bytes=await verified(response,part);cached=true;}
      } catch {try{await cache.delete(part.url);}catch{}}
    }
    if(!bytes) {
      const response=await fetchImpl(part.url,{signal,cache:'no-store',credentials:'omit'});
      bytes=await verified(response,part);
      signal?.throwIfAborted();
      try {await cache?.put(part.url,new Response(bytes,{headers:{'Content-Type':'application/octet-stream'}}));} catch { /* Browsers may evict or refuse large cache entries. */ }
    }
    combined.set(new Uint8Array(bytes),loaded);loaded+=part.bytes;
    onProgress({loaded,total,cached});
  }
  signal?.throwIfAborted();
  return combined.buffer;
}
