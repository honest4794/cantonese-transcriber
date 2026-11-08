let session,ort;
self.onmessage=async({data})=>{
 try {
  if(data.type==='init'){
   ort=await import('./vendor/ort-1.29.0/ort.wasm.min.mjs');
   ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=new URL('./vendor/ort-1.29.0/',self.location.href).href;
   if(data.wasm)ort.env.wasm.wasmBinary=new Uint8Array(data.wasm);
   session=await ort.InferenceSession.create(new Uint8Array(data.model),{executionProviders:['wasm']});
   self.postMessage({type:'ready'});
  }else if(data.type==='run'){
   const input=new ort.Tensor('float32',new Float32Array(data.audio),[1,1,160000]);let outputs;
   try {
    outputs=await session.run({x:input});const tensor=outputs.y,values=tensor.data,frames=tensor.dims[1],labels=new Uint8Array(frames),powers=[0,1,2,4,3,5,6];
    for(let t=0;t<frames;t++){let best=0;for(let c=1;c<7;c++)if(values[t*7+c]>values[t*7+best])best=c;labels[t]=powers[best];}
    self.postMessage({type:'result',index:data.index,labels},[labels.buffer]);
   }finally{input.dispose();for(const value of Object.values(outputs||{}))value.dispose();}
  }
 }catch(error){self.postMessage({type:'error',message:String(error.message||error)});}
};
