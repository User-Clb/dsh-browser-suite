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
lib/webds/               网页版 DeepSeek 手动桥接
cordis.patch.yml         Host + Client 两条 loader 条目
```

## 已知边界

- 网页版桥接依赖 DeepSeek 页面 DOM，页面改版时需要更新选择器。
- 独立浏览器需要本机安装 Edge/Chrome；首次登录需在独立浏览器里完成。
- 当前合并版是**手动桥接**版本；自动对话源/模型路由不在本合并版范围内，避免影响 DSH 本体稳定性。

---

## English summary

`dsh-browser-suite` merges three MIT-licensed DSH plugins:

- local Edge/Chrome web search and fetch (`browser_search` / `browser_fetch`);
- the composer's local-vs-API search switch and guard;
- the DOM-automated web DeepSeek manual bridge (sidebar or standalone browser).

Install:

```bash
dsh plugin --profile desktop add github:User-Clb/dsh-browser-suite
```

Config:

- local search: `$DSH_HOME/local-web-control.json`
- web bridge: `$DSH_HOME/dsh_memory/config.json`

This merged release is **manual bridge only**; the automatic model-source experiment is intentionally excluded to keep the DSH host stable.

## Credits

This package merges and rearranges MIT-licensed code from:

- `dsh-local-browser-search` — local browser search/fetch driver family.
- `dsh-local-web-control` — in-composer local/API control and guard.
- `dsh-webds-bridge` — web DeepSeek DOM bridge.

## License

MIT
