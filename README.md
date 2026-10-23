# dsh-browser-suite

DSH 浏览器套件：把本地浏览器搜索与抓取、输入框本地/API 切换、网页版 DeepSeek 桥接合并为一个 DSH 插件。

## 功能

### 本地浏览器搜索

- `browser_search`：通过本机 Edge/Chrome 的 CDP 执行网页搜索，不需要服务端搜索 API Key。
- `browser_fetch`：打开指定 URL 并返回渲染后的正文。
- 支持 Bing、百度、搜狗、DuckDuckGo、Google。
- 输入框「本地搜索」开关控制本地搜索和 API 搜索互斥。
- 配置保存到 `$DSH_HOME/local-web-control.json`。

### 网页版 DeepSeek 桥接

- 纯 DOM 自动化，无需 DeepSeek API Key。
- 支持两种运行位置：
  - 侧边栏 Browser tab；
  - 独立浏览器，可无头或显示窗口，并使用持久化登录 profile。
- 手动桥接流程：在网页版讨论后使用「存记忆 / 执行 / 续接」。
- 配置保存到 `$DSH_HOME/dsh_memory/config.json`。

### 输入框与设置面板

- 输入框「本地搜索」开关。
- 输入框「网页版」配置按钮。
- 会话标题栏的「存记忆 / 执行 / 续接」按钮。
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
- 每个 DSH 对话使用独立网页会话；
- 上下文默认上限 1,000,000 tokens，超出后压缩并新开对话续接；
- 网页版生成按账号串行，避免多标签同时生成互相影响。

输入框「网页版」面板中：

- 「启用网页版」：隐藏模型选择，启用网页版桥接；
- 「自动对话源」：独立开关，选择 Web DeepSeek，自动多轮。

profile patch 的 `llm-pi-ai.providers` 需要包含 `web-local`，至少配置：

```yaml
baseURL: http://127.0.0.1:34567/v1
headers:
  Authorization: Bearer webds-local
contextWindow: 1000000
```

## 配置路径

- 本地搜索：`$DSH_HOME/local-web-control.json`
- 网页版桥接：`$DSH_HOME/dsh_memory/config.json`
- 独立浏览器默认 profile：`$DSH_HOME/dsh_webds_browser`

## 架构

```text
index.js                 Host 组合入口：control.apply(ctx) + webds.apply(ctx)
client.cjs               Client 组合入口：输入框 UI
lib/control/             本地浏览器搜索/抓取 + 本地/API guard
lib/webds/               网页版 DeepSeek 桥接 + 自动对话源/本地 OpenAI 端点
cordis.patch.yml         Host + Client loader 条目
```

## Credits

本包合并并重组了以下 MIT 许可代码：

- `dsh-local-browser-search`：本地浏览器搜索/抓取驱动。
- `dsh-local-web-control`：输入框本地/API 控制和 guard。
- `dsh-webds-bridge`：网页版 DeepSeek DOM 桥接。

## License

MIT
