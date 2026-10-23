# dsh-browser-suite

**DSH 浏览器套件**：把本地浏览器搜索/抓取、输入框本地/API 切换、网页版 DeepSeek 桥接合并成一个 DSH 插件。

本包用于替代以下三个旧插件：

- `dsh-local-browser-search`
- `dsh-local-web-control`
- `dsh-webds-bridge`

> English summary is at the end of this README.

---

## 功能

### 本地浏览器搜索

- `browser_search`：通过本机 Edge/Chrome 的 CDP 执行网页搜索，不需要服务端搜索 API Key。
- `browser_fetch`：打开指定 URL 并返回渲染后的正文。
- 支持 Bing、百度、搜狗、DuckDuckGo、Google。
- 输入框中的「本地搜索」开关控制本地搜索/API 搜索互斥。
- 配置自动保存到 `$DSH_HOME/local-web-control.json`。

### 网页版 DeepSeek 桥接

- 纯 DOM 自动化，无需 DeepSeek API Key。
- 支持两种运行位置：
  - **侧边栏 Browser tab**：使用 DSH 右侧栏浏览器。
  - **独立浏览器**：通过 CDP 驱动本机 Edge/Chrome，可无头或显示窗口，持久化登录 profile。
- 手动桥接流程：在网页版讨论，然后使用「存记忆 / 执行 / 续接」。
- 配置自动保存到 `$DSH_HOME/dsh_memory/config.json`。

### 合并后的输入框界面

- 「本地搜索」开关（来自 `dsh-local-web-control`）。
- 「网页版」配置按钮（来自 `dsh-webds-bridge`）。
- 会话标题栏的存记忆/执行/续接按钮。
- 设置页的网页版桥接面板。

## 安装

```bash
dsh plugin --profile desktop add github:User-Clb/dsh-browser-suite
```

本地开发：

```bash
git clone https://github.com/User-Clb/dsh-browser-suite.git
dsh plugin --profile desktop add link:<absolute-path>/dsh-browser-suite
```

安装后从托盘完全退出 DSH 再启动。

## 自动对话源

自动对话源通过本地 OpenAI 兼容端点接入 DSH：

- 端点：`http://127.0.0.1:34567/v1`
- provider：`web-local`
- 模型：`web-local/web-deepseek`
- 每个 DSH 对话/子会话使用独立网页会话；
- 上下文默认上限 1,000,000 tokens，超出后压缩并新开对话续接；
- 网页版实际生成按账号串行，避免多标签同时生成互相踢掉；
- 开源版需要在 profile patch 的 `llm-pi-ai.providers` 中配置 `web-local`，至少包含 `baseURL`、`Authorization` header 和 `contextWindow: 1000000`。

输入框「网页版」面板里：

- **启用网页版**：隐藏模型选择并启用网页版桥接；
- **自动对话源**：独立开关，选中 Web DeepSeek，自动多轮。

## 配置路径

- 本地搜索：`$DSH_HOME/local-web-control.json`
- 网页版桥接：`$DSH_HOME/dsh_memory/config.json`
- 独立浏览器默认 profile：`$DSH_HOME/dsh_webds_browser`

## 开发检查

```bash
node --check index.js
node --check client.cjs
node --check lib/control/index.js
node --check lib/webds/index.js
node --check lib/webds/standalone.js
```

## 架构

```text
index.js                 Host 组合入口：control.apply(ctx) + webds.apply(ctx)
client.cjs               Client 组合入口：两份输入框 UI 一起 apply
lib/control/             本地浏览器搜索/抓取 + 本地/API guard
lib/webds/               网页版 DeepSeek 桥接 + 自动对话源/本地 OpenAI 端点
cordis.patch.yml         Host + Client 两条 loader 条目
```

## 已知边界

- 网页版桥接依赖 DeepSeek 页面 DOM，页面改版时需要更新选择器。
- 独立浏览器需要本机安装 Edge/Chrome；首次登录需在独立浏览器里完成。
- 自动对话源的单账号实际生成串行；真正 3 路并行需要多个已登录账号/profile。
- 上下文压缩目前保留头尾、截断中间；语义摘要可作为后续增强。
- 自动对话源依赖本地 `34567` 端口和 profile patch 中的 `web-local` provider；只装插件不会自动添加该 provider。

---

## English summary

`dsh-browser-suite` merges three MIT-licensed DSH plugins:

- local Edge/Chrome web search and fetch (`browser_search` / `browser_fetch`);
- the composer's local-vs-API search switch and guard;
- the DOM-automated web DeepSeek manual bridge (sidebar or standalone browser);
- an optional automatic web DeepSeek model source through a local OpenAI-compatible endpoint (`web-local/web-deepseek`).

Config:

- local search: `$DSH_HOME/local-web-control.json`
- web bridge: `$DSH_HOME/dsh_memory/config.json`
- automatic source: add a `web-local` provider in the profile patch (`http://127.0.0.1:34567/v1`, 1M context).

The automatic source keeps one web conversation per DSH session, serializes generation per account, and compacts at the configured context limit before starting a new web conversation.

Install:

```bash
dsh plugin --profile desktop add github:User-Clb/dsh-browser-suite
```

## Credits

This package merges and rearranges MIT-licensed code from:

- `dsh-local-browser-search` — local browser search/fetch driver family.
- `dsh-local-web-control` — in-composer local/API control and guard.
- `dsh-webds-bridge` — web DeepSeek DOM bridge.

## License

MIT
