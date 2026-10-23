# 自动对话源隔离测试

分支：`feat/auto-source`
Worktree：`G:\laboratory\dsh-browser-suite-auto-test`
Profile：`~/.dsh/profiles/webds-auto-test`

## 实现方式

- 本地 OpenAI 兼容端点：`http://127.0.0.1:34567/v1`
- pi-ai provider：`web-local`
- 模型：`web-local/web-deepseek`
- 浏览器池：`lib/webds/web-pool.js`
- 每个 DSH 对话/子会话使用独立网页会话；会话键由历史首条消息派生
- 网页版生成按账号串行，避免两个页面同时生成导致互踢/超时
- 支持普通文本、tool calls、多轮
- 上下文自统计上限默认 1,000,000 tokens；超过后压缩并新开网页对话

## 已验证

| 项目 | 结果 |
|---|---|
| Host 启动 | 通过 |
| 模型注册 / 模型选择器显示 Web DeepSeek | 通过 |
| 单轮文本 | 通过（AUTO-SOURCE-OK） |
| 多轮 | 通过（MULTI-TURN-OK） |
| 独立网页会话记忆 | 通过（Alice -> 后续回答 Alice） |
| 会话隔离 | 通过（主请求与标题请求产生不同 context id） |
| tool call | 通过（读取 package.json -> dsh-browser-suite） |
| 两个并发请求 | 通过（排队串行执行，均返回） |
| 网页版开关隐藏模型选择 | 通过（模型触发按钮 display:none） |
| 关闭网页版恢复 API 模型 | 通过（恢复 glm-5.3-flash） |
| 侧边栏关闭按钮 | 通过（UI 渲染） |
| 自动对话源开关独立 | 通过（状态、模型选择互不混用） |
| 上下文压缩触发 | 通过（低阈值测试 x-webds-compacted=1，新开对话） |
| 主/子会话配合 | 子会话成功创建并独立运行；主模型对子任务指令的服从性需继续调 prompt |

## 已验证的客户端命令

主 DSH 的测试 profile 通过 127.0.0.1 的 DSH Web UI 实际输入并观察回复，不是仅脚本模拟。

## 已知限制

- 网页版实际生成按账号串行；`maxConcurrency` 保留为排队/工作页上限。
- 要真正并行 3 路，需要多个已登录账号/profile，当前未实现。
- 工具调用依赖网页版按约定输出 tool_call 代码块，网页版改版时需回归。
- 测试 profile 使用 `WEBDS_LOCAL_API_KEY` 环境变量启动。
- 主 profile 尚未合并本分支。

## 启动命令

```powershell
$env:WEBDS_LOCAL_API_KEY='webds-local'
$env:DSH_WEBDS_MAX_CONCURRENCY='3'
$env:DSH_WEBDS_CONTEXT_TOKENS='1000000'
dsh --profile webds-auto-test --no-open --port 0
```

## 合并前检查

- 不直接改主 profile。
- 主 profile 继续使用手动桥接。
- 合并回主线前重新跑一遍单轮、多轮、tool call、并发 2/3、上下文压缩。
