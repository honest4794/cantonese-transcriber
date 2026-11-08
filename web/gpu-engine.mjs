/** Preserve the four SenseVoice prompt frames and 60 ms CTC clock. */
export function decodeCtc(ids,vocab,{start,keepStart,keepEnd}) {
 const tokens=[],timestamps=[];let previous=-1;
 for(let frame=0;frame<ids.length;frame++){
  const id=Number(ids[frame]),time=start+(frame-4)*.06;
  if(id!==0&&id!==previous&&frame>=4&&time>=keepStart&&time<keepEnd){
   const token=vocab[id];
   if(token&&!token.startsWith('<')){tokens.push(token.replaceAll('▁',' '));timestamps.push(time);}
  }
  previous=id;
 }
 return {tokens,timestamps,start:keepStart,end:keepEnd,approximate:false};
}

// Complete-linkage agglomeration, matching sherpa's cosine distance policy.
// Nearest-neighbour chains keep clustering quadratic in typical long recordings.
export function clusterEmbeddings(vectors,count) {
 const n=vectors.length;if(!n)return [];
 count=Math.min(n,Math.max(1,count));
 const normalized=vectors.map(v=>{const norm=Math.hypot(...v)||1;return Float32Array.from(v,x=>x/norm);});
 const distances=new Float32Array(n*n),active=new Set(Array.from({length:n},(_,i)=>i));
 for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
  let dot=0;for(let k=0;k<normalized[i].length;k++)dot+=normalized[i][k]*normalized[j][k];
  distances[i*n+j]=distances[j*n+i]=Math.max(0,1-dot);
 }
 const chain=[],merges=[];
 while(active.size>1){
  if(!chain.length)chain.push(active.values().next().value);
  const a=chain.at(-1);let b=-1,best=Infinity;
  // Prefer the preceding chain member on ties to guarantee reciprocal pairs.
  const prior=chain.at(-2);
  if(prior!==undefined&&active.has(prior)){b=prior;best=distances[a*n+b];}
  for(const candidate of active)if(candidate!==a&&distances[a*n+candidate]<best){best=distances[a*n+candidate];b=candidate;}
  if(b===prior){
   chain.pop();chain.pop();
   for(const c of active)if(c!==a&&c!==b)distances[b*n+c]=distances[c*n+b]=Math.max(distances[a*n+c],distances[b*n+c]);
   merges.push({a,b,distance:best});active.delete(a);
  }else chain.push(b);
 }
 const parent=Array.from({length:n},(_,i)=>i);
 function find(i){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
 // Chain discovery is not global height order. Cut the sorted dendrogram,
 // rather than stopping the chain at k, which can merge the wrong voices.
 for(const {a,b} of merges.sort((x,y)=>x.distance-y.distance).slice(0,n-count))parent[find(a)]=find(b);
 const names=new Map();
 return parent.map((_,i)=>{const root=find(i);if(!names.has(root))names.set(root,names.size);return names.get(root);});
}

export function segmentationRanges(length,shiftSamples=80000) {
 if(length<=0)return [];
 const ranges=[];
 for(let start=0;;start+=shiftSamples){ranges.push({start,end:Math.min(length,start+160000)});if(start+160000>=length)break;}
 return ranges;
}

export function speakerSamples(samples,chunks,{maxSamples=Infinity}={}) {
 const entries=[];
 chunks.forEach(({start,labels},chunk)=>{
  for(let local=0;local<3;local++){
   const ranges=[];let begin=-1,frames=0;
   for(let i=0;i<=labels.length;i++){
    const sole=i<labels.length&&labels[i]===(1<<local);
    if(sole){frames++;if(begin<0)begin=i;}
    if(!sole&&begin>=0){
     const a=Math.min(samples.length,start+Math.floor(begin/labels.length*160000));
     const b=Math.min(samples.length,start+Math.floor(i/labels.length*160000));
     if(b>a)ranges.push([a,b]);begin=-1;
    }
   }
   if(frames<10)continue;
   const length=ranges.reduce((n,[a,b])=>n+b-a,0);if(length<400)continue;
   const wanted=Math.min(length,maxSamples),skip=Math.floor((length-wanted)/2),pcm=new Float32Array(wanted);let offset=0,position=0;
   for(const [a,b] of ranges){
    const left=Math.max(0,skip-position),right=Math.min(b-a,skip+wanted-position);
    if(right>left){pcm.set(samples.subarray(a+left,a+right),offset);offset+=right-left;}
    position+=b-a;
   }
   entries.push({chunk,local,samples:pcm});
  }
 });
 return entries;
}


export function speakerTurns(chunks,entries,assignments,duration,speakers) {
 const frames=Math.floor(duration*16000/270)+1;
 const votes=new Uint16Array(frames*speakers),count=new Uint16Array(frames),weight=new Uint16Array(frames);
 const mapping=new Map(entries.map((e,i)=>[`${e.chunk}:${e.local}`,assignments[i]]));
 chunks.forEach(({start,labels},index)=>{
  const offset=Math.round(start/270);
  for(let i=0;i<labels.length&&offset+i<frames;i++){
   const mask=labels[i],frame=offset+i;weight[frame]++;
   count[frame]+=(mask&1)+((mask>>1)&1)+((mask>>2)&1);
   for(let local=0;local<3;local++)if(mask&(1<<local)){
    const cluster=mapping.get(`${index}:${local}`);
    if(Number.isInteger(cluster)&&cluster>=0&&cluster<speakers)votes[frame*speakers+cluster]++;
   }
  }
 });
 const active=new Uint8Array(frames*speakers);
 for(let frame=0;frame<frames;frame++){
  const k=Math.min(speakers,Math.round(count[frame]/(weight[frame]||1)));
  const order=Array.from({length:speakers},(_,i)=>i).sort((a,b)=>votes[frame*speakers+b]-votes[frame*speakers+a]);
  for(const label of order.slice(0,k))if(votes[frame*speakers+label])active[frame*speakers+label]=1;
 }
 const turns=[],clock=270/16000,shift=991/32000;
 for(let speaker=0;speaker<speakers;speaker++){
  let begin=-1;const segments=[];
  for(let frame=0;frame<=frames;frame++){
   const on=frame<frames&&active[frame*speakers+speaker];
   if(on&&begin<0)begin=frame;
   if(!on&&begin>=0){
    const start=Math.min(duration,begin*clock+shift),end=Math.min(duration,frame*clock+shift);
    const prior=segments.at(-1);
    if(prior&&start-prior.end<.4)prior.end=end;
    else segments.push({start,end,speaker});
    begin=-1;
   }
  }
  turns.push(...segments.filter(t=>t.end-t.start>.3));
 }
 return turns.sort((a,b)=>a.start-b.start||a.speaker-b.speaker);
}
