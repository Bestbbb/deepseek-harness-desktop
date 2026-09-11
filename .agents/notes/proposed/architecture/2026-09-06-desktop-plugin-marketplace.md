# Agent Note: A Bundle marketplace for non-developer desktop users

Status: proposed

English | [中文](2026-09-06-desktop-plugin-marketplace.zh.md)

## Problem

The desktop extension directory and data-only Skill installer do not manage installable Cordis capabilities. Users need a discoverable path from a task-oriented listing to a configured, working plugin without installing development tools or editing composition files. Independent native preferences and a read-only Harness inventory cannot serve as two authoritative installation states.

## Proposal

Use installable Profile Bundles as the distribution unit. A marketplace entry adds publisher, purpose, screenshots, license, reviewed artifact identity, supported platform/Host combinations, and configuration guidance; package dependencies and Cordis rows stay in the existing package manifest and Bundle patch. Skills and MCP integrations are capabilities a Bundle can compose, not the whole marketplace.

A Cordis plugin-management service should own desired installations and operations, with providers for the reviewed catalog and package-manager execution and a browser consumer for discovery, configuration, installed state, and updates. Split packages only where these roles evolve independently. Runtime observations must remain separate from desired enablement. Tauri retains startup, process supervision, OS operations, application updates, and recovery when plugins fail.

## Delivery sequence

1. Validate packaged external Host and client activation with no developer PATH. The [packaging implementation](../../implemented/architecture/2026-09-06-desktop-bundle-packaging.md) supplies the pinned tool and offline smoke; it is not a marketplace service.
2. Add reviewed catalog parsing, compatibility decisions, operation records, candidate dependency preparation, and controlled activation after active tasks finish. [Local byte preparation](../../implemented/architecture/2026-09-06-reviewed-bundle-preparation.md), [offline dependencies](../../implemented/architecture/2026-09-06-offline-bundle-candidates.md), [candidate Profile composition](../../implemented/architecture/2026-09-07-candidate-profile-composition.md), and [native next-launch activation with startup-failure recovery](../../implemented/architecture/2026-09-07-desktop-profile-startup-selection.md) are implemented. Active-task restart coordination remains pending. Preserve the previous usable composition. Recovery must never overwrite committed Session generations or imply supported data downgrades.
3. Add a unified browser entry with Discover, Installed, and Updates. The [discovery and next-launch command tab](../../implemented/architecture/2026-09-07-desktop-marketplace-browser.md), on-disk Installed versions, explicit version-replacement review and desktop catalog wiring are implemented. The keyed action slot has Focus Timer and Notification Controls consumers with plugin-owned preferences. Update discovery, login flows and use actions for other plugins remain pending. Distinguish downloaded, awaiting configuration, awaiting login, awaiting restart, ready, failed, and incompatible. Every installed entry needs an explicit use action.
4. Deliver three reviewed examples spanning UI, task behavior, and agent collaboration. At least one example needs no account. Provide third-party build templates and publication checks, not copied private workspace presets. The [account-free Focus Timer](../../implemented/feature/2026-09-07-focus-timer-bundle.md) supplies the UI example; [Notification Controls](../../implemented/feature/2026-09-07-notification-controls-bundle.md) supplies the task-behavior example. The collaboration example and third-party publication tools remain pending.
5. Validate native installers, signed application updates, first-task onboarding, and long-session performance with non-developer participants before general release. Arbitrary publisher submissions and stronger isolation are later decisions.

## Alternatives considered

**Make Skills and MCP templates the primary marketplace model.** Rejected because this excludes UI and control-flow capabilities supported by Cordis.

**Move every desktop responsibility into plugins.** Rejected because application startup and recovery must remain available when the plugin runtime fails.

**Open arbitrary npm installation with permission checkboxes.** Rejected because same-process Host plugins do not currently have enforced per-plugin isolation. A declared permission list is not a sandbox.

## Acceptance criteria

- A supported clean machine installs a reviewed Bundle without Node, pnpm, a compiler, or manual configuration edits.
- A real external package contributes both Host behavior and browser UI; removal retracts both after controlled restart.
- Failed installation, interrupted application, incompatible versions, and failed activation preserve a recoverable composition and user data.
- Secrets stay in the credentials service. Real-model checks require explicit invocation and disclose possible account usage.
- Publisher provenance, artifact verification, update trust, and application signing have distinct verification paths.
- Native macOS and Windows acceptance complements focused unit, packaged-runtime, browser, and failure tests; mocks alone do not establish compatibility.

## Risks

Host APIs are pre-stable, so tested combinations constrain publication. Native dependencies need platform-specific prebuilt artifacts. Package-manager scripts, hooks, and inherited configuration require explicit controls. Reviewed code remains trusted code; future process isolation does not automatically restrict filesystem access. Safe recovery can restore code/configuration only when plugin data compatibility permits it. Performance budgets need measured startup, process-tree memory, input latency, and long-session baselines before they become release gates.
