# Agent Note: Tauri carries the existing Harness runtime on desktop

Status: implemented

English | [中文](2026-08-20-tauri-desktop-carrier.zh.md)

## Problem

DeepSeek Harness needs installable macOS and Windows applications without making Electron/Chromium a second browser runtime that the product must ship and continuously pay for. Rewriting the agent runtime in Rust would duplicate the mature TypeScript Cordis composition, provider integrations, Web UI, wire contracts, and session semantics, creating two products whose behavior could drift. Loading the ordinary unauthenticated Web profile on a random loopback port would also let unrelated local processes invoke privileged Harness RPC methods.

## Decision

`apps/desktop` is a Tauri 2 carrier. Rust owns the window, tray, native menu and standard shortcuts, single-instance behavior, window-state persistence, notifications, autostart, updater integration point, redacted diagnostic export, native bridge, and child-process lifecycle. It displays the existing React Web profile in the operating system WebView. The Harness runtime remains TypeScript and runs under the official platform Node.js 22.22.0 executable bundled as a Tauri resource.

`apps/desktop-runtime` names the production deployment root. Its manifest explicitly closes the workspace runtime graph so `pnpm deploy --prod --legacy` cannot silently omit peer-only Harness packages. [The dependency generator](../../../../scripts/sync-desktop-runtime.ts) derives this list from the production graph; [the closure verifier](../../../../scripts/verify-runtime-closure.ts) checks profile reachability. [Runtime preparation](../../../../apps/desktop/scripts/prepare-runtime.mjs) checksum-verifies the official Node archive and writes a runtime manifest. The target OS builds its own runtime and installer; binaries are never cross-copied between platforms.

The Rust supervisor starts `dsh web` with a generated patch and a dedicated application-data `DSH_HOME`. It treats the CLI's early `dsh web:` line as an allocated origin, then waits for the TCP listener before navigating. Unexpected exits restart on the stable port, preserving the WebView and unsent UI state. Shutdown owns descendants with a process group on Unix and a Job Object on Windows.

Native dependency rebuilding uses npm's lifecycle runner on an explicit approved-package list. The legacy pnpm deployment retains workspace importer identifiers and an empty root importer, so `pnpm rebuild` at the deployment root does not reach those dependencies. The desktop pins the lifecycle runner and `node-gyp` as development dependencies and passes the compiler explicitly to each preinstall, install, and postinstall operation; a failed script stops the sequence. This avoids `npm rebuild` selecting its own bundled compiler without the Visual Studio support required by the builder. Node-gyp receives the bundled Node version and architecture explicitly, rather than inheriting the builder's ABI; preparation verifies native loading with the bundled executable. This covers `fs-ext`, whose Session-lock binding is ABI-specific. A foreign runtime target is rejected before output replacement because the deployment has no cross-platform native-addon build path.

The [navigation state](../../../../apps/desktop/src-tauri/src/navigation.rs) records the requested origin and the WebView's clean-root page-load completion, not the rotating launch token. Runtime readiness for that loaded origin does not navigate again; incomplete initial loads and changed origins remain eligible. The upstream browser-cookie signing secret persists in the desktop home, so a restarted runtime accepts the existing cookie without another token exchange. Native policy tests reject a reload on token rotation, and the [bundled-runtime smoke](../../../../apps/desktop/scripts/smoke-runtime.mjs) forcibly terminates its private runtime before checking cookie-authenticated RPC and WebSocket reconnects. These checks do not replace target-native input and attachment acceptance.

The [Windows owner](../../../../apps/desktop/src-tauri/src/runtime_windows.rs) creates and configures a kill-on-close Job before spawning the runtime with `CREATE_SUSPENDED | CREATE_NO_WINDOW`. An owned child guard exists before assignment or thread resumption can fail. Stable Rust does not expose the initial thread handle, so Tool Help locates the suspended child's thread for `ResumeThread`. Pipe reader threads start only after runtime ownership succeeds. Forced host termination between spawn and assignment can leave a suspended child: this design does not claim atomic Job attachment.

Shutdown sets the Job's active-process limit to zero before enumerating member handles, preventing new members during cleanup. PID-based observations verify Job membership to reject recycled identifiers. Cleanup terminates the Job and root, reaps the root, waits on retained process handles, and checks the Job's active-process count. Windows [process termination is asynchronous](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess): an empty Job count alone is not a wait on descendant exit signals. Startup and cleanup errors remain independently visible; failed admission sealing or handle collection does not skip termination.

Target-native lifecycle tests use independent process handles to observe assignment failure, resumption failure, owner disposal, rejection of new Job members during shutdown, and descendant termination after the root exits. The Windows fixture is a test-executable subprocess with a scrubbed environment; it publishes its descendant PID after readiness. The Unix owner also cleans up on drop, with a process-group regression and state-based exit observation. The [Desktop workflow](../../../../.github/workflows/desktop.yml) runs these tests on their native operating systems; a successful cross-compilation check alone does not establish Windows lifecycle behavior. These ownership-only changes do not alter the model transcript or session format.

Loopback is not an authority boundary. The WebView opens the upstream launch URL and exchanges its random token for an HttpOnly, SameSite=Strict cookie. The upstream Connection host checks browser authentication before HTTP and WebSocket dispatch; the desktop overlay does not replace that protocol. A distinct per-launch random token authenticates the private TypeScript-to-Rust bridge, whose allowlist is limited to status, show, notify, and autostart. Desktop logs redact the launch URL token.

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
- macOS preview builds use an ad-hoc identity so nested code and bundle resources verify consistently, but remain unnotarized. Windows previews remain unsigned. Preview releases disclose the operating-system launch warnings. Verified-publisher distribution and automatic updates require owner-supplied signing and update configuration; secrets are never committed.
