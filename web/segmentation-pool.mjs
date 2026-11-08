import {segmentationRanges} from './gpu-engine.mjs';

/** Only small 10s PCM buffers cross this bounded CPU pool. */
export class SegmentationPool {
 constructor({workerFactory,onProgress=()=>{},maxWorkers=2,shiftSamples=80000}){Object.assign(this,{workerFactory,onProgress,maxWorkers,shiftSamples});this.workers=[];this.settled=true;}
 start(samples,model,{wasm}={}){
  this.samples=samples;this.ranges=segmentationRanges(samples.length,this.shiftSamples);this.results=new Array(this.ranges.length);this.next=0;this.done=0;this.settled=false;
  return new Promise((resolve,reject)=>{
   this.resolve=resolve;this.reject=reject;
   if(!this.ranges.length){this.settled=true;resolve([]);return;}
   try {
    for(let i=0;i<Math.min(this.maxWorkers,this.ranges.length);i++){
     const worker=this.workerFactory();this.workers.push(worker);
     worker.onerror=e=>this.fail(new Error(e.message||'講者分段失敗'));
     worker.onmessage=({data})=>{
      if(this.settled)return;
      try {
       if(data.type==='error'){this.fail(new Error(data.message));return;}
       if(data.type==='result'){
        if(this.results[data.index])return;
        this.results[data.index]={start:this.ranges[data.index].start,labels:data.labels};this.done++;
        this.onProgress(this.done,this.ranges.length);
        if(this.done===this.ranges.length){this.settled=true;const results=this.results;this.stop();resolve(results);return;}
       }
       if(data.type==='result'||data.type==='ready')this.assign(worker);
      }catch(error){this.fail(error);}
     };
     const copy=model.slice(0),runtime=wasm?.slice(0);
     worker.postMessage({type:'init',model:copy,wasm:runtime},runtime?[copy,runtime]:[copy]);
    }
   }catch(error){this.fail(error);}
  });
 }
 assign(worker){
  if(this.next>=this.ranges.length)return;
  const index=this.next++,range=this.ranges[index],audio=new Float32Array(160000);
  audio.set(this.samples.subarray(range.start,range.end));worker.postMessage({type:'run',index,audio:audio.buffer},[audio.buffer]);
 }
 stop(){for(const w of this.workers)w.terminate();this.workers=[];this.samples=null;}
 fail(error){if(this.settled)return;this.settled=true;this.stop();this.reject(error);}
 cancel(){this.fail(new DOMException('已取消','AbortError'));}
}
