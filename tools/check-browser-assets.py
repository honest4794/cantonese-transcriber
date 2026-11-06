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
print('All browser runtime/model assets verified:',total,'bytes')
