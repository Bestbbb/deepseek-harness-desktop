# Harness Desktop

English | [中文](README.zh.md)

This app is the Tauri 2 desktop carrier for DeepSeek Harness on macOS and Windows. Rust owns the application lifecycle and native operating-system integration; the existing TypeScript Harness runtime and React Web profile remain the product core. The app therefore avoids bundling Chromium/Electron without rewriting the agent system into a second implementation.

## Architecture

The application opens a lightweight system WebView immediately on a local loading page. A Rust supervisor starts the bundled official Node.js executable and the production `dsh web` dependency closure, waits for its loopback listener, then navigates the same WebView to the stable Harness origin.

Every launch creates two independent 256-bit random tokens:

- WebView to Harness HTTP and WebSocket traffic must carry the desktop session token. An unauthenticated loopback caller receives HTTP 403.
- Harness to native-host operations use a separate authenticated loopback bridge. It exposes only status, show/focus, notification, and autostart operations.

The Rust supervisor owns the complete child process tree. It uses a Unix process group on macOS and a Job Object on Windows, restarts an unexpected runtime exit on the same port, and terminates descendants on application exit. Window state, single-instance activation, standard window/edit shortcuts, the native menu, tray behavior, notifications, autostart, and updater plumbing are native Tauri capabilities. The application menu can export a bounded diagnostic text file; the exporter never reads sessions, configuration, credentials, or user files, and redacts desktop tokens, bearer credentials, API-key fields, and the home-directory prefix before writing.

Desktop data lives under Tauri's application-data directory in a dedicated `harness` home. It does not mutate the user's CLI profile. Sessions, settings, and write-only credential storage therefore survive app updates while remaining isolated from a separately installed CLI.

## Development

Requirements: Node.js 22, pnpm 11.7, Rust stable, and the platform prerequisites from Tauri 2.

```sh
pnpm install --frozen-lockfile
pnpm run desktop:prepare
pnpm run desktop:smoke
pnpm run desktop:dev
```

`desktop:prepare` builds Harness, deploys the closed production workspace graph, downloads the matching official Node.js 22.22.0 distribution, verifies its SHA-256 checksum, and materializes the Tauri resource directory. `desktop:smoke` launches that exact bundled runtime and verifies authenticated HTTP plus both WebSocket event streams.

The release path builds installers on their target operating system:

```sh
pnpm run desktop:build
```

macOS produces an `.app` and `.dmg`; Windows produces a per-user NSIS `.exe` installer. The bundled Harness runtime contains more than 32,000 files, so the Windows profile intentionally avoids WiX/MSI's practical file-table limits. `.github/workflows/desktop.yml` runs the same preparation, smoke, Rust tests, and target-native packaging on macOS arm64 and Windows x64 runners.

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

Local macOS builds use Tauri's ad-hoc signing identity so the complete nested bundle has a valid development signature; they are not notarized and macOS may still require manual approval. Local Windows installers are unsigned and may trigger SmartScreen. Public distribution requires the repository owner to provision Apple Developer ID/notarization credentials, a Windows code-signing certificate, and a Tauri updater signing key plus release endpoint. Release credentials override the ad-hoc identity, must remain CI secrets, and are intentionally not generated or committed by this package.

The current credential provider is Harness's write-only local provider inside the isolated desktop data directory. OS Keychain/Credential Manager migration can be added behind the same `credentials` Service without changing the WebView, agent runtime, or settings UI.
