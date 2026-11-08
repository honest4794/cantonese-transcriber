// One large GPU model at a time; up to three small CPU segmentation workers overlap ASR.
let started=false;
self.onmessage=async({data})=>{
 if(started)return;started=true;
 let asr,embedding,genericEmbedding,pool;
 try {
  const begin=performance.now();
  if(!self.navigator.gpu||!await self.navigator.gpu.requestAdapter({powerPreference:'high-performance'}))throw Error('此瀏覽器未能使用 GPU');
  const [{loadVerifiedParts},{Fbank,stackSenseVoice,subtractMean},{makeChunkRanges,isDigitalSilence},{decodeCtc,clusterEmbeddings,speakerSamples,speakerTurns},{SegmentationPool},ort]=await Promise.all([
   import('./model-cache.mjs'),import('./audio-features.mjs'),import('./engine-core.mjs'),import('./gpu-engine.mjs'),import('./segmentation-pool.mjs'),import('./vendor/ort-1.29.0/ort.webgpu.min.mjs'),
  ]);
  const response=await fetch('./models.json',{cache:'no-store'});if(!response.ok)throw Error('模型設定未能載入');
  const manifest=await response.json(),gpu=manifest.gpu;if(!gpu)throw Error('GPU 模型尚未提供');
  const resolve=part=>({...part,url:new URL(part.url,self.location.href).href});
  const load=(parts,options)=>loadVerifiedParts(parts.map(resolve),options);
  const json=async part=>JSON.parse(new TextDecoder().decode(await load([part])));
  const samples=new Float32Array(data.audio),duration=samples.length/16000,wantSpeakers=data.speakers>1;
  self.postMessage({type:'progress',phase:'loading',message:'載入本機 GPU 加速模型；錄音唔會上傳',progress:null});
  const speakerPromise=wantSpeakers?Promise.all([
   load(manifest.models.speakers.data),load([gpu.runtime.find(p=>p.url.endsWith('/ort-wasm-simd-threaded.wasm'))]),load([gpu.embedding]),
  ]).then(value=>({value}),error=>({error})):null;
  let [model,wasm,cmvn,vocab]=await Promise.all([
   load(gpu.model.parts,{onProgress:({loaded,total,cached})=>self.postMessage({type:'progress',phase:'loading',message:`${cached?'讀取快取':'載入'} GPU 模型 ${Math.round(loaded/1048576)} / ${Math.round(total/1048576)} MB`,progress:100*loaded/total})}),
   load([gpu.runtime.find(p=>p.url.endsWith('.asyncify.wasm'))]),json(gpu.cmvn),json(gpu.vocab),
  ]);
  ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=new URL('./vendor/ort-1.29.0/',self.location.href).href;ort.env.wasm.wasmBinary=new Uint8Array(wasm);wasm=null;
  self.postMessage({type:'progress',phase:'initializing',message:'初始化 GPU 粵語模型',progress:null});
  asr=await ort.InferenceSession.create(new Uint8Array(model),{executionProviders:['webgpu'],graphOptimizationLevel:'all'});model=null;
  let speakerData,embeddingModel,segmentationResult;
  if(wantSpeakers){
   const prepared=await speakerPromise;if(prepared.error)throw prepared.error;
   const [packageBytes,runtime,staticEmbedding]=prepared.value;speakerData=packageBytes;embeddingModel=staticEmbedding;
   pool=new SegmentationPool({workerFactory:()=>new Worker(new URL('./segmentation-worker.js?v=gpu-v1',self.location.href)),maxWorkers:Math.min(3,Math.max(1,(navigator.hardwareConcurrency||4)-2)),shiftSamples:160000});
   // The official package table is pinned in models.json and verified by SHA256:
   // README [0,1011), embedding [1011,39594772), segmentation [39594772,45587685).
   segmentationResult=pool.start(samples,packageBytes.slice(39594772,45587685),{wasm:runtime}).then(value=>({value}),error=>({error}));
  }
  const loadedAt=performance.now(),features=new Fbank(),ranges=makeChunkRanges(samples.length,16000);let preprocessMs=0,runMs=0;
  for(let i=0;i<ranges.length;i++){
   const range=ranges[i],slice=samples.subarray(range.start,range.end);
   if(!isDigitalSilence(slice)){
    const prepStart=performance.now(),pcm=slice.length<400?Float32Array.from({length:400},(_,j)=>slice[j]||0):slice,f=stackSenseVoice(features.process(pcm),cmvn);preprocessMs+=performance.now()-prepStart;
    const feeds={speech:new ort.Tensor('float32',f.features,[1,f.frames,560]),speech_lengths:new ort.Tensor('int32',Int32Array.of(f.frames),[1]),language:new ort.Tensor('int32',Int32Array.of(7),[1]),textnorm:new ort.Tensor('int32',Int32Array.of(14),[1])};let output;
    try {
     const runStart=performance.now();output=await asr.run(feeds);runMs+=performance.now()-runStart;
     const chunk=decodeCtc(output.token_ids.data,vocab,{start:range.start/16000,keepStart:range.keepStart/16000,keepEnd:range.keepEnd/16000});
     if(chunk.tokens.length)self.postMessage({type:'chunk',chunk});
    }finally{for(const t of [...Object.values(feeds),...Object.values(output||{})])t.dispose();}
   }
   self.postMessage({type:'progress',phase:'transcribing',backend:'WebGPU',message:`GPU 轉錄 ${i+1} / ${ranges.length} 段`,progress:100*(i+1)/ranges.length,processedSeconds:range.keepEnd/16000});
  }
  const metrics={loadMs:loadedAt-begin,inferenceMs:performance.now()-loadedAt,preprocessMs,runMs,backend:'WebGPU'};
  await asr.release();asr=null;
  self.postMessage({type:'asr-done',duration,metrics,continueSpeakers:wantSpeakers});
  if(!wantSpeakers)return;
  const speakerBegin=performance.now();
  self.postMessage({type:'progress',phase:'speakers',message:'文字已完成；整理講者交界',progress:null});
  const segmented=await segmentationResult;if(segmented.error)throw segmented.error;
  self.postMessage({type:'progress',phase:'speakers',message:'載入 GPU 講者聲紋模型',progress:null});
  embedding=await ort.InferenceSession.create(new Uint8Array(embeddingModel),{executionProviders:['webgpu']});embeddingModel=null;
  const embLoadedAt=performance.now(),speakerFeatures=new Fbank({window:'povey',snipEdges:false,highHz:7600,scale:1});
  const candidates=speakerSamples(samples,segmented.value,{maxSamples:48000}),results=new Array(candidates.length),pending=[];let featureMs=0,embeddingMs=0,done=0;
  const progress=()=>self.postMessage({type:'progress',phase:'speakers',backend:'WebGPU',message:`GPU 分辨講者 ${done} / ${candidates.length}`,progress:100*done/Math.max(1,candidates.length)});
  async function flush(){
   if(!pending.length)return;
   const input=new Float32Array(8*300*80);
   pending.forEach((item,row)=>input.set(item.features,row*300*80));
   const tensor=new ort.Tensor('float32',input,[8,300,80]);let output;
   try {
    const runStart=performance.now();output=await embedding.run({x:tensor});embeddingMs+=performance.now()-runStart;
    pending.forEach((item,row)=>{results[item.index]=Array.from(output.embedding.data.subarray(row*512,(row+1)*512));});
   }finally{tensor.dispose();for(const t of Object.values(output||{}))t.dispose();}
   done+=pending.length;pending.length=0;progress();
  }
  for(let i=0;i<candidates.length;i++){
   const prepStart=performance.now(),entry=candidates[i],f=speakerFeatures.process(entry.samples);delete entry.samples;
   subtractMean(f.features,f.frames);
   featureMs+=performance.now()-prepStart;
   if(f.frames===300){pending.push({index:i,features:f.features});if(pending.length===8)await flush();}
   else {
    if(!genericEmbedding)genericEmbedding=await ort.InferenceSession.create(new Uint8Array(speakerData,1011,39593761),{executionProviders:['webgpu']});
    const input=new ort.Tensor('float32',f.features,[1,f.frames,80]);let output;
    try {const runStart=performance.now();output=await genericEmbedding.run({x:input});embeddingMs+=performance.now()-runStart;results[i]=Array.from(output.embedding.data);}
    finally{input.dispose();for(const t of Object.values(output||{}))t.dispose();}
    done++;progress();
   }
  }
  await flush();
  await embedding.release();embedding=null;
  await genericEmbedding?.release();genericEmbedding=null;speakerData=null;
  const valid=[],vectors=[];for(let i=0;i<candidates.length;i++)if(results[i]?.every(Number.isFinite)){valid.push(candidates[i]);vectors.push(results[i]);}
  const clusterStart=performance.now(),assignments=clusterEmbeddings(vectors,data.speakers),turns=speakerTurns(segmented.value,valid,assignments,duration,data.speakers);
  self.postMessage({type:'speaker-done',turns,metrics:{loadMs:embLoadedAt-speakerBegin,inferenceMs:performance.now()-embLoadedAt,featureMs,embeddingMs,clusterMs:performance.now()-clusterStart,embeddings:vectors.length,backend:'WebGPU + CPU'}});
 }catch(error){self.postMessage({type:'error',recoverable:true,message:String(error.message||error)});}
 finally{pool?.cancel();await asr?.release().catch(()=>{});await embedding?.release().catch(()=>{});await genericEmbedding?.release().catch(()=>{});}
};
