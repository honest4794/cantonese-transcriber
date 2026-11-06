/* One classic Worker owns one sherpa-onnx WASM instance. No audio upload. */
let started=false;
self.onmessage=async event=>{
  if(started)return;
  started=true;
  try {
    const {loadVerifiedParts}=await import('./model-cache.mjs');
    const {makeChunkRanges,isDigitalSilence}=await import('./engine-core.mjs');
    const {type,audio,speakers}=event.data;
    const kind=type==='speakers'?'speakers':'asr';
    const begin=performance.now();
    const response=await fetch('./models.json',{cache:'no-store'});
    if(!response.ok)throw new Error('模型設定載入失敗，請重新整理網頁。');
    const manifest=await response.json(),model=manifest.models[kind],sampleRate=manifest.sampleRate;
    const name=kind==='asr'?'粵語':'講者';
    self.postMessage({type:'progress',phase:'loading',message:`首次自動載入${name}模型；之後會重用快取`,progress:null});
    const resolve=part=>({...part,url:new URL(part.url,self.location.href).href});
    const wasm=await loadVerifiedParts([resolve(model.wasm)]);
    const data=await loadVerifiedParts(model.data.map(resolve),{onProgress:({loaded,total,cached})=>self.postMessage({type:'progress',phase:'loading',message:`${cached?'讀取快取':'載入'}${name}模型 ${Math.round(loaded/1048576)} / ${Math.round(total/1048576)} MB`,progress:100*loaded/total})});
    self.postMessage({type:'progress',phase:'initializing',message:`初始化${name}模型`,progress:null});
    await new Promise((resolveReady,reject)=>{
      self.Module={
        wasmBinary:new Uint8Array(wasm),
        getPreloadedPackage:()=>data,
        locateFile:path=>new URL(path.endsWith('.wasm')?model.wasm.url:'./'+path,self.location.href).href,
        noInitialRun:true,
        print:()=>{},printErr:()=>{},
        onRuntimeInitialized:resolveReady,
        onAbort:message=>reject(new Error('模型初始化失敗：'+message)),
      };
      importScripts(new URL(model.api,self.location.href).href);
      importScripts(new URL(model.runtime,self.location.href).href);
    });
    const samples=new Float32Array(audio),duration=samples.length/sampleRate;
    let loadedAt=performance.now();
    if(kind==='asr') {
      const recognizer=new OfflineRecognizer({
        featConfig:{sampleRate,featureDim:80},
        modelConfig:{senseVoice:{model:'./sense-voice.onnx',language:'yue',useInverseTextNormalization:1},tokens:'./tokens.txt',numThreads:1,debug:0,provider:'cpu'},
        decodingMethod:'greedy_search',
      },Module);
      if(!recognizer.handle)throw new Error('粵語模型未能啟動。');
      loadedAt=performance.now();
      const ranges=makeChunkRanges(samples.length,sampleRate);
      for(let i=0;i<ranges.length;i++) {
        const range=ranges[i],slice=samples.subarray(range.start,range.end);
        if(!isDigitalSilence(slice)) {
          const stream=recognizer.createStream();
          try {
            stream.acceptWaveform(sampleRate,slice);recognizer.decode(stream);
            const result=recognizer.getResult(stream);
            const tokens=result.tokens ?? [...(result.text ?? '')];
            const aligned=Array.isArray(result.timestamps) && result.timestamps.length===tokens.length;
            const rawTimes=aligned?result.timestamps:tokens.map((_,n)=>n*(range.end-range.start)/sampleRate/Math.max(1,tokens.length));
            const kept=[];
            for(let j=0;j<tokens.length;j++) {
              const timestamp=Number(rawTimes[j])+range.start/sampleRate;
              if(timestamp>=range.keepStart/sampleRate && timestamp<range.keepEnd/sampleRate)kept.push([tokens[j],timestamp]);
            }
            if(kept.length)self.postMessage({type:'chunk',chunk:{tokens:kept.map(x=>x[0]),timestamps:kept.map(x=>x[1]),start:range.keepStart/sampleRate,end:range.keepEnd/sampleRate,approximate:!aligned}});
          } finally {stream.free();}
        }
        self.postMessage({type:'progress',phase:'transcribing',message:`轉錄 ${i+1} / ${ranges.length} 段`,progress:100*(i+1)/ranges.length,processedSeconds:range.keepEnd/sampleRate});
        await new Promise(r=>setTimeout(r,0));
      }
      recognizer.free();
      const result={type:'asr-done',duration,metrics:{loadMs:loadedAt-begin,inferenceMs:performance.now()-loadedAt}};
      if(speakers>1){result.audio=samples.buffer;self.postMessage(result,[samples.buffer]);}
      else self.postMessage(result);
    } else {
      self.postMessage({type:'progress',phase:'speakers',message:'文字已完成；分辨講者中，可隨時停止並保留文字',progress:null});
      const diarizer=createOfflineSpeakerDiarization(Module,{
        segmentation:{pyannote:{model:'./segmentation.onnx',windowShiftRatio:.5},numThreads:1,debug:0,provider:'cpu'},
        embedding:{model:'./embedding.onnx',numThreads:1,debug:0,provider:'cpu'},
        clustering:{numClusters:speakers,threshold:.5},minDurationOn:.3,minDurationOff:.4,
      });
      if(!diarizer.handle)throw new Error('講者模型未能啟動。');
      loadedAt=performance.now();
      const turns=diarizer.process(samples);diarizer.free();
      self.postMessage({type:'speaker-done',turns,metrics:{loadMs:loadedAt-begin,inferenceMs:performance.now()-loadedAt}});
    }
  } catch(error) {
    self.postMessage({type:'error',message:/memory|allocation|out of bounds|OOM/i.test(String(error))?'此裝置記憶體不足。已完成文字會保留；可關閉其他分頁，或改用電腦處理。':String(error.message||error)});
  }
};
