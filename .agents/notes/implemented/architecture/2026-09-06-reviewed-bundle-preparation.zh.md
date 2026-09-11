# Agent Note: Reviewed Bundle preparation before profile mutation

Status: implemented

[English](2026-09-06-reviewed-bundle-preparation.md) | 中文

## 问题

插件 CLI 会立即安装依赖并协调所选 Profile。Web Profile 重载可能使这些修改生效。市场不能把该命令当作仅准备步骤，也不能把下载元数据匹配等同于插件可用。

## 决策

可选的 [Bundle 准备服务](../../../../packages/desktop/bundle-preparation/README.zh.md) 在 Cordis 内管理受信任本地目录及限量文件暂存。审核过的精确 Host 版本、平台、字节数和 SHA-256 约束准备操作。解析器拒绝格式错误的记录和有歧义的标识。成功的 `prepare()` 操作返回 `prepared-not-enabled`；该方法不安装依赖、执行包代码或修改 Profile 与 Session。独立的[离线候选决策](2026-09-06-offline-bundle-candidates.zh.md) 负责可选的 `prepareDependencies()`。

部署方提供目录和暂存路径。审核声明是受信任元数据，不是发布者认证。每个操作独占创建自己的目录；失败只清理该目录，卸载时拒绝新操作并等待清理。成功回执在卸载后保留。后续安装器必须在受控启用前重新校验文件并解析依赖；回执不授予权限，也不保证插件受到沙箱约束。

[打包冒烟测试](../../../../apps/desktop/scripts/smoke-plugins.mjs) 是当前准备消费者。它通过真实 `dsh web` 覆盖层启动服务，准备离线压缩包，验证 Profile 未加入此包，再单独执行上游 Bundle 安装及 Host/浏览器启用。服务不在默认组合中，也没有浏览器安装按钮。

[市场提案](../../proposed/architecture/2026-09-06-desktop-plugin-marketplace.zh.md) 仍有部分未实现。[桌面打包决策](2026-09-06-desktop-bundle-packaging.zh.md) 仍负责内置 pnpm 与启用验收；准备操作不取代这两份记录。

## 考虑过的替代方案

**在准备时调用 `dsh plugin add`。** 拒绝，因为它修改所选 Profile，并可能在依赖和启用验收前触发热重载。

**实现原生插件加载器。** 拒绝，因为 Cordis 和 Profile Bundle 负责组合；原生恢复能力必须独立可用。

**将校验值匹配视为插件已安装。** 拒绝，因为它只证明文件一致，不证明包内容有效、依赖已解析、安全性或成功启用。

## 后果

本地准备不增加网络请求或推理费用。测试覆盖目录错误、精确限制、声明不兼容、文件变更、并发请求、写入失败及 I/O 期间卸载。真实组合证据使用桌面打包冒烟测试；原生 Windows 与 WebView 验收仍由对应平台负责。

可选的[操作历史](2026-09-07-preparation-operation-history.zh.md)记录准备观测，不授予启用权限。文件准备不提供崩溃恢复、目录下载、发布者签名、配置表单或受控启用。异常终止可能留下不完整暂存目录。消费者不得仅凭目录或回执存在推断已安装。
