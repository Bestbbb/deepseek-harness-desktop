# Agent Note: 用 Tauri 承载现有 Harness 桌面运行时

Status: implemented

[English](2026-08-20-tauri-desktop-carrier.md) | 中文

## 问题

DeepSeek Harness 需要可安装的 macOS 和 Windows 应用，但不应把 Electron/Chromium 变成产品必须额外分发、长期承担成本的第二套浏览器运行时。用 Rust 重写 Agent 运行时会复制已经成熟的 TypeScript Cordis 组合、Provider 集成、Web UI、wire contract 和会话语义，最终形成两套可能漂移的产品。直接在随机回环端口加载普通的无认证 Web profile，也会允许本机其他进程调用 Harness 的高权限 RPC。

## 决策

`apps/desktop` 是 Tauri 2 桌面载体。Rust 负责窗口、托盘、原生菜单与标准快捷键、单实例、窗口状态持久化、通知、开机启动、更新器接入点、脱敏诊断导出、原生 bridge 和子进程生命周期；界面继续使用操作系统 WebView 中的现有 React Web profile。Harness 运行时仍是 TypeScript，由 Tauri resource 中随包分发的官方平台 Node.js 22.22.0 执行。

`apps/desktop-runtime` 是生产部署根。它的 manifest（元数据清单）显式闭合 workspace 运行时依赖图，避免 `pnpm deploy --prod --legacy` 静默遗漏只通过 peer 引入的 Harness 包。[依赖生成器](../../../../scripts/sync-desktop-runtime.ts)根据生产依赖图生成清单，[闭包校验器](../../../../scripts/verify-runtime-closure.ts)检查 Profile 可达性。[运行时准备脚本](../../../../apps/desktop/scripts/prepare-runtime.mjs)校验官方 Node 归档的 checksum，并写入运行时清单。每个目标操作系统自行构建运行时与安装包，不在平台之间复制二进制文件。

Rust supervisor 使用生成的 patch 和独立应用数据 `DSH_HOME` 启动 `dsh web`。CLI 提前打印的 `dsh web:` 只代表已分配地址；supervisor 必须等 TCP 真实监听后才导航。运行时意外退出会在稳定端口重启，保留 WebView 和未发送的界面状态。退出时，Unix 通过进程组、Windows 通过 Job Object 管理并终止所有后代进程。

回环地址不是权限边界。WebView 打开上游启动 URL，用其中的随机 token 换取 HttpOnly、SameSite=Strict cookie。上游 Connection host 在分发 HTTP 和 WebSocket 请求前校验浏览器认证，桌面覆盖层不替换该协议。TypeScript 到 Rust 的私有 bridge 使用每次启动单独生成的随机 token，允许的操作仅为状态、显示、通知和开机启动。桌面日志会脱敏启动 URL 中的 token。

桌面数据默认与 CLI 隔离，不会静默共享可变 profile。本版继续在 `credentials` Service 后使用现有只写本地凭证；后续可替换为 Keychain/Credential Manager provider，不改调用方。凭证缺失、格式错误或认证拒绝只显示安全文案，错误行提供直接恢复操作；即使跳过 onboarding，侧栏仍保留持久警告。

## 考虑过的替代方案

- **Electron**：Harness 不需要额外捆绑 Chromium，也不需要 Node-in-renderer；系统 WebView 加受控 Node sidecar 可以保留同一个产品，并显著减少壳层开销，因此未采用。
- **Rust/GPUI 全量重写**：首版会复制 Agent 语义和完整 UI，因此未采用。Rust 只用在真正有价值的操作系统与生命周期边界，而不是成为第二套 Harness。
- **所有 Harness 操作都改成 WebView 调 Tauri command**：这会替换现有 typed HTTP/WebSocket transport，并把所有 Agent API 耦合到壳层，因此未采用。
- **无认证的随机回环端口**：端口随机性无法防止本机其他进程访问，因此未采用。
- **默认共享 CLI home**：没有明确的导入/迁移设计时，并发 schema/config 修改和卸载语义都不安全，因此未采用。

## 结果

- macOS 与 Windows 共用 TypeScript Agent 核心和 React 界面，只有小型原生宿主针对平台实现。
- 应用包会比纯 Rust 客户端更大，因为它有意包含生产 Harness 闭包和官方 Node；但不会包含 Chromium。
- 运行时 readiness、认证 RPC/WebSocket、生命周期清理和目标平台原生打包都成为可复现的 CI 门槛。
- 用户主动导出的诊断只含运行时元数据和有大小上限的桌面日志尾部；产品数据不进入导出，写盘前会清除桌面 token、Bearer 值、常见凭证字段与用户主目录路径。
- macOS 预览版构建使用 ad-hoc 身份，使嵌套代码与 bundle resources 的签名一致，但未经公证。Windows 预览版未签名。预览版发布说明会告知操作系统的启动警告。经过发布者验证的分发和自动更新需要所有者提供签名及更新配置；secret 永不提交。
