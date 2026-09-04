---
description: "Authenticated loopback transport for plugins calling the Tauri desktop host, including configuration and failure behavior."
kind: "package-reference"
---

# @deepseek-ai/dsh-desktop-native

English | [中文](README.zh.md)

## Summary

Plugins can call native desktop operations through `ctx.desktop` while the Tauri application supervises Harness. Each call uses a private loopback bridge and a separate per-launch token. The provider rejects non-loopback origins before sending credentials and rejects failed or timed-out operations.

## Table of Contents

- [Configuration](#configuration)
- [Implementation](#implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="configuration"></a>

## Configuration

The [desktop overlay](../../../apps/desktop/runtime/desktop.cordis.yml) mounts this provider with values supplied by Rust. It is a Cordis plugin, not an independently installable Profile Bundle.

| Field | Default | Meaning |
|---|---|---|
| `endpoint` | Required | Exact `http://127.0.0.1:<port>` origin, without user info, path, query, or fragment. |
| `token` | Required | Secret-role token for the native bridge, never placed in a URL. |
| `timeoutMs` | `5000` | Independent deadline in milliseconds for each operation. |

<a id="implementation"></a>

## Implementation

<details>
<summary>Native bridge ownership</summary>

The [provider](src/index.ts) sends authenticated requests to the [Rust bridge](../../../apps/desktop/src-tauri/src/bridge.rs). Browser authentication belongs to the upstream Connection package and uses a different credential. No runtime invariant companion is published because each request is independent and the provider keeps no mirrored native state.

</details>

<a id="model-experience"></a>

## Model Experience

### Native bridge operations

#### What the model sees

Nothing directly. `NativeDesktopHost.notify()` carries a consumer request and returns no model-facing text.

#### Token effect

The provider adds no prompt, message, schema, or tool result.

#### KV Cache effect

Native bridge traffic is outside model requests and preserves every reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No native event stream**: the provider calls Rust but exposes no events from Rust into Harness; menus dispatch into the WebView.
- **Trusted local plugins**: the token authenticates the Harness process, not each plugin inside it.

<a id="dev-note"></a>

### Dev Note

None.
