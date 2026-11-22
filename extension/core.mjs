const encoder = new TextEncoder();
export const LIMIT = 512 * 1024 * 1024;
export function conversationId(input) {
  const u=new URL(input), m=u.pathname.match(/\/c\/([A-Za-z0-9-]+)\/?$/);
  if(u.origin!=='https://chatgpt.com'||!m)throw Error('请先打开一个已保存的 ChatGPT 对话，再点扩展图标。');
  return m[1];
}
export function safeName(value) {
  let s=String(value||'attachment').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/g,'').slice(0,110);
  if(!s||s==='.'||s==='..')s='attachment';
  if(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s))s='_'+s;
  return s;
}
function text(v,depth=0){
  if(depth>12||v==null)return '';
  if(typeof v==='string')return v;
  if(Array.isArray(v))return v.map(x=>text(x,depth+1)).filter(Boolean).join('\n');
  if(typeof v==='object'){
    for(const k of ['text','transcript','caption','code','content','parts'])if(v[k]){const s=text(v[k],depth+1);if(s)return s;}
    if(v.asset_pointer||v.file_id)return '[附件引用：'+(v.asset_pointer||v.file_id)+']';
  }
  return '';
}
function files(message,cid,mid){
  const found=new Map(), candidates=[...(message.metadata?.attachments||[]),...(message.files||[])];
  function walk(v,depth=0){
    if(depth>12||v==null)return;
    if(typeof v==='object'){
      if(v.asset_pointer||v.file_id)candidates.push(v);
      for(const [k,x]of Object.entries(v))if(k!=='metadata'&&k!=='attachments')walk(x,depth+1);
    }else if(typeof v==='string')for(const m of v.matchAll(/\[([^\]]*)\]\(sandbox:([^\s)]+)\)/g))candidates.push({resource_id:`sandbox:${mid}:${m[2]}`,sandbox_path:m[2],name:m[1]||m[2].split('/').pop()});
  }
  walk(message.content);
  for(const c of candidates){
    if(!c||typeof c!=='object')continue;
    const id=String(c.resource_id||c.id||c.file_id||c.library_file_id||c.asset_pointer||'').replace(/^sediment:\/\//,'');
    const rid=id||`unresolved-${mid}-${found.size}`;
    if(found.has(rid))continue;
    const d={resource_id:rid,conversation_id:cid,message_id:mid,name:String(c.name||c.filename||id||'附件'),status:'pending'};
    for(const k of ['file_id','asset_pointer','sandbox_path','mime_type','size'])if(typeof c[k]==='string'||typeof c[k]==='number')d[k]=c[k];
    found.set(rid,d);
  }
  return [...found.values()];
}
export function readConversation(raw){
  const cid=String(raw.id||raw.conversation_id||''), mapping=raw.mapping;
  if(!cid||!mapping||!raw.current_node)throw Error('对话结构不完整，未导出。');
  const chain=[], seen=new Set();let id=raw.current_node;
  while(id){
    if(seen.has(id)||!Object.hasOwn(mapping,id)||!mapping[id]||typeof mapping[id]!=='object')throw Error('当前分支不完整或包含循环，未导出。');
    seen.add(id);chain.push([id,mapping[id]]);id=mapping[id].parent;
  }
  const messages=[];const allFiles=[];
  for(const [mid,node]of chain.reverse()){
    const m=node.message;if(!m)continue;
    const refs=files(m,cid,mid);allFiles.push(...refs);
    messages.push({message_id:mid,role:m.author?.role||'unknown',occurred_at:m.create_time??null,content:text(m.content),content_parts:m.content??null,model:m.metadata?.model_slug??null,files:refs});
  }
  if(!messages.length)throw Error('当前对话没有可读取消息。');
  return {schema_version:'chatgpt-single-export/1',conversation_id:cid,title:String(raw.title||'ChatGPT 对话'),source_url:'https://chatgpt.com/c/'+encodeURIComponent(cid),create_time:raw.create_time??null,update_time:raw.update_time??null,branch_selection:'current',project_id:raw.project_id||null,messages,files:allFiles};
}
function linkLabel(s){return String(s).replace(/[\r\n]/g,' ').replace(/([\[\]])/g,'\\$1');}
function relativeLink(path){return path.split('/').map(s=>encodeURIComponent(s).replace(/[()]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())).join('/');}
export function markdown(d){
  const lines=['# '+d.title,'','原始对话：'+d.source_url,'','分支：当前对话分支；导出覆盖全部可读取消息，不依赖页面滚动。',''];
  for(const [i,m]of d.messages.entries()){
    let body=m.content;
    for(const f of m.files)if(f.local_path&&f.sandbox_path)body=body.split('sandbox:'+f.sandbox_path).join(relativeLink(f.local_path));
    lines.push(`## ${i+1} · ${m.role}`,'',`消息 ID：${m.message_id}`,'',body,'');
    for(const f of m.files)lines.push(f.status==='available'?`附件（此处出现）：[${linkLabel(f.name)}](${relativeLink(f.local_path)})`:`附件（此处出现）：${linkLabel(f.name)} —— 未取得（${f.reason||'不可用'}）`,'');
  }
  return lines.join('\n');
}
function crc32(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let j=0;j<8;j++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
export function zip(entries){
  if(entries.length>65535)throw Error('文件数量超过 ZIP 上限');
  const locals=[],centers=[],names=new Set();let offset=0,total=0;
  for(const entry of entries){
    if(!entry.name||entry.name.startsWith('/')||entry.name.includes('\\')||entry.name.split('/').some(s=>!s||s==='.'||s==='..'))throw Error('ZIP 路径无效');
    if(names.has(entry.name))throw Error('ZIP 路径重复');names.add(entry.name);
    const name=encoder.encode(entry.name),bytes=entry.bytes;
    if(!(bytes instanceof Uint8Array)||name.length>65535)throw Error('ZIP 文件格式无效');
    total+=bytes.length;if(total>LIMIT)throw Error('导出内容超过 512 MiB 上限');
    const crc=crc32(bytes),h=new Uint8Array(30+name.length),v=new DataView(h.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,0x21,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,name.length,true);h.set(name,30);
    const c=new Uint8Array(46+name.length),w=new DataView(c.buffer);
    w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint16(14,0x21,true);w.setUint32(16,crc,true);w.setUint32(20,bytes.length,true);w.setUint32(24,bytes.length,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true);c.set(name,46);
    locals.push(h,bytes);centers.push(c);offset+=h.length+bytes.length;
  }
  const centerLength=centers.reduce((n,c)=>n+c.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);
  v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,centerLength,true);v.setUint32(16,offset,true);
  const output=new Uint8Array(offset+centerLength+22);let at=0;for(const part of [...locals,...centers,end]){output.set(part,at);at+=part.length;}return output;
}
export async function buildBundle(raw,loadResource,{onProgress=()=>{}}={}){
  const document=readConversation(raw),entries=[],saved=new Map();let used=0;
  for(const [i,f]of document.files.entries()){
    onProgress(i+1,document.files.length);
    try{
      if(saved.has(f.resource_id)){Object.assign(f,saved.get(f.resource_id));continue;}
      if(i>=100)throw Error('limit');
      const r=await loadResource({...f,project_id:document.project_id});
      if(!(r.bytes instanceof Uint8Array)||r.bytes.length>256*1024*1024||used+r.bytes.length>LIMIT-16*1024*1024)throw Error('limit');
      const path=`attachments/${String(i+1).padStart(3,'0')}_${safeName(r.name||f.name)}`;
      Object.assign(f,{name:r.name||f.name,status:'available',local_path:path,size:r.bytes.length,sha256:r.sha256||null});
      saved.set(f.resource_id,{name:f.name,status:f.status,local_path:path,size:f.size,sha256:f.sha256});used+=r.bytes.length;entries.push({name:path,bytes:r.bytes});
    }catch(e){if(e.message==='ACCOUNT_CHANGED'||e.message==='PAGE_CHANGED')throw e;f.status='missing';f.reason=e.message==='limit'?'超过本轮数量或大小上限':'文件过期、无权限或当前无法下载';}
  }
  const manifest={schema_version:'chatgpt-single-export-bundle/1',source_url:document.source_url,conversation_id:document.conversation_id,branch_selection:'current',generated_at:new Date().toISOString(),message_count:document.messages.length,complete:document.files.every(f=>f.status==='available'),completeness_scope:'referenced-message-files',files:document.files};
  entries.unshift({name:'conversation.md',bytes:encoder.encode(markdown(document))},{name:'conversation.json',bytes:encoder.encode(JSON.stringify(document,null,2))},{name:'manifest.json',bytes:encoder.encode(JSON.stringify(manifest,null,2))});
  return {document,manifest,entries,bytes:zip(entries)};
}
