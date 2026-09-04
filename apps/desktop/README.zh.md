# Harness Desktop

[English](README.md) | 中文

这是 DeepSeek Harness 面向 macOS 和 Windows 的 Tauri 2 桌面载体。Rust 负责应用生命周期和操作系统原生集成；现有 TypeScript Harness 运行时与 React Web profile 仍是产品核心。因此它不需要捆绑 Chromium/Electron，也不需要把 Agent 系统重写成第二套实现。

## 架构

应用会立即用系统 WebView 打开本地加载页。Rust supervisor 启动随包分发的官方 Node.js 可执行文件和生产 `dsh web` 完整依赖闭包，等待回环地址真正开始监听，再把同一个 WebView 导航到稳定的 Harness 地址。

浏览器访问和原生操作使用相互独立的凭据：

- WebView 打开上游带启动 token 的 URL。Harness 将其交换为 HttpOnly、SameSite=Strict cookie，HTTP RPC 与多路复用 WebSocket 使用该 cookie。未认证请求收到 HTTP 401。原生宿主记录运行时输出前会脱敏启动 token。
- Harness 到原生宿主的操作使用另一条经过认证的回环 bridge；它只暴露状态、显示/聚焦、通知和开机启动操作。

Rust supervisor 拥有完整子进程树：macOS 使用 Unix 进程组，Windows 使用 Job Object；运行时意外退出会在同一端口重启，应用退出时会终止所有后代进程。窗口状态、单实例激活、标准窗口与编辑快捷键、原生菜单、托盘、通知、开机启动和更新器基础能力都由 Tauri 原生实现。应用菜单可以导出有大小上限的诊断文本；导出器不会读取会话、配置、凭证或用户文件，并会在写盘前脱敏桌面 token、Bearer 凭证、API key 字段和用户主目录前缀。

Windows 以暂停且不显示控制台窗口的方式创建运行时，在分配到 Job 后才恢复执行。启动过程报告失败时，会先终止并回收子进程再重试。退出时会禁止 Job 接纳新进程，保留成员句柄，并等待其退出信号及 Job 清空；清理错误会写入日志。如果在创建进程到分配 Job 之间强行终止宿主，仍可能留下暂停的子进程；这段启动过程不是原子进程创建。[桌面生命周期决策](../../.agents/notes/implemented/architecture/2026-08-20-tauri-desktop-carrier.zh.md)记录了各平台的验证要求。

File 菜单提供 **New Session**，macOS 上的快捷键为 **Cmd+N**。应用菜单提供 **Settings** 和诊断导出。

主窗口禁用 Tauri 的原生拖放处理器，使上游附件 UI 可以接收浏览器文件拖放事件，包括 Windows 平台。窗口仍由应用初始化过程创建；配置中的加载窗口不会自动创建。

桌面数据位于 Tauri 应用数据目录下独立的 `harness` home，不会修改用户的 CLI profile。会话、设置和只写凭证存储可以跨应用更新保留，同时与单独安装的 CLI 隔离。

## 开发

环境要求：Node.js 22、pnpm 11.7、Rust stable，以及 Tauri 2 对应平台的系统依赖。

```sh
pnpm install --frozen-lockfile
pnpm run desktop:prepare
pnpm run desktop:smoke
pnpm run desktop:dev
```

`desktop:prepare` 检查桌面依赖清单、构建 Harness、部署生产 workspace 依赖图、下载对应平台的官方 Node.js 22.22.0 发行包、校验 SHA-256，并生成 Tauri resource 目录。`desktop:smoke` 启动这份真实的打包运行时，检查匿名访问拒绝、cookie 登录、模型与会话 RPC，以及多路复用 WebSocket 事件流。

准备步骤只替换空目录或已生成的 Harness Desktop 运行时目录。`DSH_DESKTOP_RUNTIME_OUTPUT` 可以指定其他输出位置，但普通文件、目录链接、无关的非空目录，以及包含仓库或用户主目录的路径，都会在清理前被拒绝。旧输出无法证明归属时，请选择空目录；不要在生成的运行时目录中存放个人文件。

正式发布路径会在目标操作系统上构建安装包：

```sh
pnpm run desktop:build
```

macOS 产出 `.app` 和 `.dmg`；Windows 产出用户级 NSIS `.exe` 安装包。依赖树文件较多，因此 Windows profile 避开 WiX/MSI 的文件表限制。[Desktop 工作流](../../.github/workflows/desktop.yml) 负责 macOS arm64 与 Windows x64 runner 上的目标平台原生准备、冒烟测试、Rust 测试和打包；本地 macOS 构建不能验证 Windows 行为。

也可以按 Tauri 的 `cargo-xwin` 备用方案，在 macOS 或 Linux 上交叉构建 Windows x64 NSIS 安装器。安装 `cargo-xwin`、LLVM/LLD 和 `makensis` 后，先准备 Windows 依赖闭包，再调用 Tauri。

```sh
DSH_DESKTOP_TARGET_PLATFORM=win32 DSH_DESKTOP_TARGET_ARCH=x64 \
  pnpm --filter @deepseek-ai/dsh-desktop-app run prepare-runtime
PATH="/opt/homebrew/opt/llvm/bin:$PATH" \
  pnpm --filter @deepseek-ai/dsh-desktop-app exec tauri build \
  --runner cargo-xwin --target x86_64-pc-windows-msvc \
  --config '{"bundle":{"targets":["nsis"]}}' --ci
```

## 发布门槛

macOS 预览构建使用 ad-hoc 签名，未经过公证。Windows 预览包未签名。操作系统可能阻止这些预览包；用户应先评估来源并校验发布文件，再允许运行。未配置签名密钥和发布端点时，自动更新保持关闭。Developer ID 公证、Windows 代码签名和已签名更新元数据需要所有者提供凭据，凭据存于 CI secrets，不存入仓库。

当前凭证 provider 是隔离桌面数据目录中的 Harness 只写本地 provider。后续可以在相同 `credentials` Service 后加入 macOS Keychain/Windows Credential Manager，不需要改动 WebView、Agent 运行时或设置界面。

<a id="following-upstream"></a>

## 跟随上游

在独立分支合并精确的上游发布标签，对照当前 Web profile 解决桌面 overlay 的差异，再运行 `pnpm run desktop:sync` 和 `pnpm install` 记录生产依赖图。`pnpm run desktop:verify` 在打包前拒绝陈旧的依赖图或缺失的预设插件。CLI、桌面包、Cargo 和 Tauri 版本保持一致。每个发布平台都需要构建并冒烟测试内置运行时；不要把一个平台的依赖树复制到另一个平台的安装器中。
