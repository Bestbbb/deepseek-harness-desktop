# Harness Desktop

English | [中文](README.zh.md)

This app is the Tauri 2 desktop carrier for DeepSeek Harness on macOS and Windows. Rust owns the application lifecycle and native operating-system integration; the existing TypeScript Harness runtime and React Web profile remain the product core. The app therefore avoids bundling Chromium/Electron without rewriting the agent system into a second implementation.

## Architecture

The application opens a lightweight system WebView immediately on a local loading page. A Rust supervisor starts the bundled official Node.js executable and the production `dsh web` dependency closure, waits for its loopback listener, then navigates the same WebView to the stable Harness origin.

Browser access and native operations use independent credentials:

- The WebView opens the upstream launch-token URL. Harness exchanges it for an HttpOnly, SameSite=Strict cookie; HTTP RPC and the multiplexed WebSocket use that cookie. Unauthenticated requests receive HTTP 401. The native host redacts launch tokens before logging runtime output.
- Harness to native-host operations use a separate authenticated loopback bridge. It exposes only status, show/focus, notification, and autostart operations.

The Rust supervisor owns the complete child process tree. It uses a Unix process group on macOS and a Job Object on Windows, restarts an unexpected runtime exit on the same port, and terminates descendants on application exit. Window state, single-instance activation, standard window/edit shortcuts, the native menu, tray behavior, notifications, autostart, and updater plumbing are native Tauri capabilities. The application menu can export a bounded diagnostic text file; the exporter never reads sessions, configuration, credentials, or user files, and redacts desktop tokens, bearer credentials, API-key fields, and the home-directory prefix before writing.

Windows starts the runtime suspended and without a console window, then resumes it after Job assignment. Reported startup failures terminate and reap the child before retry. Shutdown closes Job process admission, retains member handles, and waits for their exit signals and an empty Job; cleanup errors are logged. Abrupt host termination between process creation and Job assignment can still leave a suspended child; this sequence is not atomic process creation. The [desktop lifecycle decision](../../.agents/notes/implemented/architecture/2026-08-20-tauri-desktop-carrier.md) records the platform verification requirements.

The File menu exposes **New Session**, with **Cmd+N** on macOS. The application menu exposes **Settings** and diagnostic export.

The main window disables Tauri's native drag-and-drop handler so the upstream attachment UI can receive browser file-drop events, including on Windows. Window creation remains in application setup; the configured loading window is not created automatically.

Desktop data lives under Tauri's application-data directory in a dedicated `harness` home. It does not mutate the user's CLI profile. Sessions, settings, and write-only credential storage therefore survive app updates while remaining isolated from a separately installed CLI.

## Development

Requirements: Node.js 22, pnpm 11.7, Rust stable, and the platform prerequisites from Tauri 2.

```sh
pnpm install --frozen-lockfile
pnpm run desktop:prepare
pnpm run desktop:smoke
pnpm run desktop:dev
```

`desktop:prepare` checks the desktop dependency manifest, builds Harness, deploys the production workspace graph, downloads the matching official Node.js 22.22.0 distribution, verifies its SHA-256 checksum, and materializes the Tauri resource directory. `desktop:smoke` launches that exact bundled runtime and checks rejected anonymous access, cookie login, model and session RPC, and the multiplexed WebSocket event stream.

Preparation replaces only an empty directory or a generated Harness Desktop runtime. `DSH_DESKTOP_RUNTIME_OUTPUT` may select another output, but files, directory links, unrelated nonempty directories, and paths containing the repository or user home are rejected before cleanup. Choose an empty directory when a previous output cannot prove its ownership; do not place personal files in generated runtime directories.

The release path builds installers on their target operating system:

```sh
pnpm run desktop:build
```

macOS produces an `.app` and `.dmg`; Windows produces a per-user NSIS `.exe` installer. The dependency tree contains many files, so the Windows profile avoids WiX/MSI's file-table limits. The [Desktop workflow](../../.github/workflows/desktop.yml) owns target-native preparation, smoke tests, Rust tests, and packaging on macOS arm64 and Windows x64 runners; a local macOS build does not verify Windows behavior.

Tauri's `cargo-xwin` fallback can also produce the Windows x64 NSIS installer from macOS or Linux. Install `cargo-xwin`, LLVM/LLD, and `makensis`, then prepare a Windows dependency closure before invoking Tauri.

```sh
DSH_DESKTOP_TARGET_PLATFORM=win32 DSH_DESKTOP_TARGET_ARCH=x64 \
  pnpm --filter @deepseek-ai/dsh-desktop-app run prepare-runtime
PATH="/opt/homebrew/opt/llvm/bin:$PATH" \
  pnpm --filter @deepseek-ai/dsh-desktop-app exec tauri build \
  --runner cargo-xwin --target x86_64-pc-windows-msvc \
  --config '{"bundle":{"targets":["nsis"]}}' --ci
```

## Release gates

Preview macOS builds use an ad-hoc signing identity and are not notarized. Windows previews are unsigned. The operating system may block either preview; users must assess the source and release checksums before approving it. Automatic updates are disabled without a configured signing key and release endpoint. Developer ID notarization, Windows code signing, and signed updater metadata require owner-provided credentials kept in CI secrets, not this repository.

The current credential provider is Harness's write-only local provider inside the isolated desktop data directory. OS Keychain/Credential Manager migration can be added behind the same `credentials` Service without changing the WebView, agent runtime, or settings UI.

<a id="following-upstream"></a>

## Following upstream

Merge an exact upstream release tag in a separate branch, resolve the desktop overlay against the current Web profile, then run `pnpm run desktop:sync` and `pnpm install` to record its production dependency graph. `pnpm run desktop:verify` rejects a stale graph or missing preset plugin before packaging. Keep the CLI, desktop package, Cargo, and Tauri versions aligned. Build and smoke-test the bundled runtime on each release platform; do not copy one platform's dependency tree into another installer.
