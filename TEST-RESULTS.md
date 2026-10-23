# 隔离副本测试结果

副本：`G:\laboratory\dsh-browser-suite-next`
隔离 DSH home：`C:\Users\Revision-Extra\.dsh-next`
隔离 profile：`~/.dsh/profiles/webds-next`
本地端点：`http://127.0.0.1:34568/v1`

## 已真实验证

### 1. 网页对话 URL 持久映射

浏览器 profile 复制后真实登录 DeepSeek，直接调用 web pool：

```text
session-map-e2e
  https://chat.deepseek.com/a/chat/s/33db3943-e81a-4b57-94ff-01232cc1b442
```

第二轮：

```text
same-url true
```

关闭 pool、重新创建后再请求：

```text
WEB-MAP-RESTORED
```

映射文件保持同一个 URL，没有新建对话。

不同 session：

```text
session-map-e2e-2
  https://chat.deepseek.com/a/chat/s/aa7f64a7-411b-49f7-9a8c-7ace5831e7e5

distinct-urls true
```

### 2. 真实 DSH 请求头

从隔离 DSH 向本地端点发出真实请求后，请求头为：

```text
host
connection
accept
x-stainless-*
authorization
user-agent: deepseek-harness/0.2.1-rc.2
content-type
accept-language
sec-fetch-mode
accept-encoding
content-length
```

**没有 x-session-id / x-dsh-session。**

所以 DSH 当前不会把真实 sessionId 传给 OpenAI 兼容端点；插件只能使用历史派生 key，或在 DSH/pi-ai 侧增加 header。

### 3. 真实网页版工具调用

隔离 DSH 选中 `Web DeepSeek` 后执行：

```text
请真实调用 pwsh 工具：创建 G:\laboratory\iso-tool-deliver，
写入 hello.txt 内容 ISO-TOOL-OK，然后读取并回复。
```

结果：

```text
1 轮 3 步
已完成
文件内容确认为 ISO-TOOL-OK
```

文件：

```text
G:\laboratory\iso-tool-deliver\hello.txt
```

### 4. 网页版小项目

隔离 DSH 网页版模型创建：

```text
G:\laboratory\iso-project-web\hello.py
G:\laboratory\iso-project-web\README.md
```

运行输出：

```text
ISO-WEB-OK
```

### 5. 标题请求隔离

标题生成请求不再占用网页对话，不再创建额外 DeepSeek 会话。

### 6. 侧边栏桥接队列

Host 本地端点处于 sidebar 模式时，请求进入队列：

```json
{
  "id": "sidebar-1-...",
  "prompt": "...",
  "fresh": false,
  "sessionId": "web-..."
}
```

客户端回传结果后，本地端点返回：

```text
SIDEBAR-BRIDGE-OK
```

说明 Host↔客户端轮询桥接已通，真实桌面侧边栏还需 UI 端到端验证。

## 已知限制

- DSH 不发送真实 sessionId；当前映射 key 由首条系统消息与首条用户消息派生，相同开场白可能碰撞。
- 侧边栏登录持久化由 DSH sidebar browser 的 Electron partition 决定；插件只能提供退出登录，不能改 partition。
- 单账号网页生成仍然串行；`maxConcurrency` 是排队上限，不是真实并发生成。
- 网页版工具调用依赖网页版输出 tool_call 代码块；已验证一次完整项目，但仍需多次回归。
- 当前 DSH 主客户端未加载本副本。

## 下一步

- 用隔离 profile 在真实桌面验证侧边栏桥接、退出登录、多标签页。
- 若 DSH 侧增加 sessionId header，可切换到真实 sessionId 映射。
- 主 profile 合并前再跑一次小项目验收。

## 侧边栏持久 partition 真实验证

DSH 原始代码：

```js
partition = `dsh-sidebar-browser-${randomUUID()}`;
```

隔离安装中通过 `tools/patch-sidebar-partition.mjs` 字节等长替换为：

```js
partition = "persist:dsh-sidebar-webds";
```

隔离桌面窗口中实测：

```json
{
  "partition": "persist:dsh-sidebar-webds",
  "url": "https://chat.deepseek.com/sign_in"
}
```

写入测试 Cookie：

```text
webds_side_test=1
```

完全退出隔离桌面、重新启动后重新打开侧边栏：

```text
cookie: ...; webds_side_test=1; ...
```

Cookie 仍然存在，说明侧边栏登录信息可以跨重启持久化。

补丁工具只改 app.asar 中的 partition 语句，保持文件长度不变，并自动备份。

## 侧边栏自动对话源真实端到端

隔离桌面（patched persistent partition）中：

1. 侧边栏打开并登录 DeepSeek；
2. 打开网页版 + 自动对话源；
3. 输入：

```text
请只回复：SIDEBAR-AUTO-OK
```

结果：

```text
已完成，用时 17 秒
SIDEBAR-AUTO-OK
```

侧边栏标题变为：

```text
Sidebar auto OK - DeepSeek
```

### 侧边栏自动对话源工具调用

输入：

