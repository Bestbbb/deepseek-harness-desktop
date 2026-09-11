/** Profile reads use real files and the upstream resolver without executing packages. */
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { readProfileBundles } from '../src/inventory.ts'
import { boundedFile } from '../src/files.ts'
import type { CompositionConfig } from '../src/types.ts'
import type { DesktopProfileName } from '@deepseek-ai/dsh-desktop'

vi.mock('../src/files.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/files.ts')>()
  return { boundedFile: vi.fn(real.boundedFile) }
})
const original = await vi.importActual<typeof import('../src/files.ts')>('../src/files.ts')
const roots: string[] = []
afterEach(async () => {
  vi.mocked(boundedFile).mockReset().mockImplementation(original.boundedFile)
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
const profile = 'web' as DesktopProfileName
async function fixture(bundles: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bundle-inventory-'))
  roots.push(root)
  const home = join(root, 'home')
  const directory = join(home, 'profiles/web')
  await mkdir(directory, { recursive: true })
  const manifest = join(directory, 'package.json')
  await writeFile(manifest, JSON.stringify({ dsh: { profile: { bundles } }, privateSecret: 'never project' }))
  const config: CompositionConfig = { harnessHome: home, profileName: 'web', dshEntry: join(root, 'installation/lib/bin.js'),
    maxProfileBytes: 8192, maxProfileEntries: 10 }
  const put = async (path: string, value: unknown) => {
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'package.json'), JSON.stringify(value))
  }
  return { root, directory, manifest, config, put, read: () => readProfileBundles(config, 1024, profile) }
}
const metadata = { version: '1.2.3', dsh: { bundle: { patch: './patch.yml' } }, scripts: { postinstall: 'must not run' } }

it('reads ordered resolved versions, respects installation precedence and follows package directory links', async () => {
  const f = await fixture(['@test/core', 'linked'])
  await f.put(join(f.root, 'installation/node_modules/@test/core'), metadata)
  await f.put(join(f.directory, 'node_modules/@test/core'), { ...metadata, version: 'ignored-profile-version' })
  const linked = join(f.root, 'linked')
  await f.put(linked, { ...metadata, name: 'original-alias-name', version: '2.0.0' })
  await symlink(linked, join(f.directory, 'node_modules/linked'), 'junction')
  const before = await readFile(f.manifest)
  expect(await f.read()).toEqual([{ packageName: '@test/core', version: '1.2.3', removable: false }, { packageName: 'linked', version: '2.0.0', removable: false }])
  expect(await readFile(f.manifest)).toEqual(before)
})

it('keeps missing, malformed and non-Bundle packages visible with unconfirmed versions', async () => {
  const f = await fixture(['missing', 'invalid', 'library', 'no-version'])
  await f.put(join(f.directory, 'node_modules/library'), { version: '1.0.0' })
  await f.put(join(f.directory, 'node_modules/no-version'), { ...metadata, version: '' })
  await f.put(join(f.directory, 'node_modules/invalid'), {})
  await writeFile(join(f.directory, 'node_modules/invalid/package.json'), Buffer.from([0xff]))
  expect(await f.read()).toEqual(['missing', 'invalid', 'library', 'no-version'].map(packageName => ({ packageName, version: null, removable: false })))
})

it('offers removal only for direct dependencies resolved within the Profile', async () => {
  const f = await fixture(['direct', 'indirect', 'builtin', 'external'])
  await writeFile(f.manifest, JSON.stringify({ dependencies: { direct: '1', builtin: '1', external: '1' },
    dsh: { profile: { bundles: ['direct', 'indirect', 'builtin', 'external'] } } }))
  await f.put(join(f.directory, 'node_modules/.store/direct'), metadata)
  await symlink(join(f.directory, 'node_modules/.store/direct'), join(f.directory, 'node_modules/direct'), 'junction')
  await f.put(join(f.directory, 'node_modules/indirect'), metadata)
  await f.put(join(f.root, 'installation/node_modules/builtin'), metadata)
  await f.put(join(f.root, 'external'), metadata)
  await symlink(join(f.root, 'external'), join(f.directory, 'node_modules/external'), 'junction')
  expect((await f.read()).map(({ packageName, removable }) => ({ packageName, removable }))).toEqual([
    { packageName: 'direct', removable: true }, { packageName: 'indirect', removable: false },
    { packageName: 'builtin', removable: false }, { packageName: 'external', removable: false },
  ])
})

it.each([{}, { dsh: {} }, { dsh: { profile: {} } }])('reads an explicitly empty Profile without creating files %#', async (value) => {
  const f = await fixture()
  await writeFile(f.manifest, JSON.stringify(value))
  expect(await f.read()).toEqual([])
})

it('rejects missing, unsafe, malformed, duplicate and excessive Profile layers', async () => {
  const f = await fixture(['same', 'same'])
  await expect(f.read()).rejects.toThrow('duplicate or excessive')
  await expect(readProfileBundles(f.config, 1024, '../escape' as DesktopProfileName)).rejects.toThrow('invalid profile')
  await expect(readProfileBundles(f.config, 1024, 'absent' as DesktopProfileName)).rejects.toThrow()
  for (const value of ['{', '{"dsh":{"profile":{"bundles":["../escape"]}}}', '{"dsh":{"profile":{"bundles":null}}}']) {
    await writeFile(f.manifest, value)
    await expect(f.read()).rejects.toThrow()
  }
  await writeFile(f.manifest, JSON.stringify({ dsh: { profile: { bundles: ['first', 'second'] } } }))
  f.config.maxProfileEntries = 1
  await expect(f.read()).rejects.toThrow('duplicate or excessive')
})

it('bounds per-package and complete manifest bytes including an empty Profile', async () => {
  const f = await fixture(['large'])
  await f.put(join(f.directory, 'node_modules/large'), { ...metadata, padding: 'x'.repeat(1024) })
  expect(await f.read()).toEqual([{ packageName: 'large', version: null, removable: false }])
  await f.put(join(f.directory, 'node_modules/large'), metadata)
  f.config.maxProfileBytes = (await readFile(f.manifest)).length
  await expect(f.read()).rejects.toThrow('complete read limit')
  await writeFile(f.manifest, '{}')
  f.config.maxProfileBytes = 1
  await expect(f.read()).rejects.toThrow('complete read limit')
})

it('rejects a Profile changed between the initial manifest and completed package read', async () => {
  const f = await fixture(['example'])
  await f.put(join(f.directory, 'node_modules/example'), metadata)
  vi.mocked(boundedFile).mockImplementation(async (path, limit) => {
    const bytes = await original.boundedFile(path, limit)
    if (path.endsWith('node_modules/example/package.json')) await writeFile(f.manifest, '{}')
    return bytes
  })
  await expect(f.read()).rejects.toThrow('Profile changed')
})
