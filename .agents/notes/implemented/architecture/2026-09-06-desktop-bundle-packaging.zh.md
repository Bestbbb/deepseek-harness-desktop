# Agent Note: 配置组合包的桌面自带包管理器

Status: implemented

[English](2026-09-06-desktop-bundle-packaging.md) | 中文

## 问题

配置插件 CLI（命令行界面）要求 PATH 中存在 pnpm。已安装的桌面应用不能假定用户拥有包管理器或匹配的 Node 安装。skill（技能）下载器无法证明外部 Cordis 包能向打包应用贡献 Host 行为和浏览器 UI。

## 决策

桌面准备流程把精确固定的 pnpm 开发依赖复制到生成的运行时资源中，保留包的许可证文件、记录版本，并在内置 Node 旁添加可迁移启动脚本。启动脚本直接选择相邻的 Node。[打包冒烟测试](../../../../apps/desktop/scripts/smoke-plugins.mjs) 使用现有打包的 `dsh plugin` 入口、配置 manifest（元数据清单）和 `dsh.bundle.patch` 组合方式；不引入新的可执行插件格式或应用启动器。

冒烟测试创建独立主目录和带有 Host 与预构建客户端部分的离线文件包。子进程环境排除账号凭据、Node 注入变量和外部包管理器配置。PATH 中只有打包的可执行文件。安装脚本与 pnpm 钩子均被禁用。会失败的 postinstall fixture（测试前置数据）防止意外启用的生命周期静默通过。浏览器 fixture 使用现有语言与 slot 服务，不向页面插入无关文档。

[移除仓库插件](../../archived/simplification/2026-08-09-remove-repository-plugin.md)仍约束唯一的组合包分发路径。其宿主 PATH 假定继续描述独立 CLI；桌面部署显式提供包管理器运行时，不恢复配置时缓存。[桌面载体](2026-08-20-tauri-desktop-carrier.zh.md)、[agent 启用选项](../feature/2026-09-06-desktop-local-agent-opt-ins.zh.md)和[纯数据 skill](../feature/2026-09-06-desktop-curated-skills.zh.md)保留各自独立职责。

## 考虑过的替代方案

**要求用户安装 Node 和 pnpm。** 桌面打包不采用此方案，因为它让插件兼容性依赖无关的开发环境。

**在 Rust 中另建插件下载器和加载器。** 不采用，因为组合包装配与依赖协调已有上游责任方。原生进程监管仍与插件管理策略分离。

**立即开放任意安装按钮。** 不采用，因为打包证据不提供发布者信任、依赖批准、可恢复更新或配置流程。

## 影响

[审核文件准备决策](2026-09-06-reviewed-bundle-preparation.zh.md) 负责冒烟测试的安装前暂存步骤；包管理器和启用检查仍是独立验收标准。

应用携带额外的固定依赖并承担其维护成本。打包验收覆盖离线安装、Host 激活、浏览器渲染、安装失败后的保留、卸载以及后续正常启动。迁移测试独立验证启动脚本；临时路径、存储、配置和监听器均归各测试所有。托管桌面 CI 在 macOS arm64 与 Windows x64 上运行冒烟测试。本地运行仅证明当前执行平台，Chromium 证据不等于原生 WebView 验收。

源码入口检查排除生成的桌面运行时目录，与排除已构建包输出的方式一致；它仍拒绝相邻源码和资源目录中未分类的可执行文件。第三方打包工具属于部署产物，不是额外受支持的 Harness 启动器。

[桌面市场](../../../../packages/desktop/bundle-marketplace/README.zh.md)通过准备服务使用此工具构建下次启动候选，正在运行的配置及凭据保持不变。[作者指南](../../../../docs/cookbook/desktop-marketplace-bundle.zh.md)负责贡献与验收流程。在线目录验证、权限执行、原生 UI 验收和通用第三方兼容性仍属于[市场提案](../../proposed/architecture/2026-09-06-desktop-plugin-marketplace.zh.md)中的独立工作。
