# Agent Note: Tauri carries the existing Harness runtime on desktop

Status: implemented

English | [中文](2026-08-20-tauri-desktop-carrier.zh.md)

## Problem

DeepSeek Harness needs installable macOS and Windows applications without making Electron/Chromium a second browser runtime that the product must ship and continuously pay for. Rewriting the agent runtime in Rust would duplicate the mature TypeScript Cordis composition, provider integrations, Web UI, wire contracts, and session semantics, creating two products whose behavior could drift. Loading the ordinary unauthenticated Web profile on a random loopback port would also let unrelated local processes invoke privileged Harness RPC methods.

## Decision

`apps/desktop` is a Tauri 2 carrier. Rust owns the window, tray, native menu and standard shortcuts, single-instance behavior, window-state persistence, notifications, autostart, updater integration point, redacted diagnostic export, native bridge, and child-process lifecycle. It displays the existing React Web profile in the operating system WebView. The Harness runtime remains TypeScript and runs under the official platform Node.js 22.22.0 executable bundled as a Tauri resource.

`apps/desktop-runtime` names the production deployment root. Its manifest explicitly closes the workspace runtime graph so `pnpm deploy --prod --legacy` cannot silently omit peer-only Harness packages. `scripts/verify-runtime-closure.ts` verifies this manifest, while `apps/desktop/scripts/prepare-runtime.mjs` checksum-verifies the official Node archive and writes a runtime manifest. The target OS builds its own runtime and installer; binaries are never cross-copied between platforms.

The Rust supervisor starts `dsh web` with a generated patch and a dedicated application-data `DSH_HOME`. It treats the CLI's early `dsh web:` line as an allocated origin, then waits for the TCP listener before navigating. Unexpected exits restart on the stable port, preserving the WebView and unsent UI state. Shutdown owns descendants with a process group on Unix and a Job Object on Windows.

Loopback is not an authority boundary. Each launch creates a cryptographically random Web token injected into the WebView as a non-enumerable value. Browser HTTP requests carry `x-dsh-desktop-token`; WebSockets carry a `dsh-auth.<token>` subprotocol. The Connection host rejects missing or incorrect tokens before dispatch. A distinct random token authenticates the private TypeScript-to-Rust bridge, whose allowlist is limited to status, show, notify, and autostart. Ordinary Web deployments set no token and keep their existing behavior.

Desktop data is isolated from the CLI rather than silently sharing mutable profiles. Existing write-only local credentials remain behind the `credentials` Service for this release; Keychain/Credential Manager can replace the provider later without changing callers. Missing, malformed, and rejected credentials use safe display copy, retain an inline recovery action, and keep a persistent sidebar warning after onboarding is dismissed.

## Alternatives considered

- **Electron**: rejected for this carrier because Harness does not require a bundled Chromium or Node-in-renderer surface; the native system WebView plus a supervised Node sidecar preserves the same product with materially less shell overhead.
- **Rust/GPUI rewrite**: rejected for the first desktop release because it duplicates agent semantics and the complete UI. Rust is used at the OS and lifecycle boundary where it adds value, not as a second Harness implementation.
- **WebView calling Tauri commands for every Harness operation**: rejected because it would replace the existing typed HTTP/WebSocket transport and couple all agent APIs to the shell.
- **Unauthenticated random loopback port**: rejected because port randomness is not authentication against other local processes.
- **Share the CLI home by default**: rejected because concurrent schema/config mutations and uninstall expectations are unsafe without an explicit import/migration design.

## Consequences

- macOS and Windows share the TypeScript Agent core and React surface, while only the small native host is platform-specific.
- The application bundle is larger than a pure Rust client because it intentionally includes the production Harness closure and official Node, but it does not include Chromium.
- Runtime readiness, authenticated RPC/WebSocket transport, lifecycle cleanup, and target-native packaging are reproducible CI gates.
- User-initiated diagnostics export only includes runtime metadata and bounded desktop-log tails. It excludes product data and scrubs desktop tokens, bearer values, common credential fields, and the home path before writing.
- Local macOS builds use an ad-hoc identity so nested code and bundle resources verify consistently, but remain unnotarized development artifacts. Public releases still require owner-supplied Apple/Windows signing identities, notarization configuration, and updater signing material. Secrets are never committed; local artifacts are not public release candidates.
