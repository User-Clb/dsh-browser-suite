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
