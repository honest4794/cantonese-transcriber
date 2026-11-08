import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Fbank,stackSenseVoice,subtractMean} from '../web/audio-features.mjs';
import {decodeCtc,clusterEmbeddings,segmentationRanges,speakerSamples,speakerTurns} from '../web/gpu-engine.mjs';

const golden=JSON.parse(readFileSync(new URL('./fixtures/fbank-golden.json',import.meta.url)));
for(const fixture of golden.cases) test(`${fixture.window} features match independent Kaldi reference including edge frames`,()=>{
 const samples=Float32Array.from({length:1600},(_,i)=>Math.sin(i*.031)*.3+Math.cos(i*.073)*.05+(i%29-14)/1000);
 const actual=new Fbank(fixture).process(samples);
 assert.equal(actual.frames,fixture.frames);
 for(const row of fixture.rows)for(let j=0;j<80;j++)assert.ok(Math.abs(actual.features[row.index*80+j]-row.values[j])<.002,`frame ${row.index}, bin ${j}: ${actual.features[row.index*80+j]} != ${row.values[j]}`);
});
test('LFR pads first and last frames and applies CMVN without losing a short tail',()=>{
 const data=new Float32Array(160);data.fill(100,80);
 const result=stackSenseVoice({features:data,frames:2},{means:new Float32Array(560).fill(1),scales:new Float32Array(560).fill(2)});
 assert.equal(result.frames,1);assert.equal(result.features.length,560);
 assert.deepEqual([0,80,160,240,320,400,480].map(i=>result.features[i]),[2,2,2,2,202,202,202]);
});
test('very short audio has finite features and empty audio stays empty',()=>{
 assert.equal(new Fbank().process(new Float32Array()).frames,0);
 const result=new Fbank().process(Float32Array.of(.0000001));
 assert.ok(result.features.every(Number.isFinite));
});
test('speaker features remove each frequency mean rather than the whole matrix mean',()=>{
 const a=Float32Array.of(1,10,3,20);subtractMean(a,2,2);
 assert.deepEqual([...a],[-1,-5,1,5]);
});
test('CTC removes prompt frames, collapses repeats and retains original timeline boundaries',()=>{
 const ids=BigInt64Array.from([8,9,10,11,1,1,0,1,2,2],BigInt);
 const chunk=decodeCtc(ids,['','甲','▁word'],{start:10,keepStart:10.1,keepEnd:10.3});
 assert.deepEqual(chunk.tokens,['甲',' word']);
 assert.deepEqual(chunk.timestamps,[10.18,10.24]);
 assert.equal(chunk.end,10.3);
});
test('clustering cuts the globally closest merge even when another reciprocal pair is discovered first',()=>{
 const angle=Math.PI/180;
 const labels=clusterEmbeddings([[1,0],[Math.cos(10*angle),Math.sin(10*angle)],[0,1],[-Math.sin(angle),Math.cos(angle)]],3);
 assert.equal(labels[2],labels[3]);assert.notEqual(labels[0],labels[1]);
});
test('speaker clustering groups similar voices irrespective of amplitude and input order',()=>{
 const labels=clusterEmbeddings([[1,0],[0,2],[.99,.01],[.01,.99]],2);
 assert.equal(labels[0],labels[2]);assert.equal(labels[1],labels[3]);assert.notEqual(labels[0],labels[1]);
 assert.deepEqual(clusterEmbeddings([],2),[]);
 assert.deepEqual(clusterEmbeddings([[1,0]],2),[0]);
});
test('segmentation covers a non-integral tail and never creates an empty final task',()=>{
 assert.deepEqual(segmentationRanges(160001).map(r=>r.start),[0,80000]);
 assert.deepEqual(segmentationRanges(240000).map(r=>r.start),[0,80000]);
 assert.deepEqual(segmentationRanges(100).map(r=>r.start),[0]);
});
test('speaker embedding samples exclude overlaps and padded audio',()=>{
 const samples=Float32Array.from({length:160000},(_,i)=>i);
 const mask=new Uint8Array(100);mask.fill(1,0,25);mask.fill(3,25,75);mask.fill(2,75);
 const chunks=[{start:0,labels:mask}];
 const parts=speakerSamples(samples,chunks);
 assert.equal(parts.length,2);
 assert.ok(parts[0].samples.every(x=>x<40000));
 assert.ok(parts[1].samples.every(x=>x>=120000));
});
test('speaker timeline retains overlaps and clamps the final padded segment to the audio',()=>{
 const chunk={start:0,labels:Uint8Array.from({length:589},(_,i)=>i<300?1:3)};
 const entries=[{chunk:0,local:0},{chunk:0,local:1}];
 const turns=speakerTurns([chunk],entries,[0,1],9.2,2);
 assert.equal(turns.length,2);assert.equal(turns[0].speaker,0);assert.equal(turns[1].speaker,1);
 assert.ok(turns[0].end<=9.2&&turns[1].end<=9.2);
 assert.ok(turns[0].end>turns[1].start);
});
test('fast segmentation still covers every sample and its non-integral final window',()=>{
 const ranges=segmentationRanges(320001,160000);
 assert.deepEqual(ranges,[{start:0,end:160000},{start:160000,end:320000},{start:320000,end:320001}]);
});
test('bounded speaker samples select genuine middle speech without padding or mixing overlapping voices',()=>{
 const samples=Float32Array.from({length:160000},(_,i)=>i),labels=new Uint8Array(100).fill(1);
 const result=speakerSamples(samples,[{start:0,labels}],{maxSamples:48000});
 assert.equal(result[0].samples.length,48000);
 assert.equal(result[0].samples[0],56000);assert.equal(result[0].samples.at(-1),103999);
});
