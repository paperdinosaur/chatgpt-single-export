# ChatGPT 单对话导出

**只做一件事：把当前打开的一个 ChatGPT 对话，连同能取回的附件，下载成一个 ZIP。**

不需要脚本猫、API Key、Python、桌面资料库或服务器。适用于桌面版 Microsoft Edge / Google Chrome。

## 下载与安装

**[下载最新版安装包](https://github.com/paperdinosaur/chatgpt-single-export/releases/latest/download/chatgpt-single-export-v0.1.0.zip)**

1. 下载并解压 ZIP，保留解压后的文件夹。
2. Edge 打开 `edge://extensions`；Chrome 打开 `chrome://extensions`。
3. 打开右上角「开发人员模式」，点「加载解压缩的扩展」。
4. 选择解压包里的 **`extension` 文件夹**，里面应能看见 `manifest.json`。
5. 在浏览器工具栏的扩展菜单里，把「ChatGPT 单对话导出」固定出来，方便下次使用。

这是 GitHub 分发的开源扩展，尚未上架应用商店。ZIP 需要先解压，不能直接双击安装。不要删掉已经加载的文件夹。

## 导出

1. 在 `chatgpt.com` 登录自己的账号，打开要导出的**单个对话**。
2. 点工具栏里的「ChatGPT 单对话导出」图标。
3. 新标签页显示进度，完成后自动开始下载 ZIP，也可以点「下载 ZIP」重下。

导出时保留原对话和进度标签页，可以使用别的标签页，但不要在原标签页切换到另一个对话。网页只显示一部分长聊天也没关系：正文从该对话的站内接口读取，不依赖向上滚动。

### ZIP 里面有什么

```text
conversation.md       可直接阅读或交给 AI 的完整正文
conversation.json     消息 ID、角色、原始内容结构和附件位置
manifest.json         文件清单、SHA-256、取回状态及缺失说明
attachments/          已取回的实际文件
```

附件在原消息下标注，并连接压缩包里的对应文件。编辑过消息或重新生成回答时，导出的是**当前分支**，不把其他改写分支混进正文。JSON 保留该分支消息的结构化内容；音频、图片、视频、工具结果是否有可下载本体，取决于站点是否提供文件引用与权限。

项目内对话也可直接打开后导出，无需移出项目。**不会遍历项目、导出全账号，或额外获取项目共享资料。** 当前单点工具只携带这段对话消息中出现的文件。

## 附件缺失与限制

- 过期、无权限、下载接口不支持或网络/跨域限制的文件，会在正文和清单标为缺失；不会伪装成已下载。
- 每次最多尝试前 100 个附件引用（已取回的重复引用复用文件），单文件 256 MiB，正文加文件总量上限 512 MiB。超出的引用标为缺失。
- ZIP 使用标准 STORE 格式（不压缩文件内容），保留原字节。大文件会占用浏览器内存。
- ChatGPT 的站内接口不是公开稳定 API；网站变动可能需要更新工具。500 等服务端错误会有限重试；401/403/429 不进行盲目重试。
- 这是桌面 Chromium 扩展，不承诺 Safari、Firefox、手机浏览器或分享链接页兼容。

## 隐私

代码无统计、遥测、广告、远程模型调用、自动更新检查或外部服务器。扩展仅申请 `activeTab` 和 `scripting`：在你点击图标时访问所选页面。每次读取还会核对页面的对话 ID，拒绝把另一个对话混进来。

认证只在 ChatGPT 页面内存中用于本站请求，不返回给扩展页面、不写入下载包或存储。附件只允许 ChatGPT 本站内容接口与 HTTPS `oaiusercontent.com` 下载地址；跨域请求不携带本站 Cookie、认证或项目请求头。它仍然是联网下载工具，不是离线工具。

导出 ZIP 是**明文**，里面是你主动选择的聊天和文件；请自行决定交给谁。

权限依据：[Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)、[scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)。

## 开发与验证

运行时不依赖第三方 JavaScript 包。开发测试需 Node.js 22+，打包需 Python 3.11+：

```sh
npm test
python scripts/package.py
```

`dist/` 得到可分发 ZIP 和 SHA-256。打包仅允许扩展代码、README、隐私说明、许可证；测试数据、浏览器配置、聊天资料、构建目录与 Git 历史不进入分发包。

可选浏览器合成验收（需 Python Playwright 和本机 Edge，可用 `--browser` 指定其他 Chromium）：

```sh
python scripts/browser_smoke.py
```

浏览器验收使用独立临时配置和合成网络响应，验证完整正文、一个可取附件、一个缺失附件、实际 ZIP 下载和独立 CRC/字节校验。**为模拟点击后的 activeTab 授权，测试副本临时增加本站 host 权限；正式分发包没有这个权限。** 这不等于所有真实账号、附件类型和站点版本均已验证；真实服务是否提供附件由 ChatGPT 决定。

MIT License。
