import test from 'node:test';
import assert from 'node:assert/strict';
import { makeChunkRanges, makeLines, isDigitalSilence } from '../web/engine-core.mjs';
import { loadVerifiedParts } from '../web/model-cache.mjs';
import { TranscriptionSession } from '../web/transcription-session.mjs';

test('two-hour audio is fully covered in bounded chunks including its final sample', () => {
  const length = 115200017;
  const ranges = makeChunkRanges(length, 16000);
  assert.equal(ranges[0].keepStart, 0);
  assert.equal(ranges.at(-1).keepEnd, length);
  for (let i = 0; i < ranges.length; i++) {
    assert.ok(ranges[i].end - ranges[i].start <= 249600);
    assert.ok(ranges[i].start <= ranges[i].keepStart);
    assert.ok(ranges[i].end >= ranges[i].keepEnd);
    if (i) assert.equal(ranges[i].keepStart, ranges[i - 1].keepEnd);
  }
});
test('very short audio and invalid sample rates have explicit behavior', () => {
  assert.deepEqual(makeChunkRanges(100, 16000), [{start: 0, end: 100, keepStart: 0, keepEnd: 100}]);
  assert.throws(() => makeChunkRanges(100, 0));
});
test('silence shortcut never removes nonzero quiet speech', () => {
  assert.equal(isDigitalSilence(new Float32Array(32000)), true);
  assert.equal(isDigitalSilence(new Float32Array([0, 0.00000001, 0])), false);
});
test('speaker boundaries preserve Cantonese tokens and timeline', () => {
  const chunks = [{tokens:['我','唔','系','嗯'],timestamps:[.1,.3,.5,1.3],end:1.8}];
  const rows = makeLines(chunks, [{start:0,end:1,speaker:4},{start:1,end:2,speaker:8}]);
  assert.deepEqual(rows.map(r => [r.line,r.speaker,r.text]), [[1,'講者 A','我唔係'],[2,'講者 B','嗯']]);
  assert.equal(rows.at(-1).end, 1.7);
});
test('text-only output does not invent speakers or mix overlapping voices', () => {
  const chunks = [{tokens:['好'],timestamps:[1],end:2}];
  assert.equal(makeLines(chunks,[])[0].speaker,'講者');
  assert.match(makeLines(chunks,[{start:0,end:2,speaker:0},{start:0,end:2,speaker:1}])[0].speaker,/重疊/);
});

const helloHash = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const part = {url:'https://example.test/model.part',bytes:5,sha256:helloHash};
function memoryCache(initial) {
  let value = initial;
  return {
    open:async () => ({match:async () => value?.clone(),put:async (_,response) => {value=response.clone();},delete:async () => {value=null;}}),
  };
}
test('valid cached model avoids network and assembles correct bytes', async () => {
  const result=await loadVerifiedParts([part],{cacheStorage:memoryCache(new Response('hello')),fetchImpl:async()=>{throw new Error('network should not be required');}});
  assert.equal(new TextDecoder().decode(result),'hello');
});
test('corrupt cache is replaced with verified network data', async () => {
  let requests=0;
  const result=await loadVerifiedParts([part],{cacheStorage:memoryCache(new Response('xxxxx')),fetchImpl:async()=>{requests++;return new Response('hello');}});
  assert.equal(new TextDecoder().decode(result),'hello');
  assert.equal(requests,1);
});
test('bad model download is rejected before inference', async () => {
  await assert.rejects(loadVerifiedParts([part],{cacheStorage:null,fetchImpl:async()=>new Response('wrong')}),/完整性/);
});
test('storage quota failure still permits local inference', async () => {
  const cacheStorage={open:async()=>({match:async()=>null,put:async()=>{throw new Error('quota');}})};
  assert.equal(new TextDecoder().decode(await loadVerifiedParts([part],{cacheStorage,fetchImpl:async()=>new Response('hello')})),'hello');
});
test('cancelled model load does not fetch anything', async () => {
  const c=new AbortController();c.abort();
  await assert.rejects(loadVerifiedParts([part],{signal:c.signal,cacheStorage:null,fetchImpl:async()=>{throw new Error('must not fetch');}}),{name:'AbortError'});
});

class WorkerStub {
  constructor(kind,events){this.kind=kind;this.events=events;this.terminated=false;}
  postMessage(message){this.sent=message;}
  terminate(){this.terminated=true;this.events.push('terminate '+this.kind);}
  emit(data){this.onmessage({data});}
}
test('ASR is released before speaker analysis and interim text is retained', async () => {
  const workers=[],events=[];let partial,complete;
  const session=new TranscriptionSession({workerFactory:kind=>{events.push('create '+kind);const w=new WorkerStub(kind,events);workers.push(w);return w;},onPartial:chunks=>partial=chunks,onComplete:result=>complete=result});
  session.start(new Float32Array(16000).buffer,2);
  workers[0].emit({type:'chunk',chunk:{text:'你好',tokens:['你','好'],timestamps:[0,.2],end:1}});
  assert.equal(partial.length,1);
  workers[0].emit({type:'asr-done',audio:new Float32Array(16000).buffer,duration:1});
  await new Promise(r=>setTimeout(r,30));
  assert.deepEqual(events.slice(0,3),['create transcribe','terminate transcribe','create speakers']);
  workers[1].emit({type:'speaker-done',turns:[{start:0,end:1,speaker:0}]});
  assert.equal(complete.chunks[0].text,'你好');
  assert.equal(complete.turns[0].speaker,0);
});
test('cancel retains completed text and ignores late worker messages', () => {
  const workers=[];let complete,updates=0;
  const session=new TranscriptionSession({workerFactory:kind=>{const w=new WorkerStub(kind,[]);workers.push(w);return w;},onPartial:()=>updates++,onComplete:r=>complete=r});
  session.start(new Float32Array(32000).buffer,2);
  workers[0].emit({type:'chunk',chunk:{tokens:['好'],timestamps:[0],end:1}});
  session.cancel();
  workers[0].emit({type:'chunk',chunk:{tokens:['舊'],timestamps:[1],end:2}});
  assert.equal(workers[0].terminated,true);
  assert.equal(complete.cancelled,true);
  assert.equal(complete.chunks.length,1);
  assert.equal(updates,1);
});
test('single-speaker mode skips the costly diarization model', () => {
  const workers=[];let complete;
  const session=new TranscriptionSession({workerFactory:kind=>{const w=new WorkerStub(kind,[]);workers.push(w);return w;},onComplete:r=>complete=r});
  session.start(new Float32Array(16000).buffer,1);
  workers[0].emit({type:'chunk',chunk:{tokens:['好'],timestamps:[0],end:1}});
  workers[0].emit({type:'asr-done',duration:1});
  assert.equal(workers.length,1);
  assert.deepEqual(complete.turns,[{start:0,end:1,speaker:0}]);
});
