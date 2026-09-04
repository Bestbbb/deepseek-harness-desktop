/** Desktop dependency generation follows changed production graphs without retaining unused packages. */

import { describe, expect, it } from 'vitest'
import { desktopRuntimeDependencies } from './sync-desktop-runtime.ts'

describe('desktop runtime dependencies', () => {
  it('includes transitive production and required peer dependencies through cycles', () => {
    expect(desktopRuntimeDependencies([
      { name: 'app', dependencies: { host: 'workspace:^', external: '1.0.0' } },
      { name: 'host', peerDependencies: { service: 'workspace:^' } },
      { name: 'service', dependencies: { host: 'workspace:^' } },
      { name: 'unused' },
    ], ['app'])).toEqual({ app: 'workspace:^', host: 'workspace:^', service: 'workspace:^' })
  })

  it('omits optional peers unless a production edge also reaches them', () => {
    const manifests = [
      {
        name: 'app',
        peerDependencies: { optional: 'workspace:^' },
        peerDependenciesMeta: { optional: { optional: true } },
      },
      { name: 'optional' },
    ]
    expect(desktopRuntimeDependencies(manifests, ['app'])).toEqual({ app: 'workspace:^' })
    expect(desktopRuntimeDependencies([
      { ...manifests[0]!, optionalDependencies: { optional: 'workspace:^' } }, manifests[1]!,
    ], ['app'])).toEqual({ app: 'workspace:^', optional: 'workspace:^' })
  })

  it('resolves workspace packages declared with vendored semver ranges', () => {
    expect(desktopRuntimeDependencies([
      { name: 'app', dependencies: { cordis: '^4.0.0' } }, { name: 'cordis' },
    ], ['app'])).toEqual({ app: 'workspace:^', cordis: 'workspace:^' })
  })

  it('rejects missing roots and unresolved required workspace dependencies', () => {
    expect(() => desktopRuntimeDependencies([], [])).toThrow('at least one application root')
    expect(() => desktopRuntimeDependencies([], ['app'])).toThrow('missing workspace package app')
    expect(() => desktopRuntimeDependencies([
      { name: 'app', dependencies: { missing: 'workspace:^' } },
    ], ['app'])).toThrow('app requires missing workspace package missing')
  })

  it('rejects ambiguous names instead of choosing one package', () => {
    expect(() => desktopRuntimeDependencies([{ name: 'app' }, { name: 'app' }], ['app']))
      .toThrow('duplicate workspace package app')
  })
})
