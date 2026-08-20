# @deepseek-ai/dsh-desktop-native

[English](README.md) | 中文

`dsh-desktop-native` 通过随机回环 origin 把每次操作转发到 Tauri 进程，以此提供 `ctx.desktop`。Tauri supervisor 向内置 Node 进程注入该 origin 和另一枚每次启动重新生成的 256 位 token。提供方会在发送 token 之前拒绝非回环 origin，并且从不把 token 放进 URL 或诊断信息。

## 配置

`endpoint` 必须是精确的 `http://127.0.0.1:<port>` origin。`token` 必填并带有 secret role。`timeoutMs` 默认是 5000 毫秒，分别作用于每次操作。

只有桌面 overlay 会挂载该提供方。普通浏览器和 headless 调用既没有 bridge 环境变量，也没有该服务。

## 模型体验

### 原生 bridge 操作

#### 模型看到什么

没有直接内容。`NativeDesktopHost.notify()` 负责传递 consumer 请求，不返回面向模型的文字。

#### Token 影响

该提供方不增加提示词、消息、schema 或工具结果。

#### KV Cache 影响

原生 bridge 流量位于模型请求之外，并保留所有可复用前缀。

## 已知限制与延后工作

- **单向可用性** — 提供方可以调用 Rust，但没有暴露从 Rust 进入 Harness 的原生事件流；菜单目前直接派发到 WebView。