```text
请真实调用 pwsh 工具，一条命令完成：创建目录
G:\laboratory\sidebar-auto-project，写入 hello.txt 内容 SIDEBAR-TOOL-OK，
然后读取并回复文件内容。
```

结果：

```text
2 轮 4 步
已完成
已通过 pwsh 实际执行完成
```

文件内容：

```text
SIDEBAR-TOOL-OK
```

会话 provider 检查：

```text
providers=web-local
toolResults=2
```

说明侧边栏自动对话源真实使用网页版并执行了 DSH 工具，没有回退 API。

### 退出登录

点击“退出登录”后：

```text
已退出登录并清理本地存储；请重新登录
```

侧边栏 webview 跳转到：

```text
https://chat.deepseek.com/sign_in
```

### 持久登录

侧边栏 partition：

```text
persist:dsh-sidebar-webds
```

写入 Cookie 后完全重启隔离桌面，Cookie 仍存在。

## 真实 DSH sessionId 映射

通过：

1. `tools/patch-session-affinity.mjs` 把 pi-ai 的两个 compat gate 从 `withhold` 改为 `offer`；
2. profile provider 增加：

```yaml
compat:
  sendSessionAffinityHeaders: true
  sessionAffinityFormat: openai
```

隔离 DSH 实际请求头变为：

```json
{
  "session_id": "session-bcf0f1ed-6fe4-4122-8c09-26fcecb2c327",
  "x-client-request-id": "session-bcf0f1ed-6fe4-4122-8c09-26fcecb2c327",
  "x-session-affinity": "session-bcf0f1ed-6fe4-4122-8c09-26fcecb2c327"
}
```

映射文件真实写入：

```json
{
  "session-bcf0f1ed-6fe4-4122-8c09-26fcecb2c327": {
    "url": "https://chat.deepseek.com/a/chat/s/d0c945b1-5031-4ecb-91c0-3cd633459148"
  }
}
```

不再是历史摘要派生 key。

## 补丁工具

- `tools/patch-sidebar-partition.mjs`
  - sidebar partition 持久化
- `tools/patch-session-affinity.mjs`
  - 真实 sessionId 透传

两个工具都只做 app.asar 字节等长替换，并自动备份。

## 多标签页隔离

DSH 的右侧栏每个会话只挂载一个当前 Browser tab；切换会话时旧 webview 卸载。

插件侧已实现：

- `activeChatViews` 从单例改为 `Map<DSH session, webview>`；
- `webviews()` 只查询当前 `data-sidebar-right-session` 根；
- `findChatWebview`、`openChatTab`、`closeChatTab` 都按当前 DSH 会话作用域；
- 不同 DSH 会话各自拥有独立的网页对话 URL。

实测新会话获得新的 session id：

```text
session-a2b66b71-1ddb-48c1-be8a-1d9f06f2b052
-> session-267f99c2-d02d-4c62-a112-0543e214b7b4
```

DSH 同一时间只显示当前会话的侧边栏，因此验证的是会话级隔离，而不是同一侧边栏内多个 webview 同时可见。

## 主安装已应用补丁

主安装：

```text
F:\AllSoftware\DeepSeek Harness\resources\app.asar
```

已应用：

- persistent sidebar partition
- session affinity gates

备份文件：

```text
app.asar.bak-1792771483826
app.asar.bak-affinity-1792771498730
```

主 profile `web-local` 已增加：

```yaml
compat:
  sendSessionAffinityHeaders: true
  sessionAffinityFormat: openai
```

当前运行的 DSH 进程仍使用内存中的旧代码；下一次完全重启后加载补丁。

## 侧边栏登录跨重启持久化

DeepSeek 的 `ds_session_id` 是 session cookie，persistent partition 单独不能保存。

新增补丁：

```text
tools/patch-sidebar-cookie-persistence.mjs
```

它给 DSH 侧边栏 session 增加 `cookies.on("changed")` 监听，把新的 session cookie 改写成 30 天有效期。

隔离桌面上：

1. 导入 DeepSeek 登录 Cookie 和 localStorage；
2. 完全退出隔离桌面；
3. 重新启动，侧边栏直接打开：

```text
https://chat.deepseek.com/
```

页面显示：

```text
欢迎回来，随时开始吧
```

`userToken` 仍存在，不需要重新登录。

## 恢复占位和标签页清理

新增：

- 自动点击“恢复页面”占位；
- 自动清理当前会话重复的 DeepSeek 标签页，只保留一个。

隔离桌面启动后原本 4 个 DeepSeek 标签页：

```text
DeepSeek - 探索未至之境
DeepSeek - 探索未至之境
DeepSeek
DeepSeek - 探索未至之境
```

自动清理后只保留一个活动标签页，webview 仍为：

```text
https://chat.deepseek.com/
```

## 主安装

主安装 `app.asar` 已应用：

- persistent partition；
- session affinity；
- sidebar session cookie persistence。

主侧边栏 partition 已从已登录的隔离 partition 播种，下一次启动主 DSH 应直接是登录状态。

主 profile 已包含：

```yaml
compat:
  sendSessionAffinityHeaders: true
  sessionAffinityFormat: openai
```
