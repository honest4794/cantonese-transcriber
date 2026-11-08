import test from 'node:test';
import assert from 'node:assert/strict';
import {SegmentationPool} from '../web/segmentation-pool.mjs';
class Worker {
 constructor(){this.messages=[];this.terminated=false;}
 postMessage(message){this.messages.push(message);}
 terminate(){this.terminated=true;}
 emit(data){this.onmessage({data});}
}
test('segmentation pool keeps at most two chunks in flight and returns every tail task in time order',async()=>{
 const workers=[];const pool=new SegmentationPool({workerFactory:()=>{const w=new Worker();workers.push(w);return w;}});
 const result=pool.start(new Float32Array(400001),new ArrayBuffer(4));
 assert.equal(workers.length,2);
 for(const w of workers)w.emit({type:'ready'});
 assert.equal(workers[0].messages.at(-1).index,0);assert.equal(workers[1].messages.at(-1).index,1);
 workers[1].emit({type:'result',index:1,labels:Uint8Array.of(1)});
 assert.equal(workers[1].messages.at(-1).index,2);
 workers[0].emit({type:'result',index:0,labels:Uint8Array.of(2)});
 assert.equal(workers[0].messages.at(-1).index,3);
 workers[1].emit({type:'result',index:2,labels:Uint8Array.of(1)});
 assert.equal(workers[1].messages.at(-1).index,4);
 workers[0].emit({type:'result',index:3,labels:Uint8Array.of(2)});
 workers[1].emit({type:'result',index:4,labels:Uint8Array.of(1)});
 const chunks=await result;
 assert.deepEqual(chunks.map(x=>x.start),[0,80000,160000,240000,320000]);
 assert.ok(workers.every(w=>w.terminated));
});
test('allocation and child worker errors reject the pool and release all owned workers',async()=>{
 const workers=[];const pool=new SegmentationPool({workerFactory:()=>{if(workers.length)throw Error('allocation');const w=new Worker();workers.push(w);return w;}});
 await assert.rejects(pool.start(new Float32Array(400001),new ArrayBuffer(4)),/allocation/);
 assert.equal(workers[0].terminated,true);
 const w=new Worker(),other=new SegmentationPool({workerFactory:()=>w,maxWorkers:1});
 const pending=other.start(new Float32Array(16000),new ArrayBuffer(4));
 w.onerror({message:'model failed'});
 await assert.rejects(pending,/model failed/);assert.equal(w.terminated,true);
});
test('cancel terminates segmentation workers and ignores their late results',async()=>{
 const w=new Worker(),pool=new SegmentationPool({workerFactory:()=>w,maxWorkers:1});
 const pending=pool.start(new Float32Array(16000),new ArrayBuffer(4));
 pool.cancel();await assert.rejects(pending,{name:'AbortError'});
 w.emit({type:'result',index:0,labels:Uint8Array.of(1)});
 assert.equal(w.terminated,true);
});
