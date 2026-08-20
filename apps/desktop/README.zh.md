# Harness Desktop

[English](README.md) | 中文

这是 DeepSeek Harness 面向 macOS 和 Windows 的 Tauri 2 桌面载体。Rust 负责应用生命周期和操作系统原生集成；现有 TypeScript Harness 运行时与 React Web profile 仍是产品核心。因此它不需要捆绑 Chromium/Electron，也不需要把 Agent 系统重写成第二套实现。

## 架构

应用会立即用系统 WebView 打开本地加载页。Rust supervisor 启动随包分发的官方 Node.js 可执行文件和生产 `dsh web` 完整依赖闭包，等待回环地址真正开始监听，再把同一个 WebView 导航到稳定的 Harness 地址。

每次启动都会生成两枚互相独立的 256-bit 随机 token：

- WebView 到 Harness 的 HTTP 和 WebSocket 流量必须携带桌面会话 token；未认证的本机回环请求会收到 HTTP 403。
- Harness 到原生宿主的操作使用另一条经过认证的回环 bridge；它只暴露状态、显示/聚焦、通知和开机启动操作。

Rust supervisor 拥有完整子进程树：macOS 使用 Unix 进程组，Windows 使用 Job Object；运行时意外退出会在同一端口重启，应用退出时会终止所有后代进程。窗口状态、单实例激活、标准窗口与编辑快捷键、原生菜单、托盘、通知、开机启动和更新器基础能力都由 Tauri 原生实现。应用菜单可以导出有大小上限的诊断文本；导出器不会读取会话、配置、凭证或用户文件，并会在写盘前脱敏桌面 token、Bearer 凭证、API key 字段和用户主目录前缀。

桌面数据位于 Tauri 应用数据目录下独立的 `harness` home，不会修改用户的 CLI profile。会话、设置和只写凭证存储可以跨应用更新保留，同时与单独安装的 CLI 隔离。

## 开发

环境要求：Node.js 22、pnpm 11.7、Rust stable，以及 Tauri 2 对应平台的系统依赖。

```sh
pnpm install --frozen-lockfile
pnpm run desktop:prepare
pnpm run desktop:smoke
pnpm run desktop:dev
```

`desktop:prepare` 会构建 Harness、部署闭合的生产 workspace 依赖图、下载对应平台的官方 Node.js 22.22.0 发行包、校验 SHA-256，并生成 Tauri resource 目录。`desktop:smoke` 会启动这份真实的打包运行时，验证认证后的 HTTP RPC 和两条 WebSocket 事件流。

正式发布路径会在目标操作系统上构建安装包：

```sh
pnpm run desktop:build
```

macOS 会产出 `.app` 和 `.dmg`；Windows 会产出 MSI 和用户级 NSIS 安装包。`.github/workflows/desktop.yml` 在 macOS arm64 与 Windows x64 runner 上执行同一套准备、冒烟、Rust 测试和目标平台原生打包流程。

也可以按 Tauri 的 `cargo-xwin` 备用方案，在 macOS 或 Linux 上交叉构建 Windows x64 NSIS 安装器。安装 `cargo-xwin`、LLVM/LLD 和 `makensis` 后，先准备 Windows 依赖闭包，再调用 Tauri；MSI 仍然只能在 Windows 上生成。

```sh
DSH_DESKTOP_TARGET_PLATFORM=win32 DSH_DESKTOP_TARGET_ARCH=x64 \
  pnpm --filter @deepseek-ai/dsh-desktop-app run prepare-runtime
PATH="/opt/homebrew/opt/llvm/bin:$PATH" \
  pnpm --filter @deepseek-ai/dsh-desktop-app exec tauri build \
  --runner cargo-xwin --target x86_64-pc-windows-msvc \
  --config '{"bundle":{"targets":["nsis"]}}' --ci
```

## 发布门槛

本地 macOS 构建使用 Tauri 的 ad-hoc 签名身份，使完整嵌套 bundle 具备有效的开发签名；它没有经过公证，macOS 仍可能要求用户手动允许。本地 Windows 安装器未签名，可能触发 SmartScreen。公开分发需要仓库所有者配置 Apple Developer ID/公证凭证、Windows 代码签名证书，以及 Tauri 更新签名密钥和发布地址；发布凭证会覆盖 ad-hoc 身份，必须只作为 CI secret 保存，本包不会生成或提交它们。

当前凭证 provider 是隔离桌面数据目录中的 Harness 只写本地 provider。后续可以在相同 `credentials` Service 后加入 macOS Keychain/Windows Credential Manager，不需要改动 WebView、Agent 运行时或设置界面。
