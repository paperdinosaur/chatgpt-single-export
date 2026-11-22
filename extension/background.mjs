import {conversationId} from './core.mjs';
chrome.action.onClicked.addListener(async tab => {
  let query;
  try {query=new URLSearchParams({tab:String(tab.id),conversation:conversationId(tab.url)});}
  catch {query=new URLSearchParams({error:'open-conversation'});}
  await chrome.tabs.create({url:chrome.runtime.getURL('export.html')+'?'+query});
});
