/** Owns one inference Worker at a time and discards stale messages after cancel. */
export class TranscriptionSession {
  constructor({workerFactory,onPartial=()=>{},onComplete=()=>{},onProgress=()=>{},onError=()=>{}}) {
    Object.assign(this,{workerFactory,onPartial,onComplete,onProgress,onError});
    this.generation=0;this.worker=null;this.chunks=[];this.phase='idle';this.textComplete=false;
  }
  start(audio,speakers,{preferGpu=false}={}) {
    this.worker?.terminate();this.generation++;this.chunks=[];this.speakers=speakers;this.phase='transcribe';this.textComplete=false;this.resumeSeconds=0;this.metrics={};this.engine=preferGpu?'gpu':'wasm';this.recoveryAudio=null;
    if(preferGpu){try{this.recoveryAudio=audio.slice(0);}catch{this.engine='wasm';}}
    this.launch('transcribe',audio,this.generation);
  }
  launch(kind,audio,generation) {
    if(generation!==this.generation)return;
    let worker;
    try {worker=this.workerFactory(kind,this.engine);} catch {
      this.recoverOrFail('未能啟動瀏覽器背景運算，已完成文字會保留。請重新嘗試或更新瀏覽器。');return;
    }
    this.worker=worker;this.phase=kind;
    worker.onmessage=async event=>{
      if(generation!==this.generation || this.worker!==worker)return;
      const data=event.data;
      if(data.type==='progress'){
        if(kind==='transcribe'&&Number.isFinite(data.processedSeconds))this.resumeSeconds=Math.max(this.resumeSeconds,data.processedSeconds);
        this.onProgress(data);
      }
      if(data.type==='chunk'){this.chunks.push(data.chunk);this.resumeSeconds=Math.max(this.resumeSeconds,data.chunk.end||0);this.onPartial([...this.chunks]);}
      if(data.type==='error'){this.recoverOrFail(data.message);return;}
      if(data.type==='asr-done') {
        if(!this.chunks.some(c=>c.tokens.length)){this.recoverOrFail('未能辨識到說話內容，請檢查錄音。');return;}
        this.metrics.asr=data.metrics;
        this.textComplete=true;
        this.onProgress({phase:'text-done',metrics:data.metrics,message:'文字已完成'});
        if(data.continueSpeakers&&this.speakers>1){this.phase='speakers';return;}
        worker.terminate();this.worker=null;
        if(this.speakers>1) {
          await new Promise(r=>setTimeout(r,0));
          this.launch('speakers',data.audio,generation);
        } else this.complete(this.speakers===1 ? [{start:0,end:data.duration,speaker:0}] : []);
      }
      if(data.type==='speaker-done'){this.metrics.speakers=data.metrics;this.complete(data.turns);}
    };
    worker.onerror=event=>{
      if(generation===this.generation && this.worker===worker)this.recoverOrFail(/memory|allocation|out of bounds|OOM/i.test(event.message) ? '此裝置記憶體不足。已完成文字會保留；可先關閉其他分頁，或改用電腦處理。' : '瀏覽器模型執行失敗，已保留完成的文字；請重新嘗試。');
    };
    try {worker.postMessage({type:kind,audio,speakers:this.speakers,resumeSeconds:this.resumeSeconds},[audio]);} catch {
      this.recoverOrFail('未能將音訊交給瀏覽器背景運算，已完成文字會保留。請重新嘗試。');
    }
  }
  recoverOrFail(message) {
    if(this.engine==='gpu'&&this.recoveryAudio){
      this.worker?.terminate();this.worker=null;this.engine='wasm';
      const audio=this.recoveryAudio;this.recoveryAudio=null;
      const kind=this.textComplete?'speakers':'transcribe';
      this.onProgress({phase:'recovering',message:'GPU 未能繼續，已保留文字並自動改用 CPU',progress:null});
      this.launch(kind,audio,this.generation);return;
    }
    this.fail(message);
  }
  complete(turns) {
    this.worker?.terminate();this.worker=null;this.recoveryAudio=null;this.generation++;this.phase='done';
    this.onComplete({chunks:[...this.chunks],turns,cancelled:false,metrics:this.metrics});
  }
  cancel() {
    const textComplete=this.textComplete;
    this.worker?.terminate();this.worker=null;this.recoveryAudio=null;this.generation++;this.phase='cancelled';
    this.onComplete({chunks:[...this.chunks],turns:[],cancelled:true,textComplete});
  }
  fail(message) {
    this.worker?.terminate();this.worker=null;this.recoveryAudio=null;this.generation++;this.phase='error';
    this.onError(message,[...this.chunks]);
  }
}
