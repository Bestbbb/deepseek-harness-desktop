# 桌面宿主

[English](desktop.md) | 中文

桌面子系统是 Harness Host 与拥有其进程的原生应用之间一项可选的[能力 seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.zh.md)。Service Definition（[dsh-desktop](../../packages/desktop/desktop)）只公开 `ctx.desktop`；经过认证的回环 Service Provider（[dsh-desktop-native](../../packages/desktop/desktop-native)）把这份窄接口转发给 Tauri 宿主。浏览器与 headless 组合不会加载这两个包。

## 边界

该 seam 报告原生宿主是否可达，并公开窗口激活、操作系统通知和登录时启动。它不提供任意原生命令通道、文件系统逃生口，也不读取会话数据、设置或凭证。宿主无法完成操作时，提供方必须拒绝，而不是在 Node.js 中静默模拟。

桌面组合中的可信 Host 插件都可以使用该能力。逐插件 principal 与逐次调用授权仍是延后工作，因此 Consumer 必须保持为可信应用组合的一部分。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdesktop--desktophost-abstract-seam"></a>

### `ctx.desktop` — `DesktopHost` (abstract seam)

Native desktop capability. Implementations cross the process boundary into the owning desktop shell and reject when that shell cannot complete the operation.

```ts cordis-catalog
/**
 * Check that the native desktop host is reachable.
 * @returns Available status after a complete bridge round trip.
 */
abstract status(): Promise<DesktopStatus>

/**
 * Show and focus the primary application window.
 * @returns After the native host completes the operation.
 */
abstract show(): Promise<void>

/**
 * Display an operating-system notification.
 * @param notification - user-visible title and body.
 * @returns After the native host accepts the notification.
 */
abstract notify(notification: DesktopNotification): Promise<void>

/**
 * Enable or disable launch at user login.
 * @param enabled - desired autostart state.
 * @returns After the operating system records the state.
 */
abstract setAutostart(enabled: boolean): Promise<void>
```

Source: [`packages/desktop/desktop/src/index.ts`](../../packages/desktop/desktop/src/index.ts)
<!-- END GENERATED cordis-surface -->
