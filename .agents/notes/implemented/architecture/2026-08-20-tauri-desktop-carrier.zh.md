# Agent Note: 用 Tauri 承载现有 Harness 桌面运行时

Status: implemented

[English](2026-08-20-tauri-desktop-carrier.md) | 中文

## 问题

DeepSeek Harness 需要可安装的 macOS 和 Windows 应用，但不应把 Electron/Chromium 变成产品必须额外分发、长期承担成本的第二套浏览器运行时。用 Rust 重写 Agent 运行时会复制已经成熟的 TypeScript Cordis 组合、Provider 集成、Web UI、wire contract 和会话语义，最终形成两套可能漂移的产品。直接在随机回环端口加载普通的无认证 Web profile，也会允许本机其他进程调用 Harness 的高权限 RPC。

## 决策

`apps/desktop` 是 Tauri 2 桌面载体。Rust 负责窗口、托盘、原生菜单与标准快捷键、单实例、窗口状态持久化、通知、开机启动、更新器接入点、脱敏诊断导出、原生 bridge 和子进程生命周期；界面继续使用操作系统 WebView 中的现有 React Web profile。Harness 运行时仍是 TypeScript，由 Tauri resource 中随包分发的官方平台 Node.js 22.22.0 执行。

`apps/desktop-runtime` 是生产部署根。它的 manifest（元数据清单）显式闭合 workspace 运行时依赖图，避免 `pnpm deploy --prod --legacy` 静默遗漏只通过 peer 引入的 Harness 包。[依赖生成器](../../../../scripts/sync-desktop-runtime.ts)根据生产依赖图生成清单，[闭包校验器](../../../../scripts/verify-runtime-closure.ts)检查 Profile 可达性。[运行时准备脚本](../../../../apps/desktop/scripts/prepare-runtime.mjs)校验官方 Node 归档的 checksum，并写入运行时清单。每个目标操作系统自行构建运行时与安装包，不在平台之间复制二进制文件。

Rust supervisor 使用生成的 patch 和独立应用数据 `DSH_HOME` 启动 `dsh web`。CLI 提前打印的 `dsh web:` 只代表已分配地址；supervisor 必须等 TCP 真实监听后才导航。运行时意外退出会在稳定端口重启，保留 WebView 和未发送的界面状态。退出时，Unix 通过进程组、Windows 通过 Job Object 管理并终止所有后代进程。

原生依赖重建通过 npm 生命周期执行器处理显式批准的包列表。旧式 pnpm 部署保留 workspace importer 标识和空的根 importer，因此在部署根运行 `pnpm rebuild` 无法遍历到这些依赖。桌面项目将生命周期执行器与 `node-gyp` 固定为开发依赖，并向每个 preinstall、install 和 postinstall 操作显式传入编译器；任一脚本失败都会终止该序列。这避免了 `npm rebuild` 选择自身内置、却不支持构建器所需 Visual Studio 的编译器。Node-gyp 显式接收内置 Node 版本与架构，而不是继承构建器的 ABI；准备步骤再用内置可执行文件验证原生模块加载。这涵盖会话锁使用的 ABI 相关 `fs-ext` 绑定。部署流程没有跨平台原生扩展构建路径，因此在替换输出前拒绝与当前机器不同的运行时目标。

构建环境会把固定的编译器、Node 版本和架构写入其管理的 npm 字段的每一种继承大小写形式。生命周期执行器会再次合并宿主环境，因此保留这些拼写并赋予一致的值，可以防止 Windows 不区分大小写的查找选中陈旧的编译器或 ABI 目标。无关环境字段保持不变。

[导航状态](../../../../apps/desktop/src-tauri/src/navigation.rs)记录请求的源和 WebView 无查询参数根页面的加载完成事件，而不是会轮换的启动 token。同一已加载源的运行时再次就绪时不会重新导航；未完成的首次加载和不同源仍允许导航。上游浏览器 cookie 的签名密钥持久化在桌面 home 中，因此重启后的运行时无需再次交换 token 就能接受已有 cookie。原生策略测试拒绝 token 轮换引起的重载，[内置运行时冒烟测试](../../../../apps/desktop/scripts/smoke-runtime.mjs)会强制终止私有运行时，再检查基于原有 cookie 的 RPC 与 WebSocket 重连。这些检查不能替代目标平台原生输入和附件验收。

