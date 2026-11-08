// Kaldi-compatible 16 kHz fbank (dither=0), following kaldi-native-fbank's
// frame/reflection, window and mel conventions. No audio leaves this module.
const SIZE=512,WINDOW=400,HOP=160,BINS=80;
const mel=hz=>1127*Math.log(1+hz/700);

export class Fbank {
 constructor({window='hamming',snipEdges=true,highHz=8000,scale=32768}={}) {
  Object.assign(this,{snipEdges,scale});
  this.window=Float64Array.from({length:WINDOW},(_,i)=>window==='povey'?Math.pow(.5-.5*Math.cos(2*Math.PI*i/(WINDOW-1)),.85):.54-.46*Math.cos(2*Math.PI*i/(WINDOW-1)));
  this.filters=Array.from({length:BINS},(_,i)=>{
   const left=mel(20)+(mel(highHz)-mel(20))*i/(BINS+1),step=(mel(highHz)-mel(20))/(BINS+1),values=[];
   for(let bin=0;bin<SIZE/2;bin++){
    const value=Math.max(0,Math.min((mel(bin*16000/SIZE)-left)/step,(left+2*step-mel(bin*16000/SIZE))/step));
    if(value>0)values.push([bin,value]);
   }
   return values;
  });
  this.reverse=Uint16Array.from({length:SIZE},(_,n)=>{let r=0;for(let i=0;i<9;i++){r=(r<<1)|(n&1);n>>=1;}return r;});
  this.cos=Float64Array.from({length:SIZE/2},(_,i)=>Math.cos(2*Math.PI*i/SIZE));
  this.sin=Float64Array.from({length:SIZE/2},(_,i)=>-Math.sin(2*Math.PI*i/SIZE));
 }
 process(samples) {
  const n=samples.length,frames=n===0?0:Math.max(0,this.snipEdges?Math.floor((n-WINDOW)/HOP)+1:Math.floor((n+HOP/2)/HOP));
  const features=new Float32Array(frames*BINS),real=new Float64Array(SIZE),imag=new Float64Array(SIZE),frame=new Float64Array(WINDOW),power=new Float64Array(SIZE/2);
  for(let t=0;t<frames;t++){
   const start=t*HOP+(this.snipEdges?0:HOP/2-WINDOW/2);let mean=0;
   for(let i=0;i<WINDOW;i++){
    let index=start+i;
    while(index<0||index>=n)index=index<0?-index-1:2*n-1-index;
    frame[i]=samples[index]*this.scale;mean+=frame[i];
   }
   mean/=WINDOW;real.fill(0);imag.fill(0);
   for(let i=0;i<WINDOW;i++)real[this.reverse[i]]=((frame[i]-mean)-.97*(frame[Math.max(0,i-1)]-mean))*this.window[i];
   for(let length=2;length<=SIZE;length*=2){
    const half=length/2,step=SIZE/length;
    for(let offset=0;offset<SIZE;offset+=length)for(let j=0;j<half;j++){
     const a=offset+j,b=a+half,c=this.cos[j*step],s=this.sin[j*step];
     const r=real[b]*c-imag[b]*s,v=real[b]*s+imag[b]*c;
     real[b]=real[a]-r;imag[b]=imag[a]-v;real[a]+=r;imag[a]+=v;
    }
   }
   for(let i=0;i<power.length;i++)power[i]=real[i]*real[i]+imag[i]*imag[i];
   for(let bin=0;bin<BINS;bin++){
    let energy=0;for(const [i,weight] of this.filters[bin])energy+=power[i]*weight;
    features[t*BINS+bin]=Math.log(Math.max(1.1920928955078125e-7,energy));
   }
  }
  return {features,frames};
 }
}

export function stackSenseVoice({features,frames},cmvn) {
 const count=Math.ceil(frames/6),out=new Float32Array(count*560);
 for(let t=0;t<count;t++)for(let j=0;j<7;j++){
  const source=Math.max(0,Math.min(frames-1,t*6+j-3));
  for(let bin=0;bin<80;bin++){
   const d=j*80+bin;out[t*560+d]=(features[source*80+bin]+cmvn.means[d])*cmvn.scales[d];
  }
 }
 return {features:out,frames:count};
}

export function subtractMean(features,frames,width=80) {
 if(!frames)return features;
 for(let bin=0;bin<width;bin++){
  let mean=0;for(let t=0;t<frames;t++)mean+=features[t*width+bin];mean/=frames;
  for(let t=0;t<frames;t++)features[t*width+bin]-=mean;
 }
 return features;
}
