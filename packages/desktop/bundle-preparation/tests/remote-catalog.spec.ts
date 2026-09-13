/** Signed metadata rejects tampering and replay; cache tests own private roots and deterministic clocks. */
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteCatalog } from '../src/remote-catalog.ts'
import { downloadCatalogBytes } from '../src/catalog-download.ts'
import { keys, now, publication, publicKey, remoteConfig, signed } from './remote-fixture.ts'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-signed-catalog-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const config = remoteConfig(join(root, 'catalog.json'))
  return { root, config, catalog: new RemoteCatalog(config, 32_768) }
}
function response(bytes: Buffer = signed()): typeof fetch {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(bytes)))
}

describe('signed catalogs', () => {
  it('validates pinned keys, exact origins and absolute cache paths at configuration', async () => {
    const f = await fixture()
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString()
    for (const change of [{ cacheFile: 'relative' }, { allowedOrigins: [] }, { allowedOrigins: ['https://example.com/path'] },
      { allowedOrigins: ['https://example.com', 'http://other.example.com'] },
      { url: 'http://example.com/catalog' }, { publicKeys: [] }, { publicKeys: ['invalid'] }, { publicKeys: [rsa] },
      { publicKeys: [keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()] }]) {
      expect(() => new RemoteCatalog({ ...f.config, ...change }, 32_768)).toThrow()
    }
  })
  it('accepts exact signed metadata, an empty revocation catalog and overlapping pinned keys', async () => {
    const f = await fixture()
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const catalog = new RemoteCatalog({ ...f.config, publicKeys: [other, publicKey] }, 32_768)
    expect(catalog.verify(signed(), now)).toMatchObject({ revision: 1, entries: publication.catalog.entries })
    expect(catalog.verify(signed({ ...publication, catalog: { schemaVersion: 1, entries: [] } }), now).entries).toEqual([])
    expect(f.catalog.verify(signed(), now + 120_000).revision).toBe(1)
  })
  it('rejects altered bytes, signatures, noncanonical encoding and malformed envelopes', async () => {
    const f = await fixture()
    const valid = JSON.parse(signed().toString()) as { schemaVersion: number; payload: string; signature: string }
    for (const value of [{ ...valid, payload: valid.payload + '\n' }, { ...valid, signature: '' },
      { ...valid, signature: Buffer.alloc(64).toString('base64') }, { ...valid, payload: Buffer.from('{}').toString('base64') },
      { ...valid, extra: true }, { ...valid, schemaVersion: 2 }]) {
      expect(() => f.catalog.verify(Buffer.from(JSON.stringify(value)), now)).toThrow()
    }
    for (const bytes of [Buffer.from([255]), Buffer.from('{'), Buffer.alloc(65_537)]) {
      expect(() => f.catalog.verify(bytes, now)).toThrow()
    }
  })
  it('rejects incorrect channels, dates, origins, directory URLs, missing guidance and bounded catalog overflow', async () => {
    const f = await fixture()
    for (const change of [{ channel: 'other' }, { revision: 0 }, { issuedAt: 'invalid' },
      { issuedAt: new Date(now + 2_000).toISOString() }, { expiresAt: publication.issuedAt },
      { expiresAt: new Date(now + 86_400_001).toISOString() },
      ...['http://example.com/', 'https://evil.example/', 'https://u:p@example.com/', 'https://example.com/?q=1', 'https://example.com/#hash', 'https://example.com/file'].map(artifactBaseUrl => ({ artifactBaseUrl })),
      { catalog: { schemaVersion: 1, entries: [{ ...publication.catalog.entries[0], details: null }] } }]) {
      expect(() => f.catalog.verify(signed({ ...publication, ...change }), now)).toThrow()
    }
    expect(() => new RemoteCatalog(f.config, 1).verify(signed(), now)).toThrow('catalog exceeds')
  })
  it('reads without creating files and refuses corrupt caches instead of treating them as absent', async () => {
    const f = await fixture()
    expect(await f.catalog.read(now)).toBeNull()
    expect(await readdir(f.root)).toEqual([])
    await writeFile(f.config.cacheFile, signed())
    expect(await f.catalog.read(now)).toMatchObject({ revision: 1 })
    await writeFile(f.config.cacheFile, 'corrupt')
    await expect(f.catalog.read(now)).rejects.toThrow()
    await rm(f.config.cacheFile)
    await mkdir(f.config.cacheFile)
    await expect(f.catalog.read(now)).rejects.toThrow('regular file')
  })
  it('preserves bytes on rollback, same-revision equivocation, expiry and corrupt-cache refresh', async () => {
    const f = await fixture()
    const signal = new AbortController().signal
    const previous = await f.catalog.refresh(null, signal, response())
    expect(await readFile(f.config.cacheFile)).toEqual(signed())
    await expect(f.catalog.refresh(previous, signal, response())).resolves.toMatchObject({ revision: 1 })
    for (const value of [{ ...publication, revision: 2,
      expiresAt: new Date(now - 1).toISOString(), issuedAt: new Date(now - 2).toISOString() },
    { ...publication, artifactBaseUrl: 'https://example.com/other/' }]) {
      await expect(f.catalog.refresh(previous, signal, response(signed(value)))).rejects.toThrow()
      expect(await readFile(f.config.cacheFile)).toEqual(signed())
    }
    const newer = await f.catalog.refresh(previous, signal, response(signed({ ...publication, revision: 2 })))
    await expect(f.catalog.refresh(newer, signal, response())).rejects.toThrow('rollback')
    await expect(f.catalog.refresh(null, signal, response())).rejects.toThrow('rollback')
    await writeFile(f.config.cacheFile, 'corrupt')
    await expect(f.catalog.refresh(null, signal, response())).rejects.toThrow()
    expect(await readFile(f.config.cacheFile, 'utf8')).toBe('corrupt')
  })
  it('rereads the cache after an overlapping writer publishes a newer revision', async () => {
    const f = await fixture()
    const delayed = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<undefined>()
    const older = f.catalog.refresh(null, new AbortController().signal, async () => { started.resolve(undefined); return delayed.promise })
    const outcome = expect(older).rejects.toThrow('rollback')
    try {
      await started.promise
      const other = new RemoteCatalog(f.config, 32_768)
      await other.refresh(null, new AbortController().signal, response(signed({ ...publication, revision: 2 })))
    } finally { delayed.resolve(new Response(signed().toString())); await outcome }
    expect(await f.catalog.read(now)).toMatchObject({ revision: 2 })
    expect(await readdir(f.root)).toEqual(['catalog.json'])
  })
  it('refuses an expired artifact before contacting the network', async () => {
    const f = await fixture()
    const catalog = f.catalog.verify(signed(), now)
    vi.mocked(Date.now).mockReturnValue(now + 120_000)
    await expect(f.catalog.artifact(catalog, catalog.entries[0]!, new AbortController().signal)).rejects.toThrow('expired')
  })
})

