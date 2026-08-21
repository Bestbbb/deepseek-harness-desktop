# Agent Note: Sync the desktop distribution to dsh-v0.1.1-rc.1

Status: implemented

English | [中文](2026-08-21-upstream-rc1-desktop-sync.zh.md)

## Problem

Harness Desktop was first cut from `dsh-v0.1.0-rc.8`, while upstream `dsh-v0.1.1-rc.1` changes the product composition around Profiles and installable Bundles, adds dynamic Cordis plugin surfaces and credential authorization flows, expands provider and multimodal behavior, and introduces optional Codex and Claude Code subagent providers. Keeping the desktop runtime pinned to rc.8 would split its model, plugin, and session behavior from the Harness version users expect. Replacing the desktop branch with upstream wholesale would instead remove the Tauri lifecycle, authenticated loopback boundary, packaged runtime closure, and public-community automation policy.

## Decision

Merge the exact public upstream tag `dsh-v0.1.1-rc.1` into the community history and retain the desktop implementation as a narrow overlay. The overlay consists of the Tauri app, the desktop runtime dependency root, the `ctx.desktop` seam and native provider, its authenticated profile patch, desktop tests and packaging workflow, and desktop-specific documentation. Package and Tauri versions follow the upstream Harness version so the bundled runtime manifest names the code it actually contains.

The desktop runtime continues to boot the upstream `web` Profile and applies `desktop.cordis.yml` only as a final launch overlay. The runtime dependency root follows the current production Web closure, including rc.1's plugin inventory, authorization, provider, and client packages. It does not fork the agent loop, LLM adapter abstraction, Profile loader, or plugin manager.

Codex and Claude Code remain independent optional upstream Profile Bundles: `@deepseek-ai/dsh-subagent-codex` and `@deepseek-ai/dsh-subagent-claude-code`. They are not added to the default desktop production closure. Installing one makes its dormant Host provider available after a Profile restart; a copied Agent Preset must separately enable the matching `subagent_codex` or `subagent_claude_code` tool. Each provider uses its pinned product runtime and the user's corresponding product authentication; Harness Desktop does not collect those product credentials or start a provider before a tool call.

The plugin forwarder explicitly waives pnpm's workspace-root mutation guard for its managed child process. A Profile is intentionally a one-package workspace; without that scoped setting pnpm 11 rejects `add` and `remove` at the root, including installation of the optional subagent bundles. The environment override leaves forwarded arguments untouched, so non-mutating verbs keep their normal semantics and users do not need to add pnpm's `-w` flag themselves.

The [community automation policy](2026-08-21-community-distribution-automation.md) remains an intentional overlay during this and later upstream merges: standard public runners replace private upstream pools, upstream issue-project mutations remain manual stubs, and credentialed real-provider E2E stays manual-only.

## Alternatives considered

- **Keep the desktop release on rc.8.** Rejected because provider, multimodal, credential, plugin, and subagent behavior would immediately diverge from the public Harness release line.
- **Rebuild the new upstream behavior in Rust.** Rejected because Profiles, Cordis plugins, model adapters, and agent orchestration are TypeScript product semantics; duplicating them would create two incompatible Harness implementations.
- **Bundle and activate Codex and Claude Code for every desktop user.** Rejected because their platform payloads, product trust boundaries, and authentication requirements are optional. Host availability and per-Agent permission stay explicit and independently removable.
- **Accept upstream CI and issue workflows unchanged.** Rejected because their private runners, organization App, and Project board do not exist in the community repository.

## Consequences

- The desktop application receives rc.1's upstream provider, multimodal, authorization, Profile, plugin, and subagent framework without a second implementation.
- The Tauri and authenticated local-host boundaries remain isolated from ordinary Web and headless Profiles.
- Codex and Claude Code can be used as subagent providers after explicit Profile installation, Profile restart, Agent Preset enablement, and product authentication; synchronization alone does not silently grant either tool.
- Profile plugin installation remains usable with pnpm 11 from both the standalone CLI and pnpm-launched test or development processes.
- Future upstream tags are merged into the same history and must preserve the documented community and desktop overlays rather than copying individual upstream files by hand.
