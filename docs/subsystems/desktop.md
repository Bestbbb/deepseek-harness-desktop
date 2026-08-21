# Desktop host

English | [中文](desktop.zh.md)

The desktop subsystem is an optional [capability seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md) between a Harness Host and the native application that owns its process. The Service Definition ([dsh-desktop](../../packages/desktop/desktop)) exposes only `ctx.desktop`; the authenticated loopback Service Provider ([dsh-desktop-native](../../packages/desktop/desktop-native)) forwards that narrow contract to the Tauri host. Browser and headless compositions do not load either package.

## Boundary

The seam reports whether the native host is reachable and exposes window activation, operating-system notifications, and login autostart. It does not expose an arbitrary native command channel, filesystem escape hatch, session data, settings, or credentials. A provider rejects operations that the host cannot complete instead of silently emulating them in Node.js.

The desktop composition gives trusted Host plugins access to this capability. Per-plugin principals and per-call permission grants are deferred; consumers must therefore remain part of the trusted application composition.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
