---
description: "面向打包维护者的桌面运行时部署依赖、生成与校验说明。"
---

# `@deepseek-ai/dsh-desktop-runtime`

[English](README.md) | 中文

这个私有 workspace package 是桌面应用所捆绑 TypeScript 运行时的部署根，本身不含应用逻辑。它的依赖闭合了从 CLI（命令行界面）、Web 前端和 desktop-native provider 可达的生产 workspace 依赖图，其中包括旧版 `pnpm deploy` 可能遗漏的必需对等依赖（peer dependency）。

变更上游基线或桌面组合后，在仓库根目录运行 `pnpm run desktop:sync`；如果 lockfile 已是当前状态，再运行 `pnpm install --frozen-lockfile`。依赖 manifest 发生变化时，必须先更新 lockfile，再执行不可变安装。[生成器](../../scripts/sync-desktop-runtime.ts)遍历生产、可选和必需对等依赖边，排除开发依赖及仅作为可选 peer 出现的依赖。

`pnpm run desktop:verify` 会拒绝陈旧的依赖声明、缺失的运行时依赖边，以及不一致的 JavaScript/原生版本字段。运行时准备会在构建前执行该检查。[准备脚本](../desktop/scripts/prepare-runtime.mjs)把生产依赖和经过校验的 Node 可执行文件部署到 Tauri resources。发布对齐流程见[桌面指南](../desktop/README.zh.md#following-upstream)。
