/** Version and hosted-workflow checks for the desktop distribution. */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { verifyDesktopRelease, verifyDesktopVersions } from './verify-desktop-release.ts'

const root = resolve(import.meta.dirname, '..')

function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}

describe('desktop release', () => {
  it('aligns the actual native and JavaScript manifests', () => {
    expect(() => {
      verifyDesktopRelease(root)
    }).not.toThrow()
  })

  it('accepts aligned preview versions and their exact desktop tag', () => {
    expect(() => {
      verifyDesktopVersions({
        'apps/desktop/package.json': '0.1.2-rc.1', native: '0.1.2-rc.1',
      }, 'desktop-v0.1.2-rc.1')
    }).not.toThrow()
  })

  it('rejects an absent application, a stale component, and a mismatched tag', () => {
    expect(() => {
      verifyDesktopVersions({})
    }).toThrow('application version is missing')
    expect(() => {
      verifyDesktopVersions({
        'apps/desktop/package.json': '0.1.2-rc.1', native: '0.1.1',
      })
    }).toThrow('native: desktop version must be 0.1.2-rc.1')
    expect(() => {
      verifyDesktopVersions({
        'apps/desktop/package.json': '0.1.2-rc.1',
      }, 'v0.1.2-rc.1')
    }).toThrow('Desktop tag must be desktop-v0.1.2-rc.1')
  })

  it('checks runtime changes on both native hosted targets before releasing', () => {
    const workflow = record(load(readFileSync(resolve(root, '.github/workflows/desktop.yml'), 'utf8')))
    expect(workflow.permissions).toEqual({ contents: 'read' })
    const triggers = record(workflow.on)
    expect(record(triggers.pull_request).paths).toEqual(expect.arrayContaining([
      'apps/**', 'packages/**', 'vendor/**', 'native/**', 'scripts/**', 'pnpm-lock.yaml',
    ]))
    expect(triggers.push).toEqual({ tags: ['desktop-v*'] })
    const jobs = record(workflow.jobs)
    const build = record(jobs.build)
    const matrix = record(record(build.strategy).matrix)
    expect(matrix.include).toEqual([
      { target: 'macos-arm64', runner: 'macos-15', artifact: 'harness-desktop-macos-arm64' },
      { target: 'windows-x64', runner: 'windows-2025', artifact: 'harness-desktop-windows-x64' },
    ])
    assert(Array.isArray(build.steps))
    const steps = build.steps.map(record)
    const commands = steps.map(step => step.run).filter((run): run is string => typeof run === 'string')
    for (const command of [
      'pnpm install --frozen-lockfile', 'pnpm run desktop:prepare', 'pnpm run desktop:smoke',
      'pnpm run desktop:test', 'cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml',
    ]) expect(commands).toContain(command)
    expect(steps.find(step => step.name === 'Verify release tag matches the application version')).toMatchObject({
      if: "startsWith(github.ref, 'refs/tags/desktop-v')",
      run: 'pnpm exec tsx scripts/verify-desktop-release.ts "${{ github.ref_name }}"',
    })
    const uploads = steps.filter(step => typeof step.uses === 'string' && step.uses.startsWith('actions/upload-artifact@'))
    expect(uploads).toHaveLength(2)
    expect(uploads.map(step => record(step.with).path)).toEqual([
      'apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg',
      'apps/desktop/src-tauri/target/release/bundle/nsis/*.exe',
    ])
    for (const upload of uploads) expect(record(upload.with)['if-no-files-found']).toBe('error')
    expect(jobs.release).toMatchObject({
      needs: 'build', if: "startsWith(github.ref, 'refs/tags/desktop-v')",
      'runs-on': 'ubuntu-latest', permissions: { contents: 'write' },
    })
    const release = record(jobs.release)
    assert(Array.isArray(release.steps))
    const publish = release.steps.map(record).find(step => step.name === 'Publish installers and checksums')
    assert(typeof publish?.run === 'string')
    expect(publish.run).toContain('sha256sum')
    expect(publish.run).toContain('--verify-tag')
    expect(publish.run).toContain('--prerelease')
    expect(publish.run).toContain('not notarized')
    expect(publish.run).toContain('Windows x64: unsigned')
    expect(publish.run).toContain('Automatic updates are not configured')
    expect(publish.run).toContain('--notes "$notes"')
    expect(publish.run).not.toContain('--clobber')
  })
})
