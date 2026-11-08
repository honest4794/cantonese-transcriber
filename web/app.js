import {exportTranscript,timestamp} from './exports.mjs';
import {makeLines} from './engine-core.mjs';
import {TranscriptionSession} from './transcription-session.mjs?v=gpu-v1';
import {MODEL_CACHE} from './model-cache.mjs';

const $=id=>document.getElementById(id);
// A cached v2 page can fetch the current module before its HTML is refreshed.
if(!$('timings')){
 const node=document.createElement('p');node.id='timings';node.className='timings';node.hidden=true;$('status-area').append(node);
}
// Remove old companion-server launch fragments; v2 never reads or uses tokens.
if(location.hash.includes('token='))history.replaceState(null,'',location.pathname+location.search);
let busy=false,selected=null,rows=[],audioUrl=null,renderedChunks=0,converter=text=>text,textComplete=false;
let decoding=false,cancelDecode=false,decodeGeneration=0,runStart=0,textTime=null;
let converterPromise=null;
function error(message=''){$('error').textContent=message;$('error').hidden=!message;}
function controls(){
 $('start').disabled=busy||!selected||!globalThis.Worker||!globalThis.WebAssembly;
 $('file').disabled=busy;$('speakers').disabled=busy;$('cancel').hidden=!busy;$('clear-cache').disabled=busy;
}
function duration(seconds){const s=Math.round(seconds);return s>=60?`${Math.floor(s/60)} 分 ${s%60} 秒`:`${s} 秒`;}
function status(message,progress=null){
 $('status-area').hidden=false;$('status').textContent=message;
 if(progress===null){$('progress').removeAttribute('value');$('percent').textContent='';}
 else{$('progress').value=progress;$('percent').textContent=`${Math.round(progress)}%`;}
}
function finish(){busy=false;decoding=false;$('cancel').disabled=false;controls();}
function editable(allowed){for(const node of $('lines').querySelectorAll('[data-edit]'))node.contentEditable=allowed?'plaintext-only':'false';}
function addRows(newRows){
 const fragment=document.createDocumentFragment();
 for(const row of newRows){
  row.line=rows.length+1;rows.push(row);
  const div=document.createElement('div');div.className='transcript-row';
  const number=document.createElement('span');number.className='line-number';number.textContent=row.line;
  const seek=document.createElement('button');seek.type='button';seek.className='seek';seek.textContent=timestamp(row.start).slice(0,8);seek.title='播放呢段錄音';
  seek.addEventListener('click',()=>{$('audio').currentTime=row.start;$('audio').play().catch(()=>{});});
  const speaker=document.createElement('div');speaker.className='speaker';speaker.dataset.edit='speaker';speaker.contentEditable=busy?'false':'plaintext-only';speaker.textContent=row.speaker;speaker.setAttribute('aria-label',`第 ${row.line} 行講者`);
  speaker.addEventListener('input',()=>row.speaker=speaker.textContent.trim()||'講者不確定');
  const words=document.createElement('div');words.className='words';words.dataset.edit='text';words.contentEditable=busy?'false':'plaintext-only';words.textContent=row.text;words.setAttribute('aria-label',`第 ${row.line} 行內容`);
  words.addEventListener('input',()=>row.text=words.textContent);
  div.append(number,seek,speaker,words);fragment.append(div);
 }
 $('lines').append(fragment);$('count').textContent=`${rows.length} 行`;$('result').hidden=!rows.length;
}
function replaceRows(chunks,turns){rows=[];$('lines').replaceChildren();addRows(makeLines(chunks,turns,converter));}
const session=new TranscriptionSession({
 workerFactory:(kind,engine)=>new Worker(new URL(engine==='gpu'?'./gpu-worker.js?v=loading-v1':'./inference-worker.js?v=loading-v1',import.meta.url)),
 onPartial:chunks=>{
  for(const chunk of chunks.slice(renderedChunks))addRows(makeLines([chunk],[],converter));
  renderedChunks=chunks.length;
 },
 onProgress:data=>{
  if(data.phase==='text-done'){
   textComplete=true;
   textTime=performance.now();
   $('timings').hidden=false;$('timings').textContent=`${data.metrics?.backend==='WebGPU'?'GPU':'CPU'} · 文字完成於 ${duration((textTime-runStart)/1000)}（包括模型載入）`;
   status('文字已完成；準備講者分析',null);
   $('result-note').textContent='文字已出；正在補講者標記，完成後即可修改。你亦可先下載文字。';
  }else status(data.message,data.progress??null);
 },
 onComplete:result=>{
  finish();replaceRows(result.chunks,result.turns);editable(true);
  if(result.cancelled){
   status(result.textComplete?'已停止講者分析，完整文字已保留。':'已停止，已完成嘅部分文字已保留。',null);
   $('result-note').textContent=result.textComplete?'文字已完成，尚未分辨講者；可直接修改及下載。':'未完整轉錄；以下只包含停止前已完成嘅部分。';
  }else{
   const elapsed=(performance.now()-runStart)/1000;
   status(`完成，用時 ${duration(elapsed)}`,100);
   if(textTime&&Number($('speakers').value)>1)$('timings').textContent+=` · 講者補標記 ${duration((performance.now()-textTime)/1000)}`;
   $('result-note').textContent='點時間播放錄音；文字同講者可以直接修改。自動結果仍需核對。';
  }
 },
 onError:(message,chunks)=>{finish();replaceRows(chunks,[]);editable(true);status('未能完成；已保留辨識到嘅文字。',null);error(message);$('result-note').textContent='以下係未完成嘅初稿，可先下載保存。';},
});

