# Agent Note: Offline Bundle dependency candidates without Profile activation

Status: implemented

[English](2026-09-06-offline-bundle-candidates.md) | 中文

## 问题

审核过的压缩包文件不代表 Bundle 拥有可用依赖。安装到活动 Profile 可能在配置和启用检查结束前触发重载。候选准备需要独立目标目录，以及取消后不会留下安装器进程的生命周期。

## 决策

可选的[操作历史](2026-09-07-preparation-operation-history.zh.md)保留准备观测，不改变依赖验证或授予启用权限。

可选的 [Bundle 准备服务](../../../../packages/desktop/bundle-preparation/README.zh.md) 在[文件准备](2026-09-06-reviewed-bundle-preparation.zh.md)之外提供 `prepareDependencies()`。它接收当前目录标识，重新验证文件及限量压缩包内容，然后通过现有本地子进程提供方调用部署指定的 Node 和固定版本 pnpm。不需要修改核心加载器、智能体循环或 vendored Cordis。

每个操作拥有独立的非 Profile 项目、空包存储和安装器主目录。除 Windows 系统位置外，继承环境变量均被移除；脚本、pnpm 钩子、peer 自动安装及注册表下载均被禁用。仅支持审核过的自包含 Bundle。压缩包检查器在解包前拒绝链接、特殊条目、不可移植路径、身份不匹配和缺失 Bundle 补丁。成功候选包含已验证的安装身份、锁文件及 `dependencies-prepared-not-enabled` 回执；准备操作不导入插件代码。

服务先取消受管理进程树并等待其退出，再删除失败操作的目录。之前成功的文件保持不变。卸载时拒绝新操作并等待所拥有的清理结束；终止宽限期及文件系统操作可能超出操作截止时间。候选创建不修改 Profile 或 Session 数据。

## 考虑过的替代方案

**安装到所选 Profile。** 拒绝，因为依赖准备会同时请求组合变更，并可能触发热重载。

**使用开发者的包管理器、缓存及环境。** 拒绝，因为验收会依赖机器状态，也可能向安装器暴露账号配置。桌面端拥有固定分发包；每个候选使用空的本地状态。

**准备时下载任意依赖树。** 延后，因为已审核的顶层文件不能固定全部下载代码。自包含文件为首版离线流程提供明确审核单位；更广泛的解析需要独立来源及网络策略。

## 后果

[打包冒烟测试](../../../../apps/desktop/scripts/smoke-plugins.mjs) 覆盖真实内置 pnpm、带失败安装脚本的内嵌依赖、缺失依赖失败、Profile 不变，以及后续上游 Host/浏览器启用和移除。单元测试覆盖压缩包限制、候选清理、版本不匹配、环境清理、取消、超时及进程退出等待。原生 Windows 与 WebView 验收仍由对应平台负责。

目录与环境隔离不是操作系统沙箱。目录作者及配置的包管理器仍需受信任；不支持需要原生构建脚本的包。仅依赖准备不验证组合；独立的[候选 Profile 决策](2026-09-07-candidate-profile-composition.zh.md)负责该检查。不提供远程目录、终端用户安装 UI、可在崩溃后恢复的操作日志、受控启用或活动 Profile 失败恢复。进程中断可能留下不完整目录；回执存在不授予启用权限。[市场提案](../../proposed/architecture/2026-09-06-desktop-plugin-marketplace.zh.md) 仍负责剩余产品决策。
