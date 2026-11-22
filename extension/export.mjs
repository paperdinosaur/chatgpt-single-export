import {collectChatGPT} from './collector.mjs';
import {buildBundle,conversationId,safeName} from './core.mjs';
const params=new URLSearchParams(location.search),tabId=Number(params.get('tab')),cid=params.get('conversation');
const status=document.getElementById('status'),title=document.getElementById('title'),progress=document.getElementById('progress'),retry=document.getElementById('retry'),download=document.getElementById('download');
let running=false,blobUrl=null;
async function collect(mode,args={}){
  for(let attempt=0;;attempt++){
    try{
      const tab=await chrome.tabs.get(tabId);
      if(conversationId(tab.url)!==cid)throw Error('PAGE_CHANGED');
      const r=(await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:collectChatGPT,args:[mode,{...args,expected_id:cid,report_errors:true}]}))[0]?.result;
      if(!r)throw Error('页面未返回有效数据，请刷新原对话后重试。');
      if(r.collector_error){
        const e=r.collector_error;if(e.category==='page-changed')throw Error('PAGE_CHANGED');
        const error=Error(e.http_status?`ChatGPT 接口返回 HTTP ${e.http_status}`:e.category==='login-required'?'请在原页面登录 ChatGPT 后重试。':'读取失败：'+e.category);error.status=e.http_status;throw error;
      }
      return r;
    }catch(e){if(e.status>=500&&attempt<2)await new Promise(r=>setTimeout(r,1000*(attempt+1)));else throw e;}
  }
}
async function run(){
 if(running)return;running=true;retry.hidden=true;download.hidden=true;progress.hidden=false;progress.removeAttribute('value');
 if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl=null;}
 try{
  if(params.has('error')||!Number.isInteger(tabId)||tabId<0||!cid)throw Error('请先打开要导出的 ChatGPT 对话，然后点击扩展图标。');
  status.textContent='正在读取完整对话……';
  const details=await collect('details',{ids:[cid]}),raw=details.conversations?.[0];
  if(!raw||raw.id!==cid)throw Error('对话标识不匹配，已停止。');
  title.textContent=raw.title||'ChatGPT 对话';
  const result=await buildBundle(raw,async resource=>{
    const transfer_id=crypto.randomUUID();
    try{
      const opened=await collect('resource_open',{resource,transfer_id});
      if(opened.fingerprint!==details.fingerprint)throw Error('ACCOUNT_CHANGED');
      const bytes=new Uint8Array(opened.bytes);let offset=0;
      while(offset<bytes.length){
        const part=await collect('resource_chunk',{transfer_id,offset});
        const decoded=Uint8Array.from(atob(part.data),c=>c.charCodeAt(0));
        if(!decoded.length||part.bytes!==decoded.length||offset+decoded.length>bytes.length)throw Error('附件分块校验失败');
        bytes.set(decoded,offset);offset+=decoded.length;
      }
      const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(sha256!==opened.sha256)throw Error('附件内容校验失败');
      return {bytes,name:opened.name,sha256};
    }finally{try{await collect('resource_release',{transfer_id});}catch{}}
  },{onProgress:(n,total)=>{status.textContent=`正文已读取，正在取附件 ${n} / ${total}……`;progress.max=total;progress.value=n;}});
  blobUrl=URL.createObjectURL(new Blob([result.bytes],{type:'application/zip'}));download.href=blobUrl;download.download=safeName(raw.title||'ChatGPT 对话')+'.zip';download.hidden=false;progress.hidden=true;
  const missing=result.document.files.filter(f=>f.status!=='available').length;
  status.textContent=`已整理 ${result.document.messages.length} 条消息，${result.document.files.length-missing} 个附件引用已取回。`+(missing?`\n${missing} 个附件引用未取回，已在正文和 manifest.json 标明。`:'');
  download.textContent='下载 ZIP';download.click();
 }catch(e){progress.hidden=true;retry.hidden=false;status.textContent=e.message==='ACCOUNT_CHANGED'?'登录账号发生变化，已停止；请回到原账号重试。':e.message==='PAGE_CHANGED'?'原对话页面已切换，已停止；请在要导出的对话重新点击扩展图标。':e.message;}
 finally{running=false;}
}
retry.addEventListener('click',run);void run();
