/** Real private files exercise restart observations without guessing process liveness. */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { PreparationJournal } from '../src/journal.ts'
import type { BundleCatalogId, BundleOperationId, JournalConfig, PreparedBundle, ReviewedBundle } from '../src/types.ts'

vi.mock('@deepseek-ai/dsh-atomic-write', async (importOriginal) => {
  const real = await importOriginal<typeof import('@deepseek-ai/dsh-atomic-write')>()
  return { ...real, writeFileAtomic: vi.fn(real.writeFileAtomic) }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return { ...real, lstat: vi.fn(real.lstat) }
})
const realAtomic = await vi.importActual<typeof import('@deepseek-ai/dsh-atomic-write')>('@deepseek-ai/dsh-atomic-write')
const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const roots: string[] = []
afterEach(async () => {
  vi.mocked(writeFileAtomic).mockReset().mockImplementation(realAtomic.writeFileAtomic)
  vi.mocked(lstat).mockReset().mockImplementation(realFs.lstat)
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const entry: ReviewedBundle = { id: 'fixture' as BundleCatalogId, packageName: '@example/fixture', version: '1.0.0',
  title: 'Fixture', publisher: 'Test', source: 'https://example.com', details: null, harnessVersions: ['fixture'], platforms: ['darwin-arm64'],
  artifact: { file: 'fixture.tgz', size: 1, sha256: 'a'.repeat(64) } }

async function fixture(overrides: Partial<JournalConfig> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-operation-journal-'))
  roots.push(root)
  const staging = join(root, 'staged')
  const config = { directory: join(root, 'history'), maxEntries: 100, maxRecordBytes: 8192, ...overrides }
  const journal = new PreparationJournal(config, staging)
  const id = randomUUID() as BundleOperationId
  const directory = join(config.directory, `op-${id}`)
  const preparedDirectory = join(staging, 'bundle-abcdef')
  const receipt: PreparedBundle = { schemaVersion: 1, state: 'prepared-not-enabled', entry, hostVersion: 'fixture', platform: 'darwin-arm64',
    artifactPath: join(preparedDirectory, 'fixture.tgz'), receiptPath: join(preparedDirectory, 'prepared.json') }
  const prepare = async () => {
    await mkdir(preparedDirectory, { recursive: true })
    await writeFile(receipt.receiptPath, `${JSON.stringify(receipt)}\n`)
    return receipt
  }
  return { root, staging, config, journal, id, directory, receipt, prepare, preparedDirectory }
}

describe('preparation operation journal', () => {
  it('publishes complete observations, survives recreation and detects changed or missing receipts', async () => {
    const f = await fixture()
    expect(await f.journal.list()).toEqual([])
    const reached = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const pending = f.journal.run(f.id, 'artifact', entry, async () => { reached.resolve(undefined); await release.promise; return f.prepare() })
    await reached.promise
    try {
      expect(await f.journal.list(f.id)).toMatchObject([{ id: f.id, state: 'preparing', kind: 'artifact' }])
      expect(await new PreparationJournal(f.config, f.staging).list()).toMatchObject([{ state: 'unsettled' }])
    } finally { release.resolve(undefined); await pending }
    const observer = new PreparationJournal(f.config, f.staging)
    expect(await observer.list()).toMatchObject([{ id: f.id, state: 'prepared', preparedState: 'prepared-not-enabled' }])
    await writeFile(f.receipt.receiptPath, 'changed')
    expect(await observer.list()).toMatchObject([{ state: 'unavailable' }])
    await rm(f.receipt.receiptPath)
    expect(await observer.list()).toMatchObject([{ state: 'unavailable' }])
    await expect(f.journal.run(f.id, 'artifact', entry, f.prepare)).rejects.toMatchObject({ code: 'EEXIST' })
  })
  it('records failure without persisting raw errors or deleting unrelated artifacts', async () => {
    const f = await fixture()
    await f.prepare()
    await expect(f.journal.run(f.id, 'artifact', entry, () => Promise.reject(new Error('synthetic-sensitive-message')))).rejects.toThrow('synthetic-sensitive-message')
    expect(await f.journal.list()).toMatchObject([{ state: 'failed', entry: { id: entry.id } }])
    expect(await readFile(join(f.directory, 'result.json'), 'utf8')).not.toContain('synthetic-sensitive-message')
    expect(await readFile(f.receipt.receiptPath, 'utf8')).toContain('prepared-not-enabled')
  })
  it('keeps unreadable attempts visible alongside healthy history', async () => {
    const f = await fixture()
    await f.journal.run(f.id, 'artifact', entry, f.prepare)
    const other = randomUUID() as BundleOperationId
    await mkdir(join(f.config.directory, `op-${other}`))
    expect(await f.journal.list()).toMatchObject([{ state: 'prepared' }, { id: other, state: 'unreadable' }])
    await writeFile(join(f.directory, 'begin.json'), '{')
    expect((await f.journal.list()).every(item => item.state === 'unreadable')).toBe(true)
  })
  it.each([
    { schemaVersion: 2, state: 'failed' },
    { schemaVersion: 1, state: 'prepared', preparedState: 'prepared-not-enabled', directory: '../escape', file: 'prepared.json', sha256: 'a'.repeat(64) },
    { schemaVersion: 1, state: 'prepared', preparedState: 'dependencies-prepared-not-enabled', directory: 'bundle-abcdef', file: 'prepared.json', sha256: 'a'.repeat(64) },
    { schemaVersion: 1, state: 'prepared', preparedState: 'prepared-not-enabled', directory: 'bundle-abcdef', file: 'composition.json', sha256: 'a'.repeat(64) },
  ])('rejects inconsistent terminal metadata %#', async (terminal) => {
    const f = await fixture()
    await f.journal.run(f.id, 'artifact', entry, f.prepare)
    await writeFile(join(f.directory, 'result.json'), JSON.stringify(terminal))
    expect(await f.journal.list()).toEqual([{ id: f.id, state: 'unreadable' }])
  })
  it('rejects identity mismatch, invalid UTF-8 and unreadable record files', async () => {
    const f = await fixture()
    await f.journal.run(f.id, 'artifact', entry, f.prepare)
    const original = await readFile(join(f.directory, 'begin.json'), 'utf8')
    await writeFile(join(f.directory, 'begin.json'), original.replace(f.id, randomUUID()))
    expect(await f.journal.list()).toEqual([{ id: f.id, state: 'unreadable' }])
    await writeFile(join(f.directory, 'begin.json'), Buffer.from([0xff]))
    expect(await f.journal.list()).toEqual([{ id: f.id, state: 'unreadable' }])
    vi.mocked(lstat).mockImplementation(async (...args) => {
      if (args[0] === join(f.directory, 'begin.json')) throw Object.assign(new Error('unreadable'), { code: 'EACCES' })
      return realFs.lstat(...args)
    })
    expect(await f.journal.list()).toEqual([{ id: f.id, state: 'unreadable' }])
  })
  it('does not follow linked operation or candidate directories', async () => {
    const f = await fixture()
    await f.journal.run(f.id, 'artifact', entry, f.prepare)
    const outside = join(f.root, 'outside')
    await mkdir(outside)
    await rm(f.preparedDirectory, { recursive: true })
    await symlink(outside, f.preparedDirectory, 'junction')
    expect(await f.journal.list()).toMatchObject([{ state: 'unavailable' }])
    await rm(f.directory, { recursive: true })
    await symlink(outside, f.directory, 'junction')
    expect(await f.journal.list()).toEqual([{ id: f.id, state: 'unreadable' }])
    expect(await readdir(outside)).toEqual([])
  })
  it('bounds record size before work and refuses oversized or unrecognized history', async () => {
    const tiny = await fixture({ maxRecordBytes: 1 })
    const run = vi.fn(tiny.prepare)
    await expect(tiny.journal.run(tiny.id, 'artifact', entry, run)).rejects.toThrow('record exceeds')
    expect(run).not.toHaveBeenCalled()
    const limited = await fixture({ maxEntries: 1 })
    await limited.journal.run(limited.id, 'artifact', entry, limited.prepare)
    await mkdir(join(limited.config.directory, `op-${randomUUID()}`))
    await expect(limited.journal.list()).rejects.toThrow('entry limit')
    const malformed = await fixture()
    await mkdir(malformed.config.directory)
    await writeFile(join(malformed.config.directory, 'unexpected'), '')
    await expect(malformed.journal.list()).rejects.toThrow('unsupported history')
    const notDirectory = await fixture()
    await writeFile(notDirectory.config.directory, '')
    await expect(notDirectory.journal.list()).rejects.toMatchObject({ code: 'ENOTDIR' })
  })
  it('keeps unresolved evidence when terminal writes fail and can report a failed commit', async () => {
    const f = await fixture()
    vi.mocked(writeFileAtomic).mockImplementation(async (path, text, options) => {
      if (path.endsWith('result.json')) throw new Error('disk unavailable')
      await realAtomic.writeFileAtomic(path, text, options)
    })
    await expect(f.journal.run(f.id, 'artifact', entry, f.prepare)).rejects.toThrow('recording failed')
    expect(await f.journal.list()).toMatchObject([{ state: 'unsettled' }])
    const next = randomUUID() as BundleOperationId
    let refused = false
    vi.mocked(writeFileAtomic).mockImplementation(async (path, text, options) => {
      if (path.endsWith('result.json') && !refused) { refused = true; throw new Error('first commit refused') }
      await realAtomic.writeFileAtomic(path, text, options)
    })
    await expect(f.journal.run(next, 'artifact', entry, f.prepare)).rejects.toThrow('first commit refused')
    expect(await f.journal.list()).toEqual(expect.arrayContaining([expect.objectContaining({ id: next, state: 'failed' })]))
  })
})
