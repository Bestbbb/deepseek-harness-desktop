# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

`dsh-desktop` 定义了 `ctx.desktop`，仅在桌面宿主持有当前 Harness 进程时提供原生能力。该服务包含窗口激活、操作系统通知、登录时启动和可用性探测。提供方必须拒绝桌面宿主未完成的操作，不能在 Node 内静默模拟原生行为。

## 组合

只在桌面专属组合中加载一个 Service Provider。浏览器和 headless profile 不挂载该定义，也不虚构 fallback，因此普通 Harness 部署不携带桌面假设。

## 模型体验

### 原生桌面操作

#### 模型看到什么

没有直接内容。Consumer 决定是否把 `ctx.desktop.notify(...)` 这类原生调用呈现为命令、工具或后台策略。

#### Token 影响

该 Service Definition 不增加提示词、消息、schema 或工具结果。

#### KV Cache 影响

该服务不贡献模型输入，因此保留所有已经可以复用的模型请求前缀。

## 已知限制与延后工作

- **仅限可信 Host consumer** — 该服务没有插件 principal 或逐次调用授权；已挂载的 Host 插件可以调用当前提供方实现的全部操作。
