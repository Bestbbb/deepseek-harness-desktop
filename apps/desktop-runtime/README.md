---
description: "Desktop runtime deployment dependencies, generation, and validation for packaging maintainers."
---

# `@deepseek-ai/dsh-desktop-runtime`

English | [中文](README.zh.md)

This private workspace package is the deployment root for the desktop application's bundled TypeScript runtime. It contains no application logic. Its dependencies close the production workspace graph reachable from the CLI, Web frontend, and desktop-native provider, including required peer dependencies that legacy `pnpm deploy` would otherwise omit.

After changing the upstream base or desktop composition, run `pnpm run desktop:sync` from the repository root, then `pnpm install --frozen-lockfile` if the lockfile is already current. A changed dependency manifest requires updating the lockfile before an immutable install. [The generator](../../scripts/sync-desktop-runtime.ts) follows production, optional, and required peer edges; it excludes development dependencies and optional-only peers.

`pnpm run desktop:verify` rejects stale dependency declarations, missing runtime edges, and inconsistent JavaScript/native version fields. Runtime preparation runs this check before building. [The preparation script](../desktop/scripts/prepare-runtime.mjs) deploys production dependencies and the verified Node executable into Tauri resources. See the [desktop guide](../desktop/README.md#following-upstream) for release alignment.
