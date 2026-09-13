# Harness Desktop 插件市场

[English](marketplace.md) | 中文

## 概述

从“设置 → 插件 → 插件市场”添加可选能力。组合包可通过 Cordis 贡献界面、工具或 agent（智能体）行为；skill（技能）与 MCP 集成可以包含其中，但不代表整个市场。本指南描述当前源码构建。[旧发行安装包](https://github.com/Bestbbb/deepseek-harness-desktop/releases)可能没有这些控件，下载前请检查发行说明。

## 目录

- [选择能力](#choose-a-capability)
- [安装与使用](#install-and-use)
- [变更或移除版本](#change-or-remove-a-version)
- [理解操作记录](#understand-operation-records)
- [贡献组合包](#contribute-a-bundle)

<a id="choose-a-capability"></a>
## 选择能力

“发现”可搜索名称、包名、发布者以及当前语言的描述。目录随应用发布，刷新状态不会下载新的目录条目。每个条目展示发布者、源码、兼容性、账号要求、声明的访问范围和使用说明。Host 插件拥有与 Harness 相同的访问能力；声明不是强制权限限制。

| 能力 | 适用用途 | 账号要求 |
|---|---|---|
| [Focus Timer](../../../packages/desktop/focus-timer/README.zh.md) | 在对话旁添加可选倒计时 | 无 |
| [Notification Controls](../../../packages/desktop/notification-controls/README.zh.md) | 选择任务完成与失败通知 | 无；操作系统通知权限单独管理 |
| [Delegate Tasks](../../../packages/desktop/delegation-launcher/README.zh.md) | 向已加载的 agent 提供方提交工作 | 需要配置或登录提供方；执行可能消耗额度 |

独立的“配置本地智能体”入口打开桌面 agent 设置。安装 Delegate Tasks 不会安装 Codex、Claude Code 或其他提供方，也不会替你登录。

<a id="install-and-use"></a>
## 安装与使用

1. 打开条目并阅读源码、访问范围和账号要求。不兼容条目无法从此视图安装。
2. 选择“查看安装详情”，再确认“安装并等待下次启动”。准备安装不会中断当前任务。
3. 等待“等待应用重启”。完成活动任务后退出并重新打开应用。启动失败时保留可恢复的上一份组合；恢复不会撤销插件对用户数据的修改。
4. 打开“已安装”，使用组合包入口，例如“打开计时器”“配置通知”或“委派任务”。待启用组合尚未生效。列出的包版本不是运行健康检查。

<a id="change-or-remove-a-version"></a>
## 变更或移除版本

“版本变更”列出已安装且可读的版本与随附目录不同的组合包，不代表目标更新或兼容。确认前请核对两个版本并阅读降级警告；启用仍需完整重启应用。不提供插件数据迁移或自动更新。

“已安装 → 查看卸载详情”准备一份不包含指定直接、已确认组合包的新组合。此处不能卸载内置、间接依赖或不可读的包。卸载保留旧包和用户数据以供恢复。取消待启用状态不会删除候选文件。

<a id="understand-operation-records"></a>
## 理解操作记录

“操作记录”仅在打开或刷新时读取准备记录。准备凭据通过校验，不代表候选已排队、已启用或运行正常。未结算记录没有已记录的结果，不能证明其进程已停止。凭据缺失或变化时标记为不可用；记录不可读不等于记录为空。请勿自动重试结果不确定的更改：先刷新并检查“已安装”与待启用状态。

<a id="contribute-a-bundle"></a>
## 贡献组合包

桌面端安装随运行时提供的审核目录，不接受任意 npm URL。作者可遵循[组合包投稿指南](../../cookbook/desktop-marketplace-bundle.zh.md)，提交源码供审核。投稿与打包检查不代表批准。本网站说明发现和使用流程，不会向你的电脑安装代码。

## 开发备注

无。
