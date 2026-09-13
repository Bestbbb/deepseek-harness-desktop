/** Real Cordis catalog selection, consent fencing and disposal with only HTTPS and clock substituted. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BundlePreparation, { type BundleCatalogId } from '../src/index.ts'
import { artifactBytes, now, publication, remoteConfig, remoteEntry, signed } from './remote-fixture.ts'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { try { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() } finally { vi.restoreAllMocks() } })
async function fixture(cache?: Buffer, enabled = true) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-remote-service-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const config = BundlePreparation.Config({ catalogFile: join(root, 'bundled.json'), artifactDirectory: root,
    stagingDirectory: join(root, 'staged'), hostVersion: 'fixture-host', maxCatalogBytes: 1_048_576, maxArtifactBytes: 52_428_800,
    remote: enabled ? remoteConfig(join(root, 'cache.json')) : false })
  await writeFile(config.catalogFile, JSON.stringify(publication.catalog))
  await writeFile(join(root, 'remote.tgz'), artifactBytes)
  if (cache !== undefined) await writeFile(join(root, 'cache.json'), cache)
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const fiber = await ctx.plugin(BundlePreparation, config)
  return { root, config, ctx, fiber, service: ctx.bundlePreparation }
}
function network() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (input === 'https://example.com/catalog.signed.json') return new Response(signed().toString())
    if (input === 'https://example.com/bundles/remote.tgz') return new Response(new Uint8Array(artifactBytes))
    throw new Error('Unexpected fixture request')
  })
}
const id = remoteEntry.id as BundleCatalogId

describe('online catalog selection', () => {
  it('keeps source deployments local and rejects unconfigured or disposed checks', async () => {
    const f = await fixture(undefined, false)
    expect(f.service.catalogStatus()).toEqual({ source: 'bundled', remoteConfigured: false, revision: null, expiresAt: null })
    await expect(f.service.refreshCatalog()).rejects.toThrow('not configured')
    await f.fiber.dispose()
    await expect(f.service.refreshCatalog()).rejects.toThrow('disposed')
  })
  it('starts without network, checks on request and stages exact online bytes without changing the active Profile', async () => {
    const transport = network()
    const f = await fixture()
    expect(transport).not.toHaveBeenCalled()
    const oldToken = f.service.list()[0]!.reviewToken
    expect(f.service.catalogStatus().source).toBe('bundled')
    await f.service.refreshCatalog()
    expect(f.service.catalogStatus()).toMatchObject({ source: 'online', revision: 1 })
    expect(f.service.list()[0]!.reviewToken).not.toBe(oldToken)
    await expect(f.service.queueActivation(id, 'web' as never, null, oldToken)).rejects.toThrow('changed or expired')
    const prepared = await f.service.prepare(id)
    expect(await readFile(prepared.artifactPath)).toEqual(artifactBytes)
    expect(transport).toHaveBeenCalledTimes(2)
    await expect(readdir(join(f.root, 'profiles'))).rejects.toMatchObject({ code: 'ENOENT' })
    transport.mockRejectedValueOnce(new Error('offline'))
    await expect(f.service.refreshCatalog()).rejects.toThrow('offline')
    expect(f.service.catalogStatus().source).toBe('online')
    await f.fiber.dispose()
    await f.ctx.plugin(BundlePreparation, f.config)
    expect(f.ctx.bundlePreparation.catalogStatus().source).toBe('cached')
    expect(transport).toHaveBeenCalledTimes(3)
  })
  it('blocks expired and corrupt cached catalogs without falling back to bundled entries', async () => {
    const transport = network()
    const f = await fixture(signed({ ...publication,
      issuedAt: new Date(now - 2).toISOString(), expiresAt: new Date(now - 1).toISOString() }))
    expect(f.service.catalogStatus().source).toBe('unavailable')
    expect(f.service.list()).toEqual([])
    await expect(f.service.prepare(id)).rejects.toThrow('unknown')
    transport.mockResolvedValueOnce(new Response(signed({ ...publication, revision: 2 }).toString()))
    await f.service.refreshCatalog()
    expect(f.service.list()).toHaveLength(1)
    vi.mocked(Date.now).mockReturnValue(now + 120_000)
    expect(f.service.list()).toEqual([])
    const corrupt = await fixture(Buffer.from('not signed'))
    expect(corrupt.service.catalogStatus().source).toBe('unavailable')
    await expect(corrupt.service.refreshCatalog()).rejects.toThrow()
    expect(await readFile(join(corrupt.root, 'cache.json'), 'utf8')).toBe('not signed')
  })
  it('excludes refresh from preparation and drains cancelled network work during disposal', async () => {
    const transport = network()
    const f = await fixture()
    const preparation = f.service.prepare(id)
    await expect(f.service.refreshCatalog()).rejects.toThrow('in progress')
    await preparation
    const started = Promise.withResolvers<undefined>()
    transport.mockImplementationOnce(async (_input, options) => {
      started.resolve(undefined)
      return new Promise<Response>((_resolve, reject) =>{  options!.signal!.addEventListener('abort', () =>{  reject(options!.signal!.reason as Error) }, { once: true }) })
    })
    const refresh = f.service.refreshCatalog()
    const rejected = expect(refresh).rejects.toThrow('disposed')
    await started.promise
    await expect(f.service.refreshCatalog()).rejects.toThrow('in progress')
    await expect(f.service.prepare(id)).rejects.toThrow('refresh is in progress')
    await f.fiber.dispose()
    await rejected
    await expect(readFile(join(f.root, 'cache.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(f.service.catalogStatus().source).toBe('bundled')
  })
  it('rejects corrupt artifact bytes and drains a cancelled artifact download before creating staging', async () => {
    const transport = network()
    const f = await fixture(signed())
    transport.mockResolvedValueOnce(new Response(new Uint8Array(artifactBytes.length)))
    await expect(f.service.prepare(id)).rejects.toThrow('SHA-256')
    const started = Promise.withResolvers<undefined>()
    transport.mockImplementationOnce(async (_input, options) => {
      started.resolve(undefined)
      return new Promise<Response>((_resolve, reject) =>{  options!.signal!.addEventListener('abort', () =>{  reject(options!.signal!.reason as Error) }, { once: true }) })
    })
    const preparing = f.service.prepare(id)
    const rejected = expect(preparing).rejects.toThrow('disposed')
    await started.promise
    await f.fiber.dispose()
    await rejected
    await expect(readdir(f.config.stagingDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
