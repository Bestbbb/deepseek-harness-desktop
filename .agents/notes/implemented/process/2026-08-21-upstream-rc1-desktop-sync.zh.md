# Agent Note: 保持桌面发行版与上游 Harness 对齐

Status: implemented

[English](2026-08-21-upstream-rc1-desktop-sync.md) | 中文

## 问题

Harness Desktop 最初基于 `dsh-v0.1.0-rc.8`，而上游 `dsh-v0.1.1-rc.1` 已把产品组合方式改为 Profile 与可安装 Bundle，加入动态 Cordis 插件界面和凭据授权流程，扩展提供方与多模态行为，并新增可选的 Codex 与 Claude Code 子代理提供方。如果桌面运行时继续停留在 rc.8，其模型、插件和会话行为会与用户预期的 Harness 版本分离；如果直接用上游完整覆盖桌面分支，又会删除 Tauri 生命周期、经过认证的回环边界、打包运行时闭包和公共社区自动化策略。

## 决策

社区仓库历史合并确切的公开上游标签 `dsh-v0.1.2-rc.1`，同时把桌面实现保留为一层狭窄覆盖。覆盖层包括 Tauri 应用、桌面运行时依赖根、`ctx.desktop` seam 与原生 provider、Profile patch、桌面测试与打包工作流，以及桌面专属文档。各 package 与 Tauri 版本跟随上游 Harness 版本，使随包运行时 manifest 标出的版本与其中真实代码一致。

桌面运行时启动上游 `web` Profile，只把 `desktop.cordis.yml` 作为最终启动覆盖层应用。运行时依赖根跟随当前 Web 生产闭包，其中包含插件清单、授权、提供方和客户端 package。桌面端不 fork agent loop、LLM 适配抽象、Profile loader 或插件管理器。[依赖生成](../../../../scripts/sync-desktop-runtime.ts)和[发布校验](../../../../scripts/verify-desktop-release.ts)会在打包前拒绝陈旧的包清单，以及不一致的原生组件和运行时版本。

Codex 与 Claude Code 仍是彼此独立的可选上游 Profile Bundle：`@deepseek-ai/dsh-subagent-codex` 和 `@deepseek-ai/dsh-subagent-claude-code`。它们不会进入默认桌面生产闭包。安装其中一个并重启 Profile 后，其休眠 Host provider 才会可用；复制的 Agent Preset 还必须单独启用对应的 `subagent_codex` 或 `subagent_claude_code` 工具。每个 provider 使用自己固定版本的产品运行时和用户对应的产品登录态；Harness Desktop 不收集这些产品凭据，也不会在工具调用前启动 provider。

插件转发器会在自己管理的子进程范围内，明确豁免 pnpm 的 workspace root 变更保护。Profile 本来就是只有一个 package 的 workspace；如果没有这项局部设置，pnpm 11 会拒绝在根目录执行 `add` 与 `remove`，其中也包括安装可选子代理 Bundle。这个环境覆盖不会改变转发参数，因此非变更类命令仍保持原有语义，用户也不需要自行添加 pnpm 的 `-w` 参数。

当 `plugin add` 收到未带版本的第一方 package 时，转发器还会把它固定到当前 DSH 发行版本。部分 rc.1 Bundle 的 npm `latest` 标签有意落后于预发布 `next` 标签；如果让可选 provider 的裸包名按 `latest` 解析，就会选中已经过时的 0.0.1 依赖图，其中未发布的 `dsh-type-meta` 依赖会让文档中的安装命令直接失败。用户显式指定的版本、标签、别名、URL、路径以及所有第三方 package 都不会被改写。

本次及后续上游合并都继续保留[社区自动化策略](2026-08-21-community-distribution-automation.zh.md)这层有意覆盖：标准公共 runner 替代上游私有 runner，依赖上游组织的 Issue Project 变更保持为手动 stub，带凭据的真实提供方 E2E 仍然只能手动运行。

[Markdown 换行检查](../../../../scripts/verify-md-wrap.ts)使用通配文件名发现系统提示词快照，再筛选为确切的 Markdown 文件名。Node 22 的字面文件名 glob 遍历会把快照文件链接当作目录并抛出 `ENOTDIR`。按真实路径去重保留原有检查范围；专项 fixture 验证文件链接并拒绝硬换行正文，不会纳入其他扩展名的快照。

[运行时闭包检查器](../../../../scripts/verify-runtime-closure.ts)同时遍历应用入口、包与 vendor 的清单。桌面和 Python 部署根目录都声明从 CLI 依赖图到达的必需对等依赖（peer dependency）；只扫描预设无法发现这些依赖边。测试通过应用入口到达一个缺失的对等依赖，然后验证补齐后的声明。

[运行时输出准备](../../../../apps/desktop/scripts/runtime-output.mjs)在递归清理前检查目录归属。空输出目录会获得标记，使中断构建的目录仍可被替换；已完成的旧输出必须同时具有运行时清单和桌面部署包身份。物理路径检查拒绝仓库、用户主目录、其祖先路径，以及作为输出的目录链接。链接实体化先取消符号链接或 Windows junction，再复制其目标，绝不对链接执行递归删除。[输出测试](../../../../scripts/desktop-runtime-output.spec.ts)通过真实 Node 子进程验证替换行为，以及对无关文件的保留。

翻译发现机制在目录遍历和文件判定中都排除生成的桌面资源、下载的运行时归档、Rust 构建输出和生成的原生元数据。源码中的桌面 README 仍属于双语语料；打包后的副本不会成为独立的文档源码。

## 考虑过的替代方案

- **让桌面发行版继续停留在 rc.8。** 不采用，因为提供方、多模态、凭据、插件和子代理行为会立刻偏离公开 Harness 发行线。
- **用 Rust 重写上游的新行为。** 不采用，因为 Profile、Cordis 插件、模型适配器与 Agent 编排属于 TypeScript 产品语义；重复实现会产生两套不兼容的 Harness。
- **为每个桌面用户默认捆绑并激活 Codex 与 Claude Code。** 不采用，因为它们的平台载荷、产品信任边界和认证要求都是可选的。Host 可用性与逐 Agent 权限应保持显式且可独立移除。
- **原样采用上游 CI 与 Issue 工作流。** 不采用，因为社区仓库不存在相应的私有 runner、组织 App 和 Project board。

## 后果

- 桌面应用无需第二套实现即可获得所选上游发行版的提供方、多模态、授权、Profile、插件和子代理框架。
- Tauri 与经过认证的本地主机边界继续和普通 Web、headless Profile 隔离。
- Codex 与 Claude Code 在显式安装 Profile Bundle、重启 Profile、启用 Agent Preset 并完成对应产品认证后可以作为子代理；仅完成同步不会静默授予任何一个工具。
- 无论从独立 CLI，还是由 pnpm 启动的测试或开发进程执行，Profile 插件安装在 pnpm 11 下都保持可用。
- 未带版本的第一方 Bundle 安装会保持在桌面运行时对应的 DSH 发行版，不会混用 npm 发行通道；用户仍可显式指定其他版本或标签。
- 未来的上游标签继续合并进同一历史，并必须保留已记录的社区与桌面覆盖层，而不是手工复制零散上游文件。
