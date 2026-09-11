# Cookbook: 为桌面贡献审核组合包

[English](desktop-marketplace-bundle.md) | 中文

## 概述

将一项能力打包，让桌面用户无需编辑配置即可安装、打开界面及移除。本指南覆盖随应用分发的审核目录中的仓库内候选，不提供自助发布或任意 npm 安装。Bundle（组合包）组合 Cordis 插件；Skill 和 MCP 连接可以作为其内容，但不能替代包本身及其生命周期。

## 目录

- [选择示例](#choose-an-example)
- [构建组合包](#build-the-bundle)
- [加入审核产物](#add-the-reviewed-artifact)
- [验证用户流程](#verify-the-user-journey)
- [准备审阅](#prepare-the-review)
- [进一步探索](#further-exploration)
- [开发备注](#dev-note)

-----

<a id="choose-an-example"></a>
## 选择示例

准备可工作的代码检出及[桌面开发环境](../../apps/desktop/README.zh.md#development)。选择与能力匹配的最小示例：

| 示例 | 适用场景 |
|---|---|
| [Focus Timer](../../packages/desktop/focus-timer/README.zh.md) | 无需账户、可保存偏好的界面 |
| [Notification Controls](../../packages/desktop/notification-controls/README.zh.md) | 对现有原生能力施加策略 |
| [Delegate Tasks](../../packages/desktop/delegation-launcher/README.zh.md) | 显式用户命令、远程读取及后台任务控制 |

保留现有模块对 agent（智能体）循环、凭据及原生恢复的职责。使用[文档中的扩展点](../architecture.zh.md)，不要另建调度器或应用启动器。

<a id="build-the-bundle"></a>
## 构建组合包

按照[包创建清单](adding-a-package.zh.md)创建包。参考所选示例的 manifest（元数据清单）与构建配置，而不是复制其业务逻辑。manifest 声明 `dsh.bundle.patch`；补丁插入具名 Cordis 配置项。浏览器贡献声明客户端入口及依赖。打包后必须保留包的编译产物、补丁和所需依赖文件。

桌面安装器使用内置包管理器离线安装，禁用生命周期脚本和 pnpm 钩子。不要依赖用户安装 Node、postinstall 构建或注册表下载。通过现有构建配置保持 Harness 与 Cordis 共享模块的身份，不要把第二套运行时内嵌到插件。

通过 `settings.bundleMarketplace.action` 提供明确的使用或配置入口，以包名作为键。通过设置能力保存偏好，将产品文案放入类型化的中英文字典，并在贡献卸载时释放订阅。需要账户的包必须在执行前说明配置方式及账户用量；安装不等于同意启动工作。

<a id="add-the-reviewed-artifact"></a>
## 加入审核产物

[目录构建器](../../apps/desktop/scripts/runtime-marketplace.mjs)管理准入列表。当前条目把 `id` 映射到 `packages/desktop/<id>` 与 `@deepseek-ai/dsh-<id>`；包版本必须与 Harness 根版本一致。在该列表加入审核身份，并更新构建器的[测试前置数据](../../scripts/desktop-marketplace.spec.ts)。不要编辑生成的目录文件或 tarball。

从仓库根目录构建并准备源码开发目录：

```sh
pnpm run build
node apps/desktop/scripts/prepare-marketplace.mjs
```

生成目录位于 `apps/desktop/resources/marketplace`。目录记录产物大小与 SHA-256、精确 Host 版本及目标平台、发布者和来源。审阅前检查生成的条目。哈希证明字节一致性，不证明发布者可信；[严格解析器](../../packages/desktop/bundle-preparation/src/catalog.ts)拒绝未声明字段。在目录支持相应字段前，用途、许可证、截图及访问权限说明放在包 README 和审阅证据中。

<a id="verify-the-user-journey"></a>
## 验证用户流程

为新组合包在[打包冒烟测试](../../apps/desktop/scripts/smoke-plugins.mjs)中添加用例；现有示例通过不代表新包经过测试。准备目标运行时，并在开发用 Playwright Chromium 浏览器可用时运行冒烟测试：

```sh
node apps/desktop/scripts/prepare-runtime.mjs
node apps/desktop/scripts/smoke-plugins.mjs
```

验证浏览不启动安装或推理、安装需要确认、源组合保持不变、下次启动解析到审核产物、“已安装”入口打开真实能力，以及再次启动后移除该能力且不删除用户数据。在能力负责的范围内覆盖访问拒绝、依赖不可用、操作中断及清理。将预期 UI 输出放在测试旁，并按[测试策略](../testing.zh.md)为模型可见行为添加会话记录回放覆盖。

浏览器冒烟测试模拟原生排队回执。运行独立的[原生选择及恢复测试](../../apps/desktop/src-tauri/src/runtime_profile_tests.rs)，再用独立应用身份与数据目录，在已解锁的机器上验证真实 macOS 或 Windows 窗口。不要将构建、Chromium 运行或模拟提供方视为原生 UI、其他平台或真实账户验收。

<a id="prepare-the-review"></a>
## 准备审阅

一起提交源码、依赖及许可证变更、组合包补丁、中英文包文档、决策记录和确切验证结果。说明用户获得什么、插件可访问哪些数据与进程、是否消耗账户额度，以及配置、失败和移除的行为。提供构建后界面的截图，而不是设计稿。

Host 插件以 Harness 的访问权限执行受信任代码；审核标签不是隔离机制。运行时失败恢复会保留前一个选择，但无法撤销插件副作用，也不保证数据降级。本作者流程不提供远程目录分发、发布者投稿、发布者身份验证或更强隔离。

<a id="further-exploration"></a>
## 进一步探索

- [组合包准备](../../packages/desktop/bundle-preparation/README.zh.md)——产物与候选验证。
- [桌面市场](../../packages/desktop/bundle-marketplace/README.zh.md)——浏览、安装及版本观测。
- [打包决策](../../.agents/notes/implemented/architecture/2026-09-06-desktop-bundle-packaging.zh.md)——内置工具和验证边界。

<a id="dev-note"></a>
## 开发备注

无。
