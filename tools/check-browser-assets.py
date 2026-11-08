"""Verify the exact static model files that GitHub Pages will publish."""
from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parents[1]/'web';manifest=json.loads((root/'models.json').read_text());total=0
for kind,model in manifest['models'].items():
 combined=hashlib.sha256();model_size=0
 for asset in [model['wasm'],*model['data']]:
  path=(root/asset['url']).resolve()
  assert path.is_relative_to(root.resolve()),asset['url']
  assert path.is_file(),f'Missing asset: {path.name}'
  assert path.stat().st_size==asset['bytes']<=50*1024*1024,asset['url']
  with path.open('rb') as f:assert hashlib.file_digest(f,'sha256').hexdigest()==asset['sha256'],asset['url']
  total+=asset['bytes']
  if asset is not model['wasm']:
   with path.open('rb') as f:
    while block:=f.read(1024*1024):combined.update(block)
   model_size+=asset['bytes']
 assert model_size==model['dataBytes'] and combined.hexdigest()==model['dataSha256'],kind
 print(kind,'verified:',model_size,'model bytes; all parts below 50 MiB')
if gpu:=manifest.get('gpu'):
 combined=hashlib.sha256();size=0
 for part in gpu['model']['parts']:
  path=root/part['url'];assert path.stat().st_size==part['bytes']<=50*1024*1024
  data=path.read_bytes();assert hashlib.sha256(data).hexdigest()==part['sha256'];combined.update(data);size+=len(data)
 assert size==gpu['model']['bytes'] and combined.hexdigest()==gpu['model']['sha256']
 for part in [gpu['cmvn'],gpu['vocab'],gpu['embedding'],*gpu['runtime']]:
  path=root/part['url'];assert path.stat().st_size==part['bytes']<=50*1024*1024
  with path.open('rb') as f:assert hashlib.file_digest(f,'sha256').hexdigest()==part['sha256']
 total+=size+sum(p['bytes'] for p in [gpu['cmvn'],gpu['vocab'],gpu['embedding'],*gpu['runtime']])
 print('GPU model and runtime verified:',size,'model bytes')
site_size=sum(p.stat().st_size for p in root.rglob('*') if p.is_file())
assert site_size<1_000_000_000,'Published site exceeds Pages 1GB limit'
print('All browser runtime/model assets verified:',total,'bytes; site:',site_size,'bytes')
