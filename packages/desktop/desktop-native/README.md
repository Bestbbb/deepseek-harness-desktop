# @deepseek-ai/dsh-desktop-native

English | [中文](README.zh.md)

`dsh-desktop-native` provides `ctx.desktop` by forwarding each operation to the Tauri process over a random loopback origin. The Tauri supervisor injects that origin and a separate 256-bit per-launch token into the bundled Node process. The provider refuses non-loopback origins before it can send the token and never places the token in a URL or diagnostic.

## Configuration

`endpoint` must be an exact `http://127.0.0.1:<port>` origin. `token` is required and secret-role configuration. `timeoutMs` defaults to 5000 milliseconds and applies independently to every operation.

The desktop overlay is the only shipped composition that mounts this provider. Ordinary browser and headless invocations do not have the bridge environment or the service.

## Model Experience

### Native bridge operations

#### What the model sees

Nothing directly. `NativeDesktopHost.notify()` carries a consumer request and returns no model-facing text.

#### Token effect

The provider adds no prompt, message, schema, or tool result.

#### KV Cache effect

Native bridge traffic is outside model requests and preserves every reusable prefix.

## Known Limitations and Deferred Work

- **One-way availability** — the provider calls Rust but exposes no native event stream from Rust into Harness; menus currently dispatch into the WebView instead.
