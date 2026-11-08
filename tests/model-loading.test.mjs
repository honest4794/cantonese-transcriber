import test from 'node:test';
import assert from 'node:assert/strict';
import {loadVerifiedParts} from '../web/model-cache.mjs';
const part={url:'https://example.test/model',bytes:5,sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'};
const bytes=text=>new TextEncoder().encode(text);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const bounded=promise=>Promise.race([promise,wait(250).then(()=>null)]);

test('download progress arrives before the first model part has finished',async()=>{
 let controller,notify;
 const progress=new Promise(resolve=>notify=resolve);
 const response=new Response(new ReadableStream({start(c){controller=c;}}));
 const pending=loadVerifiedParts([part],{cacheStorage:null,fetchImpl:async()=>response,onProgress:e=>{if(e.loaded===2&&e.stage==='downloading')notify();}});
 controller.enqueue(bytes('he'));
 const received=await Promise.race([progress.then(()=>true),wait(80).then(()=>false)]);
 controller.enqueue(bytes('llo'));controller.close();
 assert.equal(new TextDecoder().decode(await pending),'hello');
 assert.equal(received,true,'waiting for all 50MB must not hide the first received bytes');
});
test('a cache open that never resolves cannot block model loading',async()=>{
 const pending=loadVerifiedParts([part],{cacheTimeoutMs:15,cacheStorage:{open:()=>new Promise(()=>{})},fetchImpl:async()=>new Response('hello')});
 const result=await bounded(pending);
 assert.ok(result,'cache timeout must allow verified network bytes to proceed');
 assert.equal(new TextDecoder().decode(result),'hello');
});
test('a stalled cache write cannot block inference after a verified download',async()=>{
 const cacheStorage={open:async()=>({match:async()=>null,put:()=>new Promise(()=>{})})};
 const result=await bounded(loadVerifiedParts([part],{cacheStorage,cacheTimeoutMs:15,fetchImpl:async()=>new Response('hello')}));
 assert.ok(result,'optional cache persistence must finish or be skipped');
 assert.equal(new TextDecoder().decode(result),'hello');
});
test('no response headers within the idle timeout aborts the network request',async()=>{
 let aborted=false;
 const fetchImpl=(_,options)=>new Promise((resolve,reject)=>options.signal?.addEventListener('abort',()=>{aborted=true;reject(options.signal.reason);}));
 const result=await bounded(loadVerifiedParts([part],{idleTimeoutMs:20,cacheStorage:null,fetchImpl}).catch(e=>e));
 assert.equal(result?.name,'TimeoutError');assert.equal(aborted,true);
});
test('a body that stops receiving bytes times out and releases its reader',async()=>{
 let controller,cancelled=false;
 const response=new Response(new ReadableStream({start(c){controller=c;c.enqueue(bytes('he'));},cancel(){cancelled=true;}}));
 const pending=loadVerifiedParts([part],{idleTimeoutMs:20,cacheStorage:null,fetchImpl:async()=>response}).catch(e=>e);
 const result=await bounded(pending);
 if(!cancelled)controller.close();
 assert.equal(result?.name,'TimeoutError');assert.equal(cancelled,true);
});
test('active slow transfers may take longer than the idle timeout in total',async()=>{
 let index=0;
 const response=new Response(new ReadableStream({async pull(c){await wait(35);c.enqueue(bytes('hello'[index++]));if(index===5)c.close();}}));
 const result=await loadVerifiedParts([part],{idleTimeoutMs:100,cacheStorage:null,fetchImpl:async()=>response});
 assert.equal(new TextDecoder().decode(result),'hello');
});
test('abort interrupts a pending body read rather than waiting for all model bytes',async()=>{
 const abort=new AbortController();let controller,cancelled=false;
 const response=new Response(new ReadableStream({start(c){controller=c;c.enqueue(bytes('he'));},cancel(){cancelled=true;}}));
 const pending=loadVerifiedParts([part],{signal:abort.signal,cacheStorage:null,fetchImpl:async()=>response}).catch(e=>e);
 await wait(5);abort.abort();const result=await bounded(pending);
 if(!cancelled)controller.close();
 assert.equal(result?.name,'AbortError');assert.equal(cancelled,true);
});
test('progress includes runtime files and cannot complete while one resource is still loading',async()=>{
 const {loadVerifiedResources}=await import('../web/model-cache.mjs');
 assert.equal(typeof loadVerifiedResources,'function');
 let controller;const events=[];
 const response=new Response(new ReadableStream({start(c){controller=c;}}));
 const pending=loadVerifiedResources({model:[part],runtime:[{...part,url:part.url+'-wasm'}]},{cacheStorage:null,onProgress:e=>events.push(e),fetchImpl:async url=>url.endsWith('-wasm')?response:new Response('hello')});
 await pending.model;
 assert.equal(events.at(-1).total,10);assert.equal(events.at(-1).loaded,5);assert.notEqual(events.at(-1).stage,'complete');
 controller.enqueue(bytes('hello'));controller.close();await pending.runtime;
 assert.equal(events.at(-1).loaded,10);assert.equal(events.at(-1).stage,'complete');
});
test('an abort from a progress callback consumes the rejected fetch promise',async()=>{
 const abort=new AbortController();
 await assert.rejects(loadVerifiedParts([part],{signal:abort.signal,cacheStorage:null,onProgress:e=>{if(e.stage==='connecting')abort.abort();},fetchImpl:async(_,options)=>{options.signal.throwIfAborted();return new Response('hello');}}),{name:'AbortError'});
 await wait(10);
});
test('a stalled cached body falls back to network without waiting for the network idle limit',async()=>{
 let cancelled=false,requests=0;
 const response=new Response(new ReadableStream({cancel(){cancelled=true;}}));
 const cacheStorage={open:async()=>({match:async()=>response})};
 const result=await bounded(loadVerifiedParts([part],{cacheStorage,cacheTimeoutMs:15,fetchImpl:async()=>{requests++;return new Response('hello');}}));
 assert.equal(new TextDecoder().decode(result),'hello');assert.equal(cancelled,true);assert.equal(requests,1);
});
test('an oversized response is cancelled and never written to the model cache',async()=>{
 let cached=false,cancelled=false;
 const response=new Response(new ReadableStream({start(c){c.enqueue(bytes('too many model bytes'));},cancel(){cancelled=true;}}));
 const cacheStorage={open:async()=>({match:async()=>null,put:async()=>{cached=true;}})};
 await assert.rejects(loadVerifiedParts([part],{cacheStorage,fetchImpl:async()=>response}),/完整性/);
 assert.equal(cached,false);assert.equal(cancelled,true);
});
