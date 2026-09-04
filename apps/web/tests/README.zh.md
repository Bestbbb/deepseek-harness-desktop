# apps/web 浏览器 e2e

[English](README.md) | 中文

这些测试在进程内启动真实的 web 组合，并用真实 Chromium 通过真实 HTTP 驱动它。该 lane 的运行机制——模式、fixture、golden，以及与 `dsh web` 之间刻意保留的组合差异——记录在 [`scaffold.ts`](scaffold.ts) 和[浏览器 e2e Agent Note](../../../.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.zh.md)中。

## 手动性能诊断

[手动测试清单](../../../vitest.web.perf.config.ts)不属于默认 CI。构建 Web 客户端资源后，用确定性模型回放运行[复杂历史基准测试](complex-history.perf.ts)：

```sh
DSH_SNAPSHOT=replay corepack pnpm exec vitest run --config vitest.web.perf.config.ts apps/web/tests/complex-history.perf.ts
```

基准测试检查已存储的会话数量，通过溢出控制展开紧凑侧栏，并区分 Trajectory 的逻辑记录与实际挂载的虚拟行。Chat 与 Trajectory 各自分页；完整历史断言保留 500 轮 fixture 及其 2,100 条轨迹记录。续聊场景对照默认 24 轮窗口与完整加载的历史，并在生成 100 轮后采样下一条用户消息的绘制时间。

`WEB_PERF_RESULT` 报告测量结果，不设置速度阈值。CDP 计时与强制 GC 后的 JavaScript 堆采样描述本次 Chromium 运行，不代表原生 WKWebView/WebView2 延迟或整个桌面的内存。断言失败与清理失败会同时报告；teardown 不会替换最初的错误。

## 这些是 Host 面的测试

它们在根 `tsconfig.host.json` 中做类型检查，而不在 Client aggregate 中，因为它们直接读取 Host 服务：`ctx.connection`、Host 侧 `SessionStore` 与 `ctx.sessionProjectionCache`。运行时驱动浏览器并不使一个文件成为 Client 程序的一部分——两个 face 在相同的键上以不同服务合并 cordis `Context`，因此单个程序无法同时看见两者。把这些文件挪进 Client aggregate 会让每一处 Host 服务访问都无法编译。

## 不要在此 import `@deepseek-ai/dsh-client-*`

import 一个 Client 包——无论值还是类型——都会把它整个 TypeScript 工程、以及它引用的每个工程拉进 **Host 构建图**。四个 Client 消费方包引用了 `api/remotes` 的 Client face，而该 face 必须等 Host tsdown 生成 `@deepseek-ai/dsh-goal/remote` 之后才能编译；import 这些包会使 Host 构建阶段等待由自身产出的产物。

当某个场景需要 Client 持有的常量或纯函数时，改为在此处镜像一份，并紧挨着一条注释掉的 import 点明源模块。这样漂移会表现为选择器未命中或镜像值过期——是响亮的失败，绝不会是静默通过。`scaffold.ts` 按此规则镜像欢迎声明的 namespace、确认字段、版本和被断言的中文文案。

有一类 Client import 是长期成立的。`assembled-boot.ts` 驱动 shell 本身，因此它从 `@deepseek-ai/dsh-client-web` import `AppWebEntry`、从 `@deepseek-ai/dsh-client-modules/client` import boot manifest 类型：启动真实 shell 正是该 harness 的用途，且这两个包本来就在 Host 图中。chat 场景则在 `support.ts` 中镜像 `conversationContextKey`，而不 import 其 Client owner。

没有任何机制强制这条规则；靠 review 守住它。