function select(file){
 if(!file||busy)return;
 if(!file.size)return error('呢個檔案係空白，請重新選擇。');
 selected=file;error();$('file-name').textContent=file.name;
 $('file-help').textContent=`${(file.size/1048576).toFixed(1)} MB · 點擊更換錄音`;
 if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=URL.createObjectURL(file);$('audio').src=audioUrl;
 $('result').hidden=true;$('status-area').hidden=true;$('timings').hidden=true;rows=[];$('lines').replaceChildren();controls();
}
$('file').addEventListener('change',e=>select(e.target.files[0]));
for(const name of ['dragover','dragleave','drop'])$('dropzone').addEventListener(name,e=>{e.preventDefault();$('dropzone').classList.toggle('drag',name==='dragover');if(name==='drop')select(e.dataTransfer.files[0]);});
async function convertAudio(file,generation){
 const context=new OfflineAudioContext(1,1,16000);
 const decoded=await context.decodeAudioData(await file.arrayBuffer());
 if(cancelDecode||generation!==decodeGeneration)throw new DOMException('已取消','AbortError');
 if(decoded.sampleRate!==16000)throw new Error('此瀏覽器未能以模型所需格式解碼，請更新瀏覽器或試用 WAV。');
 const mono=new Float32Array(decoded.length);
 if(decoded.numberOfChannels===1)mono.set(decoded.getChannelData(0));
 else{
  const channels=Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i));
  for(let offset=0;offset<mono.length;offset+=1048576){
   if(cancelDecode||generation!==decodeGeneration)throw new DOMException('已取消','AbortError');
   const end=Math.min(mono.length,offset+1048576);
   for(const samples of channels)for(let i=offset;i<end;i++)mono[i]+=samples[i]/channels.length;
   await new Promise(r=>setTimeout(r,0));
  }
 }
 return mono;
}
$('form').addEventListener('submit',async event=>{
 event.preventDefault();if(!selected||busy)return;
 busy=true;decoding=true;cancelDecode=false;renderedChunks=0;textTime=null;textComplete=false;runStart=performance.now();$('timings').hidden=true;const generation=++decodeGeneration;
 controls();error();rows=[];$('lines').replaceChildren();$('result').hidden=true;$('result-note').textContent='逐段顯示文字；完整處理後可修改，亦可先下載目前內容。';
 status('讀取錄音；長錄音會自動分段',null);
 try{
  if(!converterPromise)converterPromise=import('./vendor/opencc.mjs').then(({Converter})=>Converter({from:'cn',to:'hk'})).catch(err=>{converterPromise=null;throw err;});
  converter=await converterPromise;
  if(cancelDecode||generation!==decodeGeneration)throw new DOMException('已取消','AbortError');
  const audio=await convertAudio(selected,generation);
  if(cancelDecode||generation!==decodeGeneration)throw new DOMException('已取消','AbortError');
  if(!audio.length)throw new Error('錄音冇可讀取嘅音訊，請檢查檔案。');
  decoding=false;session.start(audio.buffer,Number($('speakers').value),{preferGpu:!!navigator.gpu});
 }catch(err){
  finish();
  if(err.name==='AbortError')status('已取消讀取錄音。',null);
  else{status('未能讀取錄音。',null);error(/memory|allocation|Array buffer|OOM/i.test(String(err))?'此裝置記憶體不足，請關閉其他分頁或改用電腦處理。':'無法讀取此音檔。請試用瀏覽器支援嘅 MP3、M4A 或 WAV 格式。');}
 }
});
$('cancel').addEventListener('click',()=>{
 if(decoding){cancelDecode=true;$('cancel').disabled=true;status('正在停止讀取錄音，請稍候。',null);}
 else session.cancel();
});
$('download').addEventListener('click',()=>{
 if(!rows.length)return;
 const format=$('format').value,content=exportTranscript(rows,format);
 const blob=new Blob([content],{type:format==='csv'?'text/csv;charset=utf-8':'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=(selected?.name.replace(/\.[^.]+$/,'')||'錄音')+`-粵語${!textComplete?'部分':''}逐字稿.`+format;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('clear-cache').addEventListener('click',async()=>{
 if(busy)return;
 try{await caches.delete(MODEL_CACHE);$('cache-note').textContent='已清除模型快取，下次使用會重新載入。';}
 catch{$('cache-note').textContent='此瀏覽器暫時無法管理快取，仍可直接轉錄。';}
});
window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
if(!globalThis.Worker||!globalThis.WebAssembly){$('connection').textContent='請更新瀏覽器';$('light').classList.remove('online');error('此瀏覽器未支援所需功能，請使用較新版本嘅 Chrome、Edge、Firefox 或 Safari。');}
controls();
