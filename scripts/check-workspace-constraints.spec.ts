/** Workspace publication and experimental dependency constraints. */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  checkWorkspaceManifest,
  expectedDshPackageFiles,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

const experimental: WorkspaceManifest = {
  dir: 'packages/experimental/prototype',
  manifest: { name: '@deepseek-ai/dsh-experimental-prototype', private: true },
}

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@deepseek-ai/dsh-prototype' },
    })).toEqual([
      '@deepseek-ai/dsh-prototype: experimental package name must start with "@deepseek-ai/dsh-experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@deepseek-ai/dsh-experimental-prototype: experimental package must set "private": true',
      '@deepseek-ai/dsh-experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'packages/core/consumer',
        manifest: {
          name: '@deepseek-ai/dsh-consumer',
          [section]: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@deepseek-ai/dsh-consumer: ${section}.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'packages/core/test-only',
      manifest: {
        name: '@deepseek-ai/dsh-test-only',
        devDependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'packages/experimental/consumer',
      manifest: {
        name: '@deepseek-ai/dsh-experimental-consumer',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'python/sdk-runtime',
      manifest: {
        name: '@deepseek-ai/dsh-python-runtime',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@deepseek-ai/dsh-python-runtime: dependencies.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package',
    ])
  })
})

describe('package payload constraints', () => {
  it('includes a declared profile patch without a package-name allowlist', () => {
    expect(expectedDshPackageFiles({
      name: '@deepseek-ai/dsh-private-profile',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })).toEqual([
      'lib/index.js',
      'cordis.patch.yml',
      'lib/types/**/*.d.ts',
    ])
  })
})

describe('desktop package payload constraints', () => {
  const desktop: WorkspaceManifest = {
    dir: 'apps/desktop',
    manifest: JSON.parse(readFileSync(new URL('../apps/desktop/package.json', import.meta.url), 'utf8')) as WorkspaceManifest['manifest'],
  }

  it('accepts the shipped source-only application manifest', () => {
    expect(checkWorkspaceManifest(desktop)).toEqual([])
  })

  it.each(['src-tauri', 'src-tauri/target', 'src-tauri/resources', 'src-tauri/gen'])(
    'rejects a payload expanded to %s',
    (directory) => {
      expect(checkWorkspaceManifest({
        ...desktop,
        manifest: { ...desktop.manifest, files: [...desktop.manifest.files!, directory] },
      })).toEqual([
        `apps/desktop/package.json: @deepseek-ai/dsh-desktop-app: package.json files must be ${JSON.stringify(desktop.manifest.files)}`,
      ])
    },
  )

  it('rejects a payload missing the native build configuration', () => {
    expect(checkWorkspaceManifest({
      ...desktop,
      manifest: {
        ...desktop.manifest,
        files: desktop.manifest.files!.filter(file => file !== 'src-tauri/tauri.conf.json'),
      },
    })).toEqual([
      `apps/desktop/package.json: @deepseek-ai/dsh-desktop-app: package.json files must be ${JSON.stringify(desktop.manifest.files)}`,
    ])
  })
})
