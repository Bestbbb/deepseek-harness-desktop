---
description: "桌面包组：社区 Tauri 应用的原生宿主能力及其经过认证的桥接。"
kind: "package-group"
---

# desktop/ — 原生宿主集成

[English](README.md) | 中文

## 摘要

桌面包允许受信任的 Harness 插件使用原生应用的窗口、通知和登录自启动能力。服务包定义这些操作，原生提供方将操作转发给所属的 Tauri 宿主。浏览器和 headless Profile 不加载这项可选集成。各包 README 负责说明自己的配置和失败行为。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

服务和提供方共同构成桌面能力 seam。

| 包 | 职责 |
|---|---|
| [`desktop/`](desktop/README.zh.md) | 通过 `ctx.desktop` 定义原生宿主操作 |
| [`desktop-native/`](desktop-native/README.zh.md) | 通过经过认证的本地桥接转发这些操作 |
| [`bundle-preparation/`](bundle-preparation/README.zh.md) | 在 Harness 中准备已审核本地文件，不改变 Profile |
| [`bundle-marketplace/`](bundle-marketplace/README.zh.md) | 在桌面设置中添加审核目录浏览与显式的下次启动启用 |
| [`focus-timer/`](focus-timer/README.zh.md) | 通过可选组合包添加无需账号的侧栏倒计时 |
| [`notification-controls/`](notification-controls/README.zh.md) | 添加可选、持久化的完成和失败通知开关 |
| [`delegation-launcher/`](delegation-launcher/README.zh.md) | 通过已加载 subagent 提供方添加经确认的人工任务提交 |

<a id="related-documentation"></a>
## 相关文档

- [桌面子系统](../../docs/subsystems/desktop.zh.md) — 能力边界与自动生成的 API 参考。
- [桌面应用](../../apps/desktop/README.zh.md) — 原生应用生命周期、开发和打包。
- [贡献桌面组合包](../../docs/cookbook/desktop-marketplace-bundle.zh.md)——编写、目录审阅及从安装到使用的验证。

<a id="dev-note"></a>
## 开发备注

无。
