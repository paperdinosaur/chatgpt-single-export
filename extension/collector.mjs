/* Runs only inside the explicitly permitted ChatGPT page. Auth never leaves this function. */
export async function collectChatGPT(mode, args = {}) {
  try {
  const origin = location.origin;
  const selected = location.pathname.match(/\/c\/([A-Za-z0-9-]+)\/?$/)?.[1];
  if (!args.expected_id || selected !== args.expected_id) throw Error('PAGE_CHANGED');
  if (!['details', 'resource_open', 'resource_chunk', 'resource_release'].includes(mode)) throw Error('Unsupported export action');
  if (mode === 'details' && (args.ids?.length !== 1 || args.ids[0] !== args.expected_id)) throw Error('PAGE_CHANGED');
  if (mode === 'resource_open' && args.resource?.conversation_id !== args.expected_id) throw Error('PAGE_CHANGED');
  if (!['https://chatgpt.com'].includes(origin)) throw Error('当前页面不是已允许的 ChatGPT 网站');
  // Binary data lives briefly in the authenticated tab, never in extension storage.
  const transferKey = '__chatgptSingleExportTransferV1';
  if (mode === 'resource_chunk' || mode === 'resource_release') {
    const transfer = globalThis[transferKey];
    if (!transfer || transfer.id !== args.transfer_id || transfer.expires < Date.now()) throw Error('附件暂存不存在或已过期，请重试');
    if (mode === 'resource_release') {delete globalThis[transferKey]; return {released: true};}
    if (!Number.isInteger(args.offset) || args.offset < 0 || args.offset >= transfer.bytes.length) throw Error('附件分块位置无效');
    const bytes = transfer.bytes.subarray(args.offset, args.offset + 65536);
    const parts = [];
    for (let i = 0; i < bytes.length; i += 4096) parts.push(String.fromCharCode(...bytes.subarray(i, i + 4096)));
    return {data: btoa(parts.join('')), bytes: bytes.length};
  }
  const sessionResponse = await fetch(new URL('/api/auth/session', origin).href,
    {credentials: 'include', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(45000), headers: {Accept: 'application/json'}});
  if (!sessionResponse.ok) throw Error('ChatGPT 登录状态不可用');
  const session = await sessionResponse.json();
  if (!session.user?.id) throw Error('无法确认当前 ChatGPT 账号，已停止采集');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(session.user.id)));
  const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (mode === 'identity') return {fingerprint};
  const token = session.accessToken || session.access_token;
  async function request(path, {projectId = null, raw = false} = {}) {
    const url = new URL(path, origin);
    const allowed = /^\/(?:backend-api|api)\/conversations?(?:\/|$)/.test(url.pathname)
      || /^\/backend-api\/gizmos\/(?:snorlax\/sidebar|g-p-[A-Za-z0-9_-]+\/conversations)$/.test(url.pathname)
      || /^\/backend-api\/files\/download\/[A-Za-z0-9_-]+$/.test(url.pathname);
    if (url.origin !== origin || !allowed) throw Error('已阻止非资料读取接口请求');
    const headers = {Accept: 'application/json'};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (projectId) {
      if (typeof projectId !== 'string' || !/^g-p-[A-Za-z0-9_-]{1,512}$/.test(projectId)) throw Error('附件项目标识无效');
      headers['chatgpt-project-id'] = projectId;
    }
    const response = await fetch(url.href, {credentials: 'include', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(45000), headers});
    if (response.url && new URL(response.url).origin !== origin) throw Error('已阻止跨站响应');
    if (!response.ok) {
      const error = Error(`ChatGPT 接口返回 HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return raw ? response : response.json();
  }
  async function fallback(paths) {
    let last;
    for (const path of paths) {
      try {return await request(path);} catch (error) {
        last = error;
        if (error.status !== 404 && error.status !== 405) throw error;
      }
    }
    throw last || Error('ChatGPT 接口不可用');
  }
  if (mode === 'resource_open') {
    delete globalThis[transferKey];
    if (typeof args.transfer_id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(args.transfer_id)) throw Error('附件传输标识无效');
    const resource = args.resource || {};
    const id = String(resource.file_id || resource.id || resource.asset_pointer || resource.resource_id || '').replace(/^sediment:\/\//, '');
    const query = new URLSearchParams({inline: 'false'});
    if (resource.conversation_id) query.set('conversation_id', String(resource.conversation_id));
    // Provider contract evidence: ha0xin/chatgpt-multimodal-exporter src/api.ts.
    // file_ user uploads reject gizmo_id; file- project files can require it.
    if (resource.project_id && /^file-/.test(id)) query.set('gizmo_id', String(resource.project_id));
    let path;
    if (resource.sandbox_path) {
      let sandbox;
      try {sandbox = decodeURIComponent(String(resource.sandbox_path).replace(/^sandbox:/, ''));}
      catch {throw Error('生成附件的定位资料编码无效');}
      if (!resource.conversation_id || !resource.message_id || !sandbox.startsWith('/mnt/data/') ||
          sandbox.split('/').includes('..') || sandbox.includes('\\') || /%[0-9a-f]{2}|[\x00-\x1f]/i.test(sandbox)) throw Error('生成附件的定位资料不完整');
      const params = new URLSearchParams({message_id: resource.message_id, sandbox_path: sandbox});
      path = '/backend-api/conversation/' + encodeURIComponent(resource.conversation_id) + '/interpreter/download?' + params;
    } else {
      if (typeof id !== 'string' || !/^file[-_][A-Za-z0-9_-]+$/.test(id)) throw Error('附件标识暂不支持下载');
      path = '/backend-api/files/download/' + encodeURIComponent(id) + '?' + query;
    }
    let response = await request(path, {projectId: resource.project_id || null, raw: true});
    let meta = {};
    // The provider can return either JSON metadata or binary directly. Keep
    // project context confined to the authenticated metadata API call.
    const attachmentResponse = response.headers && /filename\*?=/i.test(response.headers.get('content-disposition') || '');
    if (!response.headers || (!attachmentResponse && /json/i.test(response.headers.get('content-type') || ''))) {
      try {meta = await response.json();}
      catch {throw Error('附件下载元数据格式不匹配（非有效 JSON）');}
      const downloadUrl = meta.download_url || meta.url;
      if (typeof downloadUrl !== 'string') throw Error('附件下载地址不可用，文件可能已过期');
      const url = new URL(downloadUrl, origin);
      const sameOrigin = url.origin === origin;
      if (url.protocol !== 'https:' || url.username || url.password ||
          (sameOrigin ? url.pathname !== '/backend-api/estuary/content' : !/(^|\.)oaiusercontent\.com$/.test(url.hostname))) throw Error('已阻止未允许的文件域名');
      const headers = {Accept: '*/*'};
      if (sameOrigin && token) headers.Authorization = `Bearer ${token}`;
      try {response = await fetch(url.href, {credentials: sameOrigin ? 'include' : 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(120000), headers});}
      catch {throw Error('附件内容读取失败，可能是网络、跨域限制或文件已过期');}
    }
    if (!response.ok) throw Error(`附件内容返回 HTTP ${response.status}，文件可能已过期`);
    const limit = 256 * 1024 * 1024;
    const declared = Number(response.headers.get('content-length') || meta.file_size_bytes || 0);
    if (declared > limit) {await response.body?.cancel(); throw Error('附件超过单文件 256 MiB 上限');}
    const chunks = [];
    let size = 0;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {await reader.cancel(); throw Error('附件超过单文件 256 MiB 上限');}
        chunks.push(value);
      }
    } else {
      const value = new Uint8Array(await response.arrayBuffer());
      size = value.length;
      if (size > limit) throw Error('附件超过单文件 256 MiB 上限');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
    globalThis[transferKey] = {id: args.transfer_id, bytes, expires: Date.now() + 10 * 60 * 1000};
    const disposition = response.headers.get('content-disposition') || '';
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const plainName = disposition.match(/filename="([^"]+)"|filename=([^;]+)/i);
    let dispositionName = plainName ? (plainName[1] || plainName[2]).trim() : '';
    if (encodedName) {try {dispositionName = decodeURIComponent(encodedName[1].trim());} catch {}}
    const placeholderNames = new Set(['', id, resource.id, resource.file_id, resource.resource_id,
      resource.asset_pointer, '附件', '文件', 'attachment', 'file', 'image']);
    const knownName = placeholderNames.has(resource.name || '') ? '' : resource.name;
    return {fingerprint, bytes: size, sha256, name: String(meta.file_name || knownName || dispositionName || id || '').split('/').pop(),
      mime_type: String(meta.mime_type || response.headers.get('content-type') || resource.mime_type || 'application/octet-stream')};
  }
  function safePayload(value) {
    if (Array.isArray(value)) return value.map(safePayload);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/^(?:download_url|signed_url|access_token|accessToken|authorization)$/i.test(key))
      .map(([key, item]) => [key, safePayload(item)]));
    if (typeof value === 'string' && /^https:\/\//.test(value)) {
      try {
        const url = new URL(value);
        if (url.pathname === '/backend-api/estuary/content' || (/(^|\.)oaiusercontent\.com$/.test(url.hostname) && /[?&](?:sig|se|token)=/.test(url.search))) return '[临时文件地址已移除；使用文件标识重新获取]';
      } catch {}
    }
    return value;
  }
  if (mode === 'details') {
    if (!Array.isArray(args.ids) || args.ids.length < 1 || args.ids.length > 3) throw Error('正文读取批次数量无效');
    const conversations = [];
    for (const id of args.ids) {
      if (typeof id !== 'string' || id.length < 1 || id.length > 512) throw Error('对话标识无效');
      const encoded = encodeURIComponent(id);
      const value = await fallback(['/backend-api/conversation/' + encoded, '/api/conversation/' + encoded]);
      if (!value.mapping || !value.current_node) throw Error('正文结构不完整，未将其标为成功');
      conversations.push({id: value.id || id, title: value.title, create_time: value.create_time,
        update_time: value.update_time, mapping: safePayload(value.mapping), current_node: value.current_node,
        project_id: /^g-p-/.test(value.gizmo_id || '') ? value.gizmo_id : null});
    }
    return {fingerprint, conversations};
  }
  throw Error('Unsupported export action');
  } catch (error) {
    // Chromium can resolve executeScript with an empty result when an injected
    // promise rejects. Return safe data explicitly; never return raw responses.
    if (!args.report_errors) throw error;
    if (error.message === 'PAGE_CHANGED') return {collector_error: {category: 'page-changed', mode}};
    const message = String(error?.message || error || '');
    const matched = message.match(/\bHTTP[\s:_-]*([1-5][0-9]{2})\b/i);
    const http_status = Number.isInteger(error?.status) ? error.status : matched ? Number(matched[1]) : null;
    const error_type = ['TypeError', 'SyntaxError', 'RangeError', 'AbortError', 'TimeoutError'].includes(error?.name) ? error.name : 'Error';
    let category = 'collector-error';
    if (http_status) category = 'http-error';
    else if (/登录|账号/.test(message)) category = 'login-required';
    else if (/JSON|Unexpected token/i.test(message) || error_type === 'SyntaxError') category = 'invalid-response-json';
    else if (/域名/.test(message)) category = 'blocked-host';
    else if (/下载地址/.test(message)) category = 'download-url-missing';
    else if (/上限/.test(message)) category = 'too-large';
    else if (/timeout|timed out|超时/i.test(message) || /^(?:Abort|Timeout)Error$/.test(error_type)) category = 'timeout';
    else if (/Failed to fetch|内容读取失败/i.test(message)) category = 'content-fetch-failed';
    else if (/标识|定位资料/.test(message)) category = 'unsupported-reference';
    return {collector_error: {category, http_status, error_type,
      mode: ['inventory', 'identity', 'details', 'resource_open', 'resource_chunk', 'resource_release'].includes(mode) ? mode : 'unknown'}};
  }
}
