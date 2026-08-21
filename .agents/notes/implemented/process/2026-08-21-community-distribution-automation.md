# Agent Note: Community distribution repository automation

Status: implemented

English | [中文](2026-08-21-community-distribution-automation.zh.md)

## Problem

The community desktop repository inherits workflows and dependency automation from the upstream DeepSeek Harness repository. The upstream issue workflows require DeepSeek organization labels, project configuration, repository identity, and GitHub App credentials that are unavailable and unnecessary here. Its primary CI topology also targets private larger-runner and self-hosted pools that this independent repository cannot allocate. The upstream real-API workflow assumes a shared DeepSeek credential, while this public distribution uses bring-your-own-provider credentials. Dependabot initially turns every eligible update into a separate pull request, which creates more concurrent desktop builds than a small community repository can review usefully.

## Decision

The issue-policy and issue-lifecycle workflow files remain as manual stubs for upstream-sync context but do not subscribe to issue, review, or pull-request events. GitHub's ordinary issue and pull-request features own community collaboration until this repository defines its own policy and project automation.

The primary CI workflow replaces the upstream enterprise runner matrix with one portable keyless aggregate on the standard GitHub-hosted `ubuntu-latest` runner. It runs on pull requests, pushes to `main`, and explicit dispatches, uses bounded gate and test concurrency for the smaller public runner, and executes the upstream `check:ci:static`, `check:ci:artifacts`, `check:ci:lint:contracts-ready`, and `check:node-compat` gates. The enterprise aggregate's complete coverage, snapshot, and persistent-PowerShell inventory remains an upstream/private-runner concern; the separate Desktop workflow owns target-native macOS and Windows tests and packaging.

The separate [real-API e2e workflow](../testing/2026-06-19-real-api-e2e-ci.md) is manual-only. Ordinary pushes and pull requests run keyless checks; a maintainer may explicitly run the real suite after configuring `DEEPSEEK_API_KEY_EXTERNAL`. Its preflight still rejects a missing key so a requested real-API run cannot report a false green.

The [Dependabot policy](2026-07-27-dependabot-version-updates.md) retains the 30-day cooldown and weekly schedule. Each configured ecosystem groups all eligible version updates into one pull request and limits version-update pull requests to one open request per ecosystem. Dependabot security updates remain outside that version-update limit and cooldown.

The initial ungrouped Dependabot pull requests are closed after this configuration reaches the default branch. Dependency updates are never auto-merged.

## Alternatives considered

- **Recreate the upstream GitHub App, labels, and project configuration.** Rejected because the community repository does not use the upstream organization's triage process, and copying its credentials or identifiers would not define an appropriate local policy.
- **Recreate the upstream private runner fleet.** Rejected because the community repository needs a portable public signal, not idle jobs tied to unavailable DeepSeek organization infrastructure.
- **Store a shared provider key and run real-API e2e on every push and pull request.** Rejected because documentation and community contributions do not justify credential exposure or provider cost; release validation can request the workflow explicitly.
- **Disable Dependabot version updates entirely.** Rejected because grouped, review-gated updates preserve dependency visibility without the initial pull-request flood. Security updates must remain prompt.

## Consequences

- Ordinary issue, review, pull-request, and push activity does not start workflows that require upstream-only credentials or repository identity.
- Pull requests receive a real keyless CI verdict from public GitHub-hosted infrastructure instead of waiting indefinitely for unavailable private runners.
- Real-provider regressions are not an automatic merge signal; maintainers run the credentialed workflow when provider behavior or a release candidate requires it.
- Routine version updates produce at most one open grouped pull request for each of npm, the Python SDK, and GitHub Actions, while security updates can still open separately.
- Upstream synchronization treats these automation files as an intentional community overlay instead of accepting the upstream trigger and credential policy unchanged.
