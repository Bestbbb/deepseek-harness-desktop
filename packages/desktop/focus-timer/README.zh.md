---
description: "通过可选组合包，为 Harness 侧栏添加无需账号的专注计时器。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-focus-timer

[English](README.md) | 中文

## 概述

无需账号、模型请求或网络服务，即可添加本地倒计时。选择时长后，可以开始、暂停、继续或重置。关闭面板会继续倒计时；刷新页面或卸载插件会清除计时。桌面目录提供此组合包，但基础 Web Profile 不会启用它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

打开设置 → 插件 → 插件市场，选择 Focus Timer，查看安装详情，并确认下次启动时安装。完成当前任务后，退出并重新打开桌面应用。使用侧栏的“专注计时器”按钮，或在插件市场选择“已安装 → 打开计时器”。市场入口会关闭设置并打开同一个倒计时。无需单独安装 Node 或 pnpm。

输入 1 至 1440 之间的整数分钟。暂停会保留剩余整秒，继续会恢复计时，重置会回到所选时长。关闭面板后，侧栏继续显示倒计时，时间到后显示完成标记。计时器不播放声音或发送系统通知。

在计时器面板的“插件设置”中选择“保存此时长”，可在刷新页面或重启应用后复用该时长。“清除已保存时长”会让新计时器的时长留空。已保存时长标签反映 Host 设置的观测值，而非按钮点击；无法确认保存时会保留草稿供核对。设置正在读取或无法保存时，仍可使用临时计时器。保存时长不会保存倒计时进度，也不会自动开始计时。

此组合包插入一个 `focus-timer` 配置项。在插件市场的“已安装”视图中，选择“查看卸载详情”并确认下次启动时卸载；重启后计时器消失。卸载保留旧 Profile 和插件数据。本包以审核过的本地 tarball 分发，不承诺 npm 注册表中已发布此包。

tarball 通过 `bundledDependencies` 包含 schema 校验器及其依赖。桌面打包命令启用 pnpm 的依赖打包能力，不改变工作区的安装布局；离线安装不需要这些库的注册表元数据。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[补丁](cordis.patch.yml)挂载 Host 入口，在现有设置提供方中注册 `focus-timer` 偏好命名空间。schema 接受可选的整数 `minutes`，范围为 1 至 1440。[浏览器入口](src/client/index.ts)通过现有 `settingsScope` 服务进行带修订号校验的写入和渲染器绑定的观测；它注册可撤销的语言字典，并等待 `sidebar.footer.action`。其可选的 `settings.bundleMarketplace.action` 贡献通过注册项声明的存储共享面板可见状态，并在侧栏声明消失时撤销。没有插件市场时，侧栏仍可使用。[组件](src/client/FocusTimer.tsx)独自拥有倒计时状态，仅在倒计时时启动一个秒级刷新间隔，在暂停、完成或卸载时清理。基于系统时钟的截止时间会补算浏览器节流或系统睡眠后的时间；调整系统时钟也会改变剩余时间。

本包不发布 invariant 伴随入口，因为设置服务拥有偏好校验和持久化，而没有持久记录追踪组件本地的倒计时。模型输入、会话持久化及原生生命周期不属于此组合包。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [桌面包组](../README.zh.md)——市场及原生能力的所有者。
- [插件市场](../bundle-marketplace/README.zh.md)——确认及下次启动启用。
- [专注计时器决策](../../../.agents/notes/implemented/feature/2026-09-07-focus-timer-bundle.zh.md)——可选安装与计时器生命周期。

<a id="model-experience"></a>
## 模型体验

无，因为此浏览器本地倒计时不增加模型输入或会话事件。

#### KV 缓存影响

此组合包不改变系统提示词、工具 schema、请求前缀或模型缓存复用。

## 已知限制与待办事项

<a id="known-limitations-and-deferred-work"></a>

- 刷新、插件重载、侧栏所有者替换或退出应用会清除计时；它不是持久提醒。
- 后台节流可能延迟可见的完成提示。不提供唤醒服务、闹钟、声音、系统通知、历史或跨窗口倒计时同步。修改偏好不会改变已开始的倒计时。
- 偏好使用所选 Harness 主目录的设置文档，卸载组合包后仍保留；不在设备间同步。保存需要可写的 Host 设置作用域。
- 安装 Host 插件会授予受信任同进程代码访问能力。本包的有限 Host 行为不代表其他包获得隔离。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
