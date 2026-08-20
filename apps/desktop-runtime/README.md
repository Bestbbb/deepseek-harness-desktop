# `@deepseek-ai/dsh-desktop-runtime`

English | [中文](README.zh.md)

This private workspace package is the deployment root for the desktop application's bundled TypeScript runtime. Its explicit dependencies are the closed production workspace graph reachable from the CLI, Web profile, and desktop-native provider, including peer-only runtime edges that legacy `pnpm deploy` would otherwise omit.

It contains no application logic. `apps/desktop/scripts/prepare-runtime.mjs` deploys this manifest with production dependencies into the Tauri resource directory, and `scripts/verify-runtime-closure.ts --manifest apps/desktop-runtime/package.json` rejects a missing workspace edge before packaging.
