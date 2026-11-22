import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {collectChatGPT} from '../extension/collector.mjs';
import {buildBundle} from '../extension/core.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
const calls=[];
function page(){
 globalThis.location={origin:'https://chatgpt.com',pathname:'/g/g-p-example/c/synthetic'};
 if(!globalThis.crypto)Object.defineProperty(globalThis,"crypto",{value:webcrypto,configurable:true});
 globalThis.fetch=async(input,options)=>{
  const url=new URL(input);calls.push({url,options});
  if(url.pathname==='/api/auth/session')return Response.json({user:{id:'synthetic'},accessToken:'TEST-TOKEN-ONLY'});
  if(url.pathname==='/backend-api/conversation/synthetic')return Response.json({id:'synthetic',title:'合成测试',current_node:'a',mapping:{a:{parent:null,message:{author:{role:'user'},content:{parts:['Test only']},metadata:{attachments:[{id:'file-test',name:'数据.bin'}]}}}}});
  if(url.pathname==='/backend-api/files/download/file-test')return Response.json({url:'https://files.oaiusercontent.com/test?sig=TEST-SIGNATURE-ONLY'});
  if(url.hostname==='files.oaiusercontent.com')return new Response(new Uint8Array([0,128,255]));
  throw Error('Unexpected request');
 };
}
test('page collector forbids another conversation and inventory before network access',async()=>{
 page();calls.length=0;
 await assert.rejects(collectChatGPT('details',{expected_id:'synthetic',ids:['other']}),/PAGE_CHANGED/);
 await assert.rejects(collectChatGPT('inventory',{expected_id:'synthetic'}),/Unsupported/);
 assert.equal(calls.length,0);
 const r=await collectChatGPT('details',{expected_id:'other',ids:['other'],report_errors:true});assert.equal(r.collector_error.category,'page-changed');
});
test('selected-conversation-to-ZIP pipeline preserves binary and keeps credentials in page',async()=>{
 page();calls.length=0;const args={expected_id:'synthetic'};
 const r=await collectChatGPT('details',{...args,ids:['synthetic']});
 const bundle=await buildBundle(r.conversations[0],async resource=>{
  const transfer_id='synthetic-transfer';const opened=await collectChatGPT('resource_open',{...args,resource,transfer_id});
  const part=await collectChatGPT('resource_chunk',{...args,transfer_id,offset:0});
  await collectChatGPT('resource_release',{...args,transfer_id});
  assert.equal(opened.bytes,3);assert.equal(opened.fingerprint,r.fingerprint);
  return {bytes:new Uint8Array(Buffer.from(part.data,'base64')),name:opened.name,sha256:opened.sha256};
 });
 assert.equal(bundle.manifest.complete,true);assert.equal(bundle.document.messages.length,1);
 assert.ok(!JSON.stringify(bundle.document).includes('TEST-TOKEN'));
 assert.ok(!JSON.stringify(bundle.manifest).includes('TEST-SIGNATURE'));
 const cdn=calls.find(x=>x.url.hostname==='files.oaiusercontent.com');
 assert.equal(cdn.options.credentials,'omit');assert.equal(cdn.options.headers.Authorization,undefined);
 assert.ok(!calls.some(x=>/conversations\?|snorlax|\/gizmos\//.test(x.url.href)));
 mkdirSync('build',{recursive:true});writeFileSync('build/synthetic.zip',bundle.bytes);
});
test('off-domain signed URLs are blocked before downloading',async()=>{
 page();const previous=globalThis.fetch;
 globalThis.fetch=async(u,o)=>String(u).includes('/files/download/')?Response.json({url:'https://evil.invalid/file'}):previous(u,o);
 await assert.rejects(collectChatGPT('resource_open',{expected_id:'synthetic',transfer_id:'test',resource:{resource_id:'file-test',conversation_id:'synthetic'}}),/未允许/);
 assert.ok(!calls.some(x=>x.url.hostname==='evil.invalid'));
});
