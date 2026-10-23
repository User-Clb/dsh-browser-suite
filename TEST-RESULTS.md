# 自动对话源隔离测试

分支：`feat/auto-source`
Worktree：`G:\laboratory\dsh-browser-suite-auto-test`
Profile：`~/.dsh/profiles/webds-auto-test`

## 实现方式

- 本地 OpenAI 兼容端点：`http://127.0.0.1:34567/v1`
- pi-ai provider：`web-local`
- 模型：`web-local/web-deepseek`
- 浏览器池：`lib/webds/web-pool.js`
- 网页版生成按账号串行，避免两个页面同时生成导致互踢/超时
- 支持普通文本、tool calls、多轮

## 已验证

| 项目 | 结果 |
|---|---|
| Host 启动 | 通过 |
| 模型注册 / 模型选择器显示 Web DeepSeek | 通过 |
| 单轮文本 | 通过（AUTO-SOURCE-OK） |
| 多轮 | 通过（MULTI-TURN-OK） |
| tool call | 通过（读取 package.json -> dsh-browser-suite） |
| 两个并发请求 | 通过（排队串行执行，均返回） |
| 网页版开关隐藏模型选择 | 通过（模型触发按钮 display:none） |
| 关闭网页版恢复 API 模型 | 通过（恢复 glm-5.3-flash） |
| 侧边栏关闭按钮 | 通过（UI 渲染） |
| 自动对话源开关独立 | 通过（状态、模型选择互不混用） |

## 已知限制

- 网页版实际生成按账号串行；`maxConcurrency` 保留为排队/工作页上限。
- 要真正并行 3 路，需要多个已登录账号/profile，当前未实现。
- 工具调用依赖网页版按约定输出 tool_call 代码块，网页版改版时需回归。
- 测试 profile 使用 `WEBDS_LOCAL_API_KEY` 环境变量启动。

## 启动命令

```powershell
$env:WEBDS_LOCAL_API_KEY='webds-local'
$env:DSH_WEBDS_MAX_CONCURRENCY='3'
dsh --profile webds-auto-test --no-open --port 0
```

## 合并前检查

- 不直接改主 profile。
- 主 profile 继续使用手动桥接。
- 合并回主线前重新跑一遍单轮、多轮、tool call、并发 2/3。