[Windows 进程所有者](../../../../apps/desktop/src-tauri/src/runtime_windows.rs)先创建并配置关闭时终止进程的 Job，再以 `CREATE_SUSPENDED | CREATE_NO_WINDOW` 创建运行时。在分配 Job 或恢复线程可能失败之前，子进程已由清理守卫持有。稳定版 Rust 不暴露初始线程句柄，因此通过 Tool Help 找到暂停的子进程线程，再调用 `ResumeThread`。只有运行时管理成功后才启动管道读取线程。如果在创建进程到分配 Job 之间强行终止宿主，仍可能留下暂停的子进程：该设计不声称 Job 分配具有原子性。

退出时会先将 Job 的活动进程上限设为零，再枚举成员句柄，防止清理期间新增成员。通过 PID 获取进程后会验证其 Job 归属，排除已被回收复用的标识。清理会终止 Job 和根进程，回收根进程，等待已持有进程句柄的退出信号，并检查 Job 的活动进程数。Windows [进程终止是异步操作](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess)：仅观察 Job 计数归零不等于等待后代退出信号。启动错误与清理错误分别保留；禁止新增成员或收集句柄失败也不会跳过终止操作。

目标平台原生生命周期测试通过独立进程句柄，观察分配失败、恢复失败、所有者释放、退出期间拒绝新增 Job 成员，以及根进程退出后的后代终止。Windows 测试夹具是清理过环境变量的测试可执行文件子进程，在后代就绪后才公布其 PID。Unix 所有者也会在释放时清理，进程组回归测试依据实际退出状态完成观察。[Desktop 工作流](../../../../.github/workflows/desktop.yml)在各自原生操作系统执行这些测试；仅通过交叉编译检查不能证明 Windows 生命周期行为。这些仅涉及进程所有权的变更不改变模型轨迹或会话格式。

回环地址不是权限边界。WebView 打开上游启动 URL，用其中的随机 token 换取 HttpOnly、SameSite=Strict cookie。上游 Connection host 在分发 HTTP 和 WebSocket 请求前校验浏览器认证，桌面覆盖层不替换该协议。TypeScript 到 Rust 的私有 bridge 使用每次启动单独生成的随机 token，允许的操作仅为状态、显示、通知和开机启动。桌面日志会脱敏启动 URL 中的 token。

桌面数据默认与 CLI 隔离，不会静默共享可变 profile。本版继续在 `credentials` Service 后使用现有只写本地凭证；后续可替换为 Keychain/Credential Manager provider，不改调用方。凭证缺失、格式错误或认证拒绝只显示安全文案，错误行提供直接恢复操作；即使跳过 onboarding，侧栏仍保留持久警告。

桌面覆盖层禁用 Web 组合包提供的源代码目录指导和 URL 环境变量。原生提供方通过 `systemPrompt` 注册已安装应用的环境说明，由现有 `request/header` 事件记录模型可见的准确文本，无需另一条日志路径。注册随提供方生命周期释放，并遵循预设的完整 persona。桌面回放场景验证实际发布的覆盖层、持久化请求头，以及私有 bridge 凭据未被写入；保留 Web watcher 指令会把已安装应用误识别为开发服务器。

内置运行时冒烟测试通过桌面使用的同一套认证历史记录 RPC 检查已发布格式的升级。v0/v1 压缩格式的物理夹具独立于当前写入器，因此打包遗漏迁移支持时检查会失败。验证器依据独立预期比对全部迁移记录和内嵌 Assistant 流，确认源文件字节保留，并检查重启后复用已提交的当前格式文件。它不读取用户数据，也不请求模型推理；原生 GUI 和有代表性的用户数据升级验收仍需单独进行。

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
