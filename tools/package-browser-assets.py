"""Package verified official release bundles into Pages-compatible static parts.
Run after downloading/extracting the release archives named in SOURCE_BUNDLES.
Normal users only open the published website; they do not run this script.
"""
import hashlib,json,shutil,tarfile
from pathlib import Path
root=Path(__file__).resolve().parents[1];web=root/'web';src=root/'.runtime/browser-assets'
configs={
 'asr': {'folder':'asr','version':'1.12.35','stem':'sherpa-onnx-wasm-main-vad-asr','api':'sherpa-onnx-asr.js'},
 'speakers': {'folder':'speaker-new','version':'1.13.7','stem':'sherpa-onnx-wasm-main-speaker-diarization','api':'sherpa-onnx-speaker-diarization.js'},
}
manifest={'version':2,'sampleRate':16000,'models':{}}
for kind,config in configs.items():
 folder=src/config['folder'];target=web/'assets'/f"{kind}-{config['version']}";target.mkdir(parents=True,exist_ok=True)
 runtime_name=f'{kind}-runtime.js';api_name=f'{kind}-api.js'
 shutil.copyfile(folder/(config['stem']+'.js'),web/'vendor'/runtime_name)
 shutil.copyfile(folder/config['api'],web/'vendor'/api_name)
 def descriptor(path):
  return {'url':'./'+path.relative_to(web).as_posix(),'bytes':path.stat().st_size,'sha256':hashlib.file_digest(path.open('rb'),'sha256').hexdigest()}
 wasm=target/'runtime.wasm';shutil.copyfile(folder/(config['stem']+'.wasm'),wasm)
 data=folder/(config['stem']+'.data');parts=[]
 with data.open('rb') as f:
  i=0
  while block:=f.read(48*1024*1024):
   path=target/f'model-{i:02d}.bin';path.write_bytes(block);parts.append(descriptor(path));i+=1
 manifest['models'][kind]={'runtime':'./vendor/'+runtime_name,'api':'./vendor/'+api_name,'wasm':descriptor(wasm),'data':parts,'dataName':config['stem']+'.data','dataBytes':data.stat().st_size,'dataSha256':hashlib.file_digest(data.open('rb'),'sha256').hexdigest(),'sherpaVersion':config['version']}
with tarfile.open(root/'.runtime/opencc-js-1.4.2.tgz') as package:
 (web/'vendor/opencc.mjs').write_bytes(package.extractfile('package/dist/esm/cn2t.js').read())
 (web/'vendor/opencc-LICENSE.txt').write_bytes(package.extractfile('package/LICENSE').read())
(web/'models.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('Packaged assets',sum(p.stat().st_size for p in (web/'assets').rglob('*') if p.is_file()),'bytes')
print('Maximum individual asset',max(p.stat().st_size for p in (web/'assets').rglob('*') if p.is_file()),'bytes')
