---
description: "在桌面设置中浏览审核组合包，并请求原生端在下次启动时启用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bundle-marketplace

[English](README.md) | 中文

## 概述

浏览审核组合包，检查兼容性，并确认在下次应用启动时安装启用。当前会话继续运行。原生选择状态区分待启用候选与活动 Profile；命令响应不确定时必须重新读取，而非自动重试。这个可选插件使用现有准备服务和原生宿主。

## 目录

- [组合](#composition)
- [实现](#implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

<a id="composition"></a>
## 组合

[桌面覆盖层](../../../apps/desktop/runtime/desktop.cordis.yml)将本包与已配置的 `bundlePreparation` 和 `desktop` 提供方一起挂载。本包没有配置字段。它是插件而非可安装组合包；上游 Web Profile 不挂载它。[浏览器验收测试](../../../apps/web/tests/bundle-marketplace.e2e.ts)提供包含审核测试条目的隔离组合。

浏览器贡献在“设置 → 插件”中添加插件市场标签页。页面打开后才读取元数据，展示发布者、源码和兼容性结论，准备代码前需要单独确认。Host 插件仍是拥有 Harness 访问能力的受信任同进程代码；审核元数据不是沙箱，也不是独立发布者验证。

“配置本地智能体”打开现有原生扩展窗口。该内置接入入口独立于可安装组合包，已保存的 agent 选择仍由同一个管理方负责。打开窗口不检查账户、不登录、不安装，也不调用模型；窗口提供显式检测与启用流程。响应失败或不确定时提示从应用菜单打开，连接变化会丢弃陈旧的窗口响应。该入口不是协作组合包。

准备操作将候选排队，不中断运行中的任务。用户完成任务后退出并重新打开应用以启用。取消操作精确针对观测到的待启用 Profile，并保留其文件。原生宿主而非浏览器决定启动成功与恢复。

“发现”列出审核条目；“已安装”分别列出已选择、待启用和试启动的 Profile，版本通过上游 Bundle 解析器读取。包元数据缺失时明确保留未确认状态。原生选择发生变化时拒绝快照，不混合不同代际。这些是磁盘观测，不是运行插件健康检查，也不证明文件与审核 tarball 一致。视图阻止重复安装同版本，并在当前清单或所选包版本不可读时阻止安装。

断线时标签页撤下未确认的观测，在重连或手动刷新时重读，并在每次命令结束后重新查询。它从不自动重试更改操作。网关返回发现元数据、原生选择状态以及有序包名与版本观测；不返回产物路径、收据、配置、原生令牌或原始命令错误。

已安装组合包与目录版本不同时，提供“查看版本变更”。确认界面显示观测版本和目标版本；“替换并等待下次启动”保留活动组合。每个安装请求携带确认时的 Profile 和旧版本，null 仅表示不存在。准备服务重新核对这些值，不将陈旧确认解释为新安装。市场不排序版本、不承诺升级、不迁移插件数据，也不保证降级兼容性。确认界面将焦点放在“返回”，便于键盘用户查看或取消，而不默认选择更改操作。

“已安装”为版本已确认且由 Profile 直接拥有的组合包提供独立卸载确认。确认后创建并验证新组合，再排队等待下次完整启动。它从不删除活动 Profile 或插件数据。此处不支持卸载内置、间接依赖和未确认的包；待启用与试启动组合只读。Host 再次检查选择状态、归属和观测版本。卸载回复不确定时只重新读取状态，不自动重试。

<a id="implementation"></a>
## 实现

<details>
<summary>Host 命令与浏览器职责</summary>

[网关](src/index.ts)通过现有已认证应用传输暴露本包生成的 Remote 命名空间。[浏览器入口](src/client/index.ts)挂载命名空间，并通过 Cordis effect（副作用）贡献本地化插槽。[组件](src/client/MarketplaceTab.tsx)接收回调和由渲染器绑定的连接代际，而非服务或原生凭据。网关没有独立的安装或激活登记，因此不发布 invariant（不变量）伴随入口。

标签页声明根级键控 slot `settings.bundleMarketplace.action`。仅在不处于试启动状态时，为已选择 Profile 中版本已确认的包渲染其注册操作。键为 npm 包名；所有者提供现有设置 `close` 回调。各贡献方拥有本地化控件及其行为。待启用条目与未知版本没有使用入口。没有注册时不渲染内容；市场不推测操作，也不将其视为健康检查。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [准备服务](../bundle-preparation/README.zh.md) — 审核产物、代际创建与清理。
- [原生宿主](../desktop/README.zh.md) — 排队、取消与选择状态值。
- [市场决策](../../../.agents/notes/implemented/architecture/2026-09-07-desktop-marketplace-browser.zh.md) — 发现与激活状态的所有权。

<a id="model-experience"></a>
## 模型体验

无，因为浏览器发现与下次启动命令不会向活动组合添加模型输入。

#### KV Cache 影响

本插件不改变活动模型请求前缀。已启用组合包拥有其后续模型可见行为。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 目录由部署方提供并保存在本地；不提供发布者投稿、远程下载或自动更新。
- 已安装版本来自磁盘读取，而非运行健康检查。使用与配置入口需要插件明确贡献；Focus Timer 和 Notification Controls 提供了相应入口。登录表单、专门的更新列表及活动任务的重启协调仍是独立工作。卸载保留旧代际和插件数据；不提供存储清理。
- 桌面目录提供可选的 [Focus Timer](../focus-timer/README.zh.md) 和 [Notification Controls](../notification-controls/README.zh.md)。这是经过筛选的第一方目录，不是开放的发布者市场。

<a id="dev-note"></a>
### 开发备注

无。
