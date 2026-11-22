<div align="center">

<h1>ChatGPT 单对话导出</h1>

<p>把当前对话的正文、JSON 和可下载附件保存为一个 ZIP。</p>

<p><strong><a href="https://github.com/paperdinosaur/chatgpt-single-export/releases/latest">下载安装包</a></strong> · Edge / Chrome 桌面版</p>

</div>

---

## 安装扩展

1. 从 [GitHub Releases](https://github.com/paperdinosaur/chatgpt-single-export/releases/latest) 下载 `chatgpt-single-export-v*.zip` 并解压到一个准备长期保留的位置。
2. 在 Edge 打开 `edge://extensions`，或在 Chrome 打开 `chrome://extensions`。
3. 开启**开发人员模式**，点击**加载解压缩的扩展**，选择解压包中的 `extension` 文件夹。

## 导出对话

在 [ChatGPT](https://chatgpt.com/) 打开要导出的对话，点击工具栏里的 **ChatGPT 单对话导出**。进度页会在准备好后自动下载 ZIP。

导出期间请保留原对话和进度页。长对话会按当前分支完整读取，项目里的对话也可以在原位置导出。

## ZIP 里的文件

| 文件 | 内容 |
| :--- | :--- |
| `conversation.md` | 可直接阅读的聊天正文，附件链接标在对应消息下 |
| `conversation.json` | 消息 ID、角色、结构化内容和附件位置 |
| `attachments/` | 已取回的附件 |
| `manifest.json` | 附件清单、下载状态和已取回文件的 SHA-256 |

过期或无法访问的附件会在正文和清单中标注。每次最多尝试取回前 100 个附件引用，单文件上限为 256 MiB，整个 ZIP 的内容上限为 512 MiB。

---

[隐私说明](PRIVACY.md) · [版本记录](CHANGELOG.md) · [MIT 许可证](LICENSE)

<details>
<summary>开发、测试与打包</summary>

使用 Node.js 22+ 运行测试，使用 Python 3.11+ 打包。

```sh
npm test
python scripts/package.py
```

安装包和 SHA-256 校验文件生成在 `dist/`。安装 Python Playwright 后，可在隔离的 Edge 配置中用合成对话验证浏览器下载、附件和 ZIP 内容。

```sh
python scripts/browser_smoke.py
```

</details>
