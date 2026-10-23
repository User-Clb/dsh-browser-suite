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

## 提示词重复问题修复

根因：DSH 每轮都会更新 system 消息（时间/上下文），旧逻辑用包含 system 的消息做前缀比较，system 一变前缀就变成 0，随后把整段历史再次发进同一个网页对话，造成上一轮内容重复。

修复：

- 前缀比较只使用非 system 消息；
- system 变化不再触发全量重发；
- 只有历史真正被改写（非 system 前缀对不上）时才新开网页对话；
- 每个 session 的 messages 持久化到：

```text
$DSH_HOME/dsh_memory/web_states/<sessionId>.json
```

重启后先恢复状态，再发送真正的 delta。

隔离测试：

```text
请求 1: 完整 prompt, fresh=true
请求 2: Assistant A1 + User U2, fresh=false
请求 3: Assistant A2 + User U3, fresh=false（即使 system 从 S1 变为 S2）
重启后请求 4: Assistant A3 + User U4, fresh=false
```

没有重复携带上一轮。

## 工具结果后续对话

工具调用后的下一轮现在只发送：

```text
Tool:
工具实际结果
```

不再重发前面的 User/Assistant 历史；网页对话保持连续，DSH 工具结果作为增量进入网页模型。

## 给定会话 session-267f99c2 的问题复盘

该会话日志显示：

1. 第 1、2 轮正常返回文本；
2. 第 3 轮模型输出 `tool-call` browser_search，DSH 执行成功；
3. 工具结果返回后，模型没有输出约定的 `tool_call` 代码块，而是输出 DeepSeek 原生 DSML：

```text
<｜｜DSML｜｜ calls>
<｜｜DSML｜｜ invoke name="browser_fetch">
...
```

4. 本地端点此前只解析 JSON 代码块，所以这段 DSML 被当作普通文本显示。

### 修复

新增 DSML 工具调用解析：

- 解析 `<｜｜DSML｜｜ invoke name="...">`
- 解析 `<｜｜DSML｜｜ parameter name="...">`
- 支持参数为 JSON 或扁平键值
- 与 JSON tool_call 去重合并

隔离测试：同一段 DSML 被解析为：

```json
{
  "name": "browser_fetch",
  "arguments": "{\"url\":\"http://www.nmc.cn/publish/forecast/AGD/guangzhou.html\",\"maxChars\":4000}"
}
```

不再是纯文本。

## 工具结果后的上下文

- 工具调用消息保留在 DSH 历史；
- 下一轮只发送 Tool 结果增量；
- system 变化不回传全量历史；
- state 持久化到 web_states；
- 不再重复上一轮内容。

## 无真实 sessionId 的网页模式

网页 GUI / 未加载 affinity 补丁时，本地端点拿不到 sessionId，只能派生。

旧派生 key：

```text
system + first message
```

DSH 每轮会改 system，导致 key 每轮变化，state 永远命中不了，于是每轮都发完整历史。

已改为：

```text
model + 第一条 user 消息
```

system 变化不再改变 key。

隔离测试：

- 第 1 轮 system=S1, user=U1 → sessionId=web-9591dd1c4d433a86, fresh=true
- 第 2 轮 system=S2-changed，同一 U1，新 A1/U2 → 同一个 sessionId, prompt 只有 A1/U2, fresh=false

这样网页对话模式也不会每轮重复全量上下文。

## 插件能力暴露

本地后端现在把 DSH 传入的 `body.tools` 作为唯一工具清单：

- 最多 120 个工具；
- 描述截断从 240 提升到 800 字符；
- 参数 schema 原样写入；
- 明确告诉网页模型：这些工具由运行中的 DSH 插件系统注册，DSH 会执行每个有效 tool_call 并返回 Tool 结果；
- 每一轮 delta 都带一行紧凑的可用工具清单，避免长对话中遗忘。

如果工具很多，完整 schema 只在首次/新建网页对话时发送；后续每轮发送工具名提醒。

## session-74ae 复盘

