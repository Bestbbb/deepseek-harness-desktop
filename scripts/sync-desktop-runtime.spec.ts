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
    ], ['app'])).toEqual({
      dependencies: { app: 'workspace:^', host: 'workspace:^', service: 'workspace:^' },
      optionalDependencies: {},
    })
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
    expect(desktopRuntimeDependencies(manifests, ['app'])).toEqual({
      dependencies: { app: 'workspace:^' }, optionalDependencies: {},
    })
    expect(desktopRuntimeDependencies([
      { ...manifests[0]!, optionalDependencies: { optional: 'workspace:^' } }, manifests[1]!,
    ], ['app'])).toEqual({
      dependencies: { app: 'workspace:^' }, optionalDependencies: { optional: 'workspace:^' },
    })
  })

  it('resolves workspace packages declared with vendored semver ranges', () => {
    expect(desktopRuntimeDependencies([
      { name: 'app', dependencies: { '@deepseek-ai/cordis': '^4.0.0' } }, { name: '@deepseek-ai/cordis' },
    ], ['app'])).toEqual({
      dependencies: { '@deepseek-ai/cordis': 'workspace:^', app: 'workspace:^' }, optionalDependencies: {},
    })
  })

  it('keeps platform packages and their required peers optional when only an optional path reaches them', () => {
    expect(desktopRuntimeDependencies([
      { name: 'app', optionalDependencies: { native: 'workspace:^' } },
      { name: 'native', dependencies: { helper: 'workspace:^' }, peerDependencies: { service: 'workspace:^' } },
      { name: 'helper', dependencies: { native: 'workspace:^' } },
      { name: 'service' },
    ], ['app'])).toEqual({
      dependencies: { app: 'workspace:^' },
      optionalDependencies: { helper: 'workspace:^', native: 'workspace:^', service: 'workspace:^' },
    })
  })

  it('promotes an optional subtree when a later required path reaches its root', () => {
    expect(desktopRuntimeDependencies([
      { name: 'app', dependencies: { bridge: 'workspace:^' }, optionalDependencies: { native: 'workspace:^' } },
      { name: 'bridge', dependencies: { nested: 'workspace:^' } },
      { name: 'nested', dependencies: { native: 'workspace:^' } },
      { name: 'native', dependencies: { helper: 'workspace:^' } },
      { name: 'helper', peerDependencies: { service: 'workspace:^' } },
      { name: 'service' },
    ], ['app'])).toEqual({
      dependencies: {
        app: 'workspace:^', bridge: 'workspace:^', helper: 'workspace:^',
        native: 'workspace:^', nested: 'workspace:^', service: 'workspace:^',
      },
      optionalDependencies: {},
    })
  })

  it('honors an optional declaration that overrides the same direct dependency', () => {
    expect(desktopRuntimeDependencies([
      { name: 'app', dependencies: { native: 'workspace:^' }, optionalDependencies: { native: 'workspace:^' } },
      { name: 'native' },
    ], ['app'])).toEqual({
      dependencies: { app: 'workspace:^' }, optionalDependencies: { native: 'workspace:^' },
    })
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
