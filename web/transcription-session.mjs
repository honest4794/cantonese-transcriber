/** Owns one inference Worker at a time and discards stale messages after cancel. */
export class TranscriptionSession {
  constructor({workerFactory,onPartial=()=>{},onComplete=()=>{},onProgress=()=>{},onError=()=>{}}) {
    Object.assign(this,{workerFactory,onPartial,onComplete,onProgress,onError});
    this.generation=0;this.worker=null;this.chunks=[];this.phase='idle';this.textComplete=false;
  }
  start(audio,speakers) {
    this.worker?.terminate();this.generation++;this.chunks=[];this.speakers=speakers;this.phase='transcribe';this.textComplete=false;
    this.launch('transcribe',audio,this.generation);
  }
  launch(kind,audio,generation) {
    if(generation!==this.generation)return;
    let worker;
    try {worker=this.workerFactory(kind);} catch {
      this.fail('未能啟動瀏覽器背景運算，已完成文字會保留。請重新嘗試或更新瀏覽器。');return;
    }
    this.worker=worker;this.phase=kind;
    worker.onmessage=async event=>{
      if(generation!==this.generation || this.worker!==worker)return;
      const data=event.data;
      if(data.type==='progress')this.onProgress(data);
      if(data.type==='chunk'){this.chunks.push(data.chunk);this.onPartial([...this.chunks]);}
      if(data.type==='error')this.fail(data.message);
      if(data.type==='asr-done') {
        worker.terminate();this.worker=null;
        this.textComplete=true;
        this.onProgress({phase:'text-done',metrics:data.metrics,message:'文字已完成'});
        if(!this.chunks.some(c=>c.tokens.length)){this.fail('未能辨識到說話內容，請檢查錄音。');return;}
        if(this.speakers>1) {
          await new Promise(r=>setTimeout(r,0));
          this.launch('speakers',data.audio,generation);
        } else this.complete(this.speakers===1 ? [{start:0,end:data.duration,speaker:0}] : []);
      }
      if(data.type==='speaker-done')this.complete(data.turns);
    };
    worker.onerror=event=>{
      if(generation===this.generation && this.worker===worker)this.fail(/memory|allocation|out of bounds|OOM/i.test(event.message) ? '此裝置記憶體不足。已完成文字會保留；可先關閉其他分頁，或改用電腦處理。' : '瀏覽器模型執行失敗，已保留完成的文字；請重新嘗試。');
    };
    try {worker.postMessage({type:kind,audio,speakers:this.speakers},[audio]);} catch {
      this.fail('未能將音訊交給瀏覽器背景運算，已完成文字會保留。請重新嘗試。');
    }
  }
  complete(turns) {
    this.worker?.terminate();this.worker=null;this.generation++;this.phase='done';
    this.onComplete({chunks:[...this.chunks],turns,cancelled:false});
  }
  cancel() {
    const textComplete=this.textComplete;
    this.worker?.terminate();this.worker=null;this.generation++;this.phase='cancelled';
    this.onComplete({chunks:[...this.chunks],turns:[],cancelled:true,textComplete});
  }
  fail(message) {
    this.worker?.terminate();this.worker=null;this.generation++;this.phase='error';
    this.onError(message,[...this.chunks]);
  }
}