该会话的工具调用本身是通的：

- 模型调用了 `ask_user_question`；
- DSH 执行；
- 工具结果返回。

但工具结果之后，模型改用“网络出口 IP”直接回答，没有调用 `browser_search`，所以看起来像“本地工具/浏览器没提供”。

实际原因是：

- 工具确实在 tools 列表中（browser_search、browser_fetch 都在）；
- 网页模型没有像 API agent 那样强制使用工具；
- 旧 prompt 只说“需要时调用”，没有把实时数据列为强制工具场景。

修复：

- 明确要求天气/新闻/价格/网页/文件/命令必须调用工具；
- 天气必须先 browser_search；
- 禁止用 IP 定位或记忆代替；
- 每轮 delta 重申可用工具；
- 工具结果后继续任务。

## 工具清单只在会话开始发送一次

为避免每轮重复工具 schema 消耗上下文：

- 工具清单只在首次请求 / 新开网页对话时发送；
- 明确告诉模型“工具清单在整个对话内持续有效，不要索要或重复”；
- 后续 delta 只包含：

```text
Assistant: ...
User: ...
Tool: ...
```

验证：

```text
fullHasTools true
delta "Assistant:\nA1\n\nUser:\nU2"
```

delta 中不再带 browser_search/browser_fetch 等工具清单。

## session-9785 复盘

该会话证明工具链路是通的：

- ask_user_question 执行成功；
- DSML browser_fetch 被解析并执行两次；
- pwsh 被解析并执行，返回时区和公网 IP；
- 所有 Tool 结果都回到会话。

真正的问题是：

1. 用户回答“自己解决”后，模型选择 IP 定位，而不是 browser_search 天气；
2. 最后一步模型输出空的：

