# Agent Note: 社区发行仓库自动化

Status: implemented

[English](2026-08-21-community-distribution-automation.md) | 中文

## 问题

社区桌面仓库继承了 DeepSeek Harness 上游仓库的工作流和依赖更新自动化。上游 Issue 工作流依赖 DeepSeek 组织的标签、项目配置、仓库身份和 GitHub App 凭据，而本仓库既无法使用也不需要这些配置。它的主 CI 拓扑还使用本独立仓库无法分配的私有 larger runner 与 self-hosted runner 池。上游真实 API 工作流假定仓库持有共享的 DeepSeek 凭据，但这个公开发行版采用由用户自行提供模型凭据的方式。Dependabot 最初会为每一项符合条件的更新分别创建 PR（Pull Request），产生的并发桌面构建数量超过了小型社区仓库的有效评审能力。

## 决策

Issue policy 与 Issue lifecycle 工作流文件保留为只能手动运行的说明文件，以便同步上游时理解差异，但不订阅 Issue、评审或 PR 事件。在本仓库定义自己的策略和项目自动化之前，社区协作使用 GitHub 的普通 Issue 与 PR 功能。

主 CI 工作流以标准 GitHub-hosted `ubuntu-latest` runner 上的一组可移植无密钥门禁，替换上游的企业 runner 矩阵。它在 PR、`main` push 和明确手动派发时运行，针对规格更小的公共 runner 限制门禁与测试并发，并执行上游 `check:ci:static`、`check:ci:artifacts`、`check:ci:lint:contracts-ready` 与 `check:node-compat` 门禁。企业聚合中的完整覆盖率、快照与持久 PowerShell 清单仍由上游私有 runner 负责；独立的 Desktop 工作流负责 macOS 和 Windows 目标平台原生测试与打包。

独立的[真实 API e2e 工作流](../testing/2026-06-19-real-api-e2e-ci.zh.md)只能手动运行。普通 push 和 PR 运行无密钥检查；维护者配置 `DEEPSEEK_API_KEY_EXTERNAL` 后，可以明确触发真实测试套件。它仍通过 preflight 拒绝缺少密钥的运行，因此主动请求的真实 API 测试不会产生虚假的绿色结果。

[Dependabot 策略](2026-07-27-dependabot-version-updates.zh.md)保留 30 天冷却期和每周检查计划。每个已配置的生态会把所有符合条件的版本更新合并到一个 PR 中，并把每个生态同时打开的版本更新 PR 限制为一个。Dependabot 安全更新不受该版本更新数量限制和冷却期约束。

该配置进入默认分支后，最初未分组的 Dependabot PR 将全部关闭。依赖更新绝不自动合并。

[Desktop 工作流](../../../../.github/workflows/desktop.yml)在原生 macOS arm64 和 Windows x64 托管 runner 上检查运行时源码变更。`desktop-v*` 标签必须与 JavaScript 和原生应用版本一致。两个目标均构建成功后才允许发布安装包及校验和文件，PR 不发布版本。生成校验和前，工作流将安装包文件名中的空格替换为点，与 GitHub 上传后的产物名称保持一致。[桌面发布测试](../../../../scripts/desktop-release.spec.ts)覆盖版本检查、runner 矩阵、产物要求和仅标签触发的发布。

[工作流测试](../../../../scripts/ci-workflow.spec.ts)保留上游的平台、wheel 包和依赖布局断言，同时接受社区 runner 与触发策略。pnpm 安装目录包含运行 id 和尝试次数，手动真实 e2e 采用上游的四个 worker 子进程限制。每个自动 PR 工作流都会检查是否使用了上游私有 runner 标签。

上游 Cloudflare 预览工作流保留为只能手动运行的说明任务。本仓库无法使用它的私有 runner 和 Cloudflare 账户，源码贡献也不代表授权部署网站。CI 仍保留无密钥的文档构建；公开托管需为社区仓库单独配置。

桌面 TypeScript 测试命令为测试及清理阶段提供 90 秒，与仓库 Windows 子进程测试通道的预算一致。构建环境回归会实际执行 Git 初始化、提交、状态查询和本地子模块克隆；托管 Windows runner 上的默认五秒用例限制可能在该序列结束前到期。命令保留文件并行和所有断言，不重试或跳过用例。发布策略测试会拒绝缺少任一预算的配置。这允许测试前置数据执行得更慢，不改变应用启动期限。

## 考虑过的替代方案

- **重新创建上游 GitHub App、标签和项目配置。** 不采用，因为社区仓库不使用上游组织的分诊流程；复制上游凭据或标识符也不能形成适合本仓库的策略。
- **重新创建上游私有 runner 集群。** 不采用，因为社区仓库需要可移植的公共验证信号，而不是绑定 DeepSeek 组织不可用基础设施的永久排队作业。
- **保存共享的模型提供方密钥，并在每次 push 和 PR 时运行真实 API e2e。** 不采用，因为文档修改和社区贡献不值得扩大凭据暴露面或产生提供方费用；发布验证可以明确请求运行该工作流。
- **完全禁用 Dependabot 版本更新。** 不采用，因为经过分组和评审门禁的更新既能保持依赖可见性，也不会形成初始 PR 洪峰。安全更新仍须及时提出。

## 后果

- 普通 Issue、评审、PR 和 push 活动不会启动依赖上游专用凭据或仓库身份的工作流。
- PR 会从公共 GitHub-hosted 基础设施获得真实的无密钥 CI 结论，不再无限等待不可用的私有 runner。
- 真实模型提供方回归不再自动充当合并信号；当提供方行为或候选发行版需要验证时，维护者运行带凭据的工作流。
- npm、Python SDK 和 GitHub Actions 的常规版本更新各自最多产生一个打开的分组 PR，安全更新仍可单独创建。
- 同步上游时，应把这些自动化文件视为有意保留的社区覆盖层，而不能直接采用上游的触发器和凭据策略。
