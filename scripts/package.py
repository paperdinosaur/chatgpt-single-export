"""Build an allowlisted, self-contained extension ZIP without private data."""
import hashlib
import json
from pathlib import Path
import zipfile

root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'extension/manifest.json').read_text(encoding='utf-8-sig'))
version=manifest['version']
assert manifest['permissions']==['activeTab','scripting']
assert 'host_permissions' not in manifest
extension=['manifest.json','background.mjs','collector.mjs','core.mjs','export.html','export.mjs','style.css']
files=[Path('extension')/n for n in extension]+[Path(n) for n in ['README.md','PRIVACY.md','LICENSE','CHANGELOG.md']]
output=root/'dist'/f'chatgpt-single-export-v{version}.zip'
output.parent.mkdir(exist_ok=True)
prefix=f'chatgpt-single-export-v{version}'
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for relative in files:
  data=(root/relative).read_bytes()
  for marker in [b'key.dpapi',b'archive.sqlite3',b'LOCALAPPDATA',b'luoqingru2017-blip/SECRET',b'gho_',b'ghp_',b'-----BEGIN PRIVATE KEY-----']:
   assert marker not in data, f'Unexpected private marker in {relative}'
  z.writestr(prefix+'/'+relative.as_posix(),data)
with zipfile.ZipFile(output) as z:
 assert z.testzip() is None
 assert len(z.namelist())==len(files)
 assert set(z.namelist())=={prefix+'/'+f.as_posix() for f in files}
checksum=hashlib.sha256(output.read_bytes()).hexdigest()
(output.parent/'SHA256SUMS.txt').write_text(f'{checksum}  {output.name}\n',encoding='utf-8')
print(json.dumps({'version':version,'files':len(files),'bytes':output.stat().st_size,'sha256':checksum,'zip_integrity':'passed','allowlist':'passed'}))