```text
tool_call

```
```

本地解析器没有可解析 JSON，turn 直接结束。

### 新修复

- prompt 明确：用户不提供地点时，必须用 browser_search 原始天气问题，不得用 IP；
- 检测空的 tool_call 脚手架；
- 自动发送一次纠正消息要求模型重发合法 tool_call 或最终回答；
- 仍为空时不返回空白工具块。

隔离测试：

```text
第一次: 空的 tool_call 代码块
自动重试
第二次: browser_search {"query":"今天广州天气"}
DSH 收到真实 tool_calls
```

## session-acf03 复盘

工具系统本身是工作的：

- browser_search 执行两次；
- ask_user_question 执行；
- skill 加载 office-xlsx；
- load_workspace_dependencies 执行；
- write 成功写入脚本；
- pwsh、job_output、job_kill 都执行。

根本问题不是工具缺失，而是网页模型生成的参数/命令不可靠。

### 1. Windows 路径丢反斜杠

模型把：

```text
C:\Users\Revision-Extra\.dsh-next\...
```

写成：

```text
C:\Users\Revision-Extra.dsh-next\...
```

于是 Test-Path 返回 False，模型误以为 Python runtime 不存在，继续盲目搜索。

修复：本地端点增加路径修复，把用户名后缺失的 `\` 补回。

### 2. timeoutMs 被写成字符串

模型输出：

```json
"timeoutMs": "90000"
```

DSH 要求 number，报：

```text
"timeoutMs" must be a number
```

修复：根据 tools schema 自动把数字字符串转换为 number。

### 3. 递归扫描挂起

模型执行：

```text
Get-ChildItem 'C:\Users\Revision-Extra\.dsh-next' -Depth 1 -Directory ...
```

命令运行超过 120 秒被转入后台，模型随后 job_output/job_kill，浪费步骤。

修复：prompt 明确禁止递归扫描整个 home；优先 Test-Path / where.exe / 精确 runtime 路径；已转后台的命令不要重复执行。

### 4. 最终 DSML 嵌套损坏

最后输出出现大量重复/嵌套 parameter 标签，严格解析失败，turn 直接结束。

修复：

- 增加容错 DSML 解析；
- 接受不完整/嵌套标签；
- 无解析结果时自动重试一次，要求输出合法 tool_call JSON；
- 仍失败不返回空白工具块。

### 5. 天气搜索后没有 fetch 页面

模型只调用了 browser_search，没有 browser_fetch 天气页面就给出结论。

修复：prompt 要求 weather 在 browser_search 后至少 browser_fetch 一个天气页面并引用。

## 回复完成后的额外等待

根因：guestChat 在最后一次文本变化后固定等待 30 秒，用来防止流式截断。

现象：网页已经回答完毕，DSH 还要再等很久。

修复：

- 检测到停止按钮时，每 400ms 检查一次；
- 停止按钮消失后 1.2 秒结束；
- 从未看到停止按钮时，最多 4 秒稳定后结束；
- 不再固定等 30 秒。

仍保留硬超时和文本稳定检查，避免读到半截回复。

## 回复中的 "text 复制 下载"

网页版代码块头部包含语言标签和复制/下载按钮。guestChat 克隆 .ds-markdown 后直接 innerText，会把工具栏文字读进答案。

修复：

- 克隆后先移除 button、role=button、copy/download/toolbar/code-header；
- 对 pre 的兄弟节点，删除语言标签和工具条；
- 再执行代码块围栏还原。

因此最终回复只保留代码内容，不再出现：

```text
text 复制 下载
```

## Web 对话上下文双保险

### 第一层：本地自统计

每个 DSH session 的 web state 新增：

- webTokens：当前网页对话累计估算 tokens；
- webGeneration：网页对话代数；
- webUrl：当前网页对话 URL；
- webResetReason：迁移原因。

计数：

- 首次完整 prompt；
- 每轮 delta；
- 每轮网页回复；
- 工具结果作为 delta 计数。

阈值：

- 默认 1,000,000 tokens；
- 90% 触发预压缩；
- 超过 1,000,000 强制压缩。

### 第二层：网页页面自身报满

识别回复/错误中的：

```text
上下文已满 / 超出上限 / 对话过长 / context limit / maximum context
```

命中后：

1. 用当前 DSH 历史生成 checkpoint；
2. fresh=true 新开网页对话；
3. 更新 webGeneration/webUrl；
4. 在回复前显示中文提示；
5. 重试当前请求。

### 压缩与迁移

压缩 prompt 保留：

- system；
- 工具说明；
- 对话头部；
- 最近尾部；
- checkpoint 标记。

DSH 自身消息历史不删除；只压缩发送给新网页对话的上下文。

网页池在新对话成功后写回 web_sessions.json，state 同步 webUrl，实现 DSH session → 新 web URL 的迁移。

### 状态接口

`/v1/context` 现在返回：

- webTokens
- webGeneration
- webUrl
- webResetReason

响应头：

- x-webds-web-tokens
- x-webds-web-generation
- x-webds-web-reset

### 隔离测试

低阈值测试：

```text
r1 generation=1 webTokens=470
r2 generation=2 webTokens=2489
pool: 第二次 fresh=true
state webUrl 更新为新 URL
```

页面报满测试：

```text
第一次回复：上下文已满，无法继续
自动新开网页对话
第二次：RETRY-OK
回复带中文提示
```

## 语义检查点：降低上下文脱离

确定性 head/tail 压缩会丢弃中间细节，存在上下文脱离风险。

新增语义检查点：

1. 触发压缩时，先在当前网页对话中请求一个结构化摘要；
2. 要求保留：
   - 用户目标/约束；
   - 已做决定；
   - 已完成动作；
   - 文件路径、命令、URL、数值、工具结果；
   - 未完成任务和错误；
3. 摘要最多 6000 字符；
4. 新网页对话 = 摘要 + system/工具 + 头尾 checkpoint + 当前请求；
5. 摘要失败时回退确定性 head/tail。

测试：

```text
normal fresh=true
summary fresh=false
normal fresh=true（新网页对话）
state webGeneration=2
state webUrl 更新为新 URL
```

DSH 完整 messages 始终保留，摘要只影响发送给网页版的上下文。
