# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

`dsh-desktop` defines `ctx.desktop`, the native capability supplied only when a desktop host owns the running Harness process. The service exposes window activation, operating-system notifications, login autostart, and an availability probe. A provider must reject an operation the host did not complete; it must not silently emulate native behavior inside Node.

## Composition

Load one Service Provider in desktop-only composition. The browser and headless profiles do not mount this definition or invent a fallback, so ordinary Harness deployments carry no desktop assumption.

## Model Experience

### Native desktop operations

#### What the model sees

Nothing directly. Consumers decide whether a call such as `ctx.desktop.notify(...)` becomes a command, tool, or background policy.

#### Token effect

The Service Definition adds no prompt, message, schema, or tool result.

#### KV Cache effect

The service preserves every reusable model-request prefix because it contributes no model input.

## Known Limitations and Deferred Work

- **Trusted Host consumers only** — the service has no plugin principal or per-call permission grant; a mounted Host plugin can invoke every operation the active provider implements.
