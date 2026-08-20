# `@deepseek-ai/dsh-desktop-runtime`

[English](README.md) | 中文

这是桌面应用打包 TypeScript 运行时使用的私有 workspace 部署根。它显式列出从 CLI、Web profile 和 desktop-native provider 可达的闭合生产 workspace 依赖图，包括 legacy `pnpm deploy` 可能遗漏的纯 peer 运行时边。

该包不包含应用逻辑。`apps/desktop/scripts/prepare-runtime.mjs` 会把这份 manifest 及其生产依赖部署到 Tauri resource 目录；`scripts/verify-runtime-closure.ts --manifest apps/desktop-runtime/package.json` 会在打包前拒绝缺失的 workspace 边。
