"""開發用：重現 GPU 半精度權重包；正常使用者毋須安裝 Python。"""
from pathlib import Path
import argparse, hashlib, json, shutil

ROOT=Path(__file__).resolve().parents[1]
SOURCE='https://huggingface.co/ysdede/sensevoice-small-onnx/resolve/b6c40945d2759130ea312d14f92ddad079ba7933/model.onnx'
SOURCE_SHA256='8fc794f08c390ce26f0c8878904a2e0a63214faaa53e2354245a50c0d2b65700'

def asset(path):
    return {'url':'./'+str(path.relative_to(ROOT/'web')),'bytes':path.stat().st_size,'sha256':hashlib.file_digest(path.open('rb'),'sha256').hexdigest()}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--cmvn',type=Path,required=True)
    parser.add_argument('--vocab',type=Path,required=True)
    parser.add_argument('--ort-dir',type=Path,required=True)
    args=parser.parse_args()
    import numpy as np,onnx
    from onnx import helper,numpy_helper,TensorProto
    source_sha=hashlib.file_digest(args.source.open('rb'),'sha256').hexdigest()
    assert source_sha==SOURCE_SHA256,'來源模型與固定版本不符'
    def store_half(model):
        casts=[]
        for tensor in model.graph.initializer:
            if tensor.data_type!=TensorProto.FLOAT:continue
            name=tensor.name
            tensor.CopyFrom(numpy_helper.from_array(numpy_helper.to_array(tensor).astype(np.float16),name+'__half'))
            casts.append(helper.make_node('Cast',[name+'__half'],[name],to=TensorProto.FLOAT,name=name+'__restore'))
        nodes=list(model.graph.node);del model.graph.node[:];model.graph.node.extend(casts+nodes)
        del model.graph.value_info[:]
        return model
    model=store_half(onnx.load(args.source))
    model.graph.node.append(helper.make_node('ArgMax',['ctc_logits'],['token_ids'],axis=2,keepdims=0))
    del model.graph.output[:]
    model.graph.output.append(helper.make_tensor_value_info('token_ids',TensorProto.INT64,[1,'T']))
    data=model.SerializeToString();dest=ROOT/'web/assets/gpu-sensevoice-2026-11-08';dest.mkdir(parents=True,exist_ok=True)
    parts=[]
    for index,start in enumerate(range(0,len(data),48*1024*1024)):
        path=dest/f'model-{index:02}.bin';path.write_bytes(data[start:start+48*1024*1024]);parts.append(asset(path))
    text=args.cmvn.read_text()
    def vector(marker):
        section=text[text.index('<'+marker+'>'):];return [float(x) for x in section[section.index('[')+1:section.index(']')].split()]
    means,scales=vector('AddShift'),vector('Rescale');assert len(means)==len(scales)==560
    cmvn=dest/'cmvn.json';cmvn.write_text(json.dumps({'means':means,'scales':scales})+'\n')
    vocab=dest/'vocab.json';tokens={}
    for line in args.vocab.read_text().splitlines():
        token,index=line.rsplit(' ',1);tokens[int(index)]=token
    vocab.write_text(json.dumps([tokens[i] for i in range(len(tokens))],ensure_ascii=False)+'\n')
    vendor=ROOT/'web/vendor/ort-1.29.0';vendor.mkdir(parents=True,exist_ok=True);resources=[]
    for name in ['ort.webgpu.min.mjs','ort.wasm.min.mjs','ort-wasm-simd-threaded.asyncify.mjs','ort-wasm-simd-threaded.asyncify.wasm','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']:
        path=vendor/name;shutil.copyfile(args.ort_dir/name,path);resources.append(asset(path))
    manifest_path=ROOT/'web/models.json';manifest=json.loads(manifest_path.read_text())
    speaker_package=b''.join((ROOT/'web'/part['url']).read_bytes() for part in manifest['models']['speakers']['data'])
    assert hashlib.sha256(speaker_package).hexdigest()==manifest['models']['speakers']['dataSha256']
    speaker_model=store_half(onnx.load_from_string(speaker_package[1011:39594772]))
    dims=speaker_model.graph.input[0].type.tensor_type.shape.dim;dims[0].dim_value=8;dims[1].dim_value=300
    speaker_model.graph.output[0].type.tensor_type.shape.dim[0].dim_value=8
    speaker_path=dest/'embedding-00.bin';speaker_path.write_bytes(speaker_model.SerializeToString())
    manifest['gpu']={'version':3,'source':SOURCE,'sourceSha256':source_sha,'onnxRuntimeVersion':'1.29.0','precision':'fp16 weights / fp32 computation','asrBatch':1,'speakerBatch':8,'speakerMaxSamples':48000,'segmentationShiftSamples':160000,'model':{'parts':parts,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()},'embedding':asset(speaker_path),'cmvn':asset(cmvn),'vocab':asset(vocab),'runtime':resources}
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print('GPU model packaged:',len(data),'bytes in',len(parts),'parts; ORT 1.29.0')

if __name__=='__main__':main()