describe('bounded HTTPS responses', () => {
  it('omits credentials, disallows redirects and enforces actual streamed size without trusting headers', async () => {
    const transport = response(Buffer.from('ok'))
    const signal = new AbortController().signal
    expect(await downloadCatalogBytes('https://example.com/file', 2, 5_000, signal, transport)).toEqual(Buffer.from('ok'))
    expect(transport).toHaveBeenCalledWith('https://example.com/file', expect.objectContaining({ credentials: 'omit', redirect: 'error', cache: 'no-store' }))
    await expect(downloadCatalogBytes('https://example.com/file', 1, 5_000, signal, response(Buffer.from('too large')))).rejects.toThrow('byte limit')
    for (const value of [new Response('failure', { status: 404 }), new Response(null)]) {
      await expect(downloadCatalogBytes('https://example.com/file', 10, 5_000, signal, async () => value)).rejects.toThrow('download failed')
    }
  })
  it('cancels a response stalled after headers when its complete-body deadline expires', async () => {
    const cancelled = vi.fn()
    const transport: typeof fetch = async (_url, options) => new Response(new ReadableStream({
      start(controller) { options!.signal!.addEventListener('abort', () =>{  controller.error(options!.signal!.reason) }, { once: true }) },
      cancel: cancelled,
    }))
    await expect(downloadCatalogBytes('https://example.com/file', 10, 10, new AbortController().signal, transport)).rejects.toThrow('timed out')
    // An errored stream rejects cancel; the original deadline error remains observable.
    expect(cancelled).not.toHaveBeenCalled()
  })
  it('does not start a pre-cancelled request and releases a reader after a successful response', async () => {
    const abort = new AbortController()
    abort.abort(new Error('owner stopped'))
    const transport = response()
    await expect(downloadCatalogBytes('https://example.com/file', 100, 5_000, abort.signal, transport)).rejects.toThrow('owner stopped')
    expect(transport).not.toHaveBeenCalled()
    const body = new Response('ok')
    await downloadCatalogBytes('https://example.com/file', 2, 5_000, new AbortController().signal, async () => body)
    expect(body.body!.locked).toBe(false)
  })
})
