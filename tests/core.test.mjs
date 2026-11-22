import test from 'node:test';
import assert from 'node:assert/strict';
import {readConversation, markdown, buildBundle, zip, conversationId} from '../extension/core.mjs';
const raw = () => ({id:'synthetic',title:'Sample',current_node:'c',mapping:{
 root:{parent:null,message:null},
 a:{parent:'root',message:{author:{role:'user'},content:{parts:['Question']},metadata:{attachments:[{id:'file-test',name:'../report.txt'}]}}},
 b:{parent:'a',message:{author:{role:'assistant'},content:{parts:['OLD BRANCH']}}},
 c:{parent:'a',message:{author:{role:'assistant'},content:{parts:['Answer [data](sandbox:/mnt/data/result.csv)']}}}
}});
test('current branch keeps original order and file-message provenance, excludes other edits',()=>{
 const d=readConversation(raw());assert.deepEqual(d.messages.map(m=>m.message_id),['a','c']);
 assert.equal(d.files.length,2);assert.equal(d.files[0].message_id,'a');assert.equal(d.files[1].message_id,'c');
 assert.equal(d.files[1].sandbox_path,'/mnt/data/result.csv');assert.ok(!markdown(d).includes('OLD BRANCH'));
});
test('broken or cyclic current branch fails instead of reporting a complete export',()=>{
 const d=raw();d.mapping.a.parent='c';assert.throws(()=>readConversation(d),/分支/);
 const e=raw();delete e.mapping.a;assert.throws(()=>readConversation(e),/分支/);
});
test('only real chatgpt conversation pages, including project conversations, are accepted',()=>{
 assert.equal(conversationId('https://chatgpt.com/g/g-p-demo/project/c/abc-123'),'abc-123');
 assert.throws(()=>conversationId('https://evil.test/c/abc'));assert.throws(()=>conversationId('https://chatgpt.com/'));
});
test('one failed attachment remains visible; available bytes stay tied to original message',async()=>{
 const r=await buildBundle(raw(),async f=>{if(f.sandbox_path)throw Error('expired');return {bytes:new Uint8Array([0,128,255]),name:'../report.txt'};});
 assert.equal(r.document.files[0].status,'available');assert.equal(r.document.files[1].status,'missing');
 assert.equal(r.manifest.complete,false);assert.ok(r.entries.some(e=>e.name==='attachments/001_report.txt'));
 assert.match(markdown(r.document),/未取得/);assert.equal(r.document.messages[0].files[0].local_path,'attachments/001_report.txt');
 assert.ok(r.bytes.length>100);assert.ok(!JSON.stringify(r.manifest).includes('expired'));
});
test('account changes abort the whole export rather than mixing accounts',async()=>{
 await assert.rejects(buildBundle(raw(),async()=>{throw Error('ACCOUNT_CHANGED');}),/ACCOUNT_CHANGED/);
});
test('binary ZIP refuses traversal and duplicate names',()=>{
 assert.throws(()=>zip([{name:'../x',bytes:new Uint8Array()}]),/路径/);
 assert.throws(()=>zip([{name:'a',bytes:new Uint8Array()},{name:'a',bytes:new Uint8Array()}]),/重复/);
});

test('Markdown attachment links encode fragment markers and parentheses',async()=>{
 const r=await buildBundle(raw(),async()=>({bytes:new Uint8Array([1]),name:'report#1(最终).csv'}));
 assert.ok(markdown(r.document).includes('attachments/001_report%231%28%E6%9C%80%E7%BB%88%29.csv'));
 assert.ok(r.entries.some(e=>e.name==='attachments/001_report#1(最终).csv'));
});
