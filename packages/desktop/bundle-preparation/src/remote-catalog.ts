/** Pinned Ed25519 catalogs with expiry and serialized rollback-resistant cache replacement. */
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import { parseCatalog } from './catalog.ts'
import { boundedFile } from './files.ts'
import { downloadCatalogBytes } from './catalog-download.ts'
import type { RemoteCatalogConfig, ReviewedBundle } from './types.ts'

const envelopeSchema = z.strictObject({ schemaVersion: z.literal(1), payload: z.string(), signature: z.string() })
const payloadSchema = z.strictObject({
  schemaVersion: z.literal(1), channel: z.string().min(1), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  issuedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), artifactBaseUrl: z.string(), catalog: z.unknown(),
})

/** Verified metadata, including the signed bytes retained for cache publication. */
export interface VerifiedCatalog {
  readonly revision: number
  readonly expiresAt: string
  readonly artifactBaseUrl: string
  readonly entries: readonly ReviewedBundle[]
  readonly digest: string
  readonly envelope: string
}

function endpoint(value: string, origins: readonly string[]): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !origins.includes(url.origin)) {
    throw new Error('bundle catalog: endpoint must use a permitted HTTPS origin without credentials, query or fragment')
  }
  return url
}

function decode(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new Error('bundle catalog: noncanonical base64')
  return bytes
}

function assertRevision(next: VerifiedCatalog, previous: VerifiedCatalog | null): void {
  if (previous !== null && (next.revision < previous.revision
    || (next.revision === previous.revision && next.digest !== previous.digest))) {
    throw new Error('bundle catalog: revision rollback or conflicting signed revision')
  }
}

/** One deployment's trust policy; callers own concurrent operations and cancellation. */
export class RemoteCatalog {
  private readonly keys: readonly KeyObject[]

  constructor(private readonly config: RemoteCatalogConfig, private readonly maxCatalogBytes: number) {
    if (!isAbsolute(config.cacheFile)) throw new Error('bundle catalog: cache path must be absolute')
    if (config.allowedOrigins.length === 0 || config.allowedOrigins.some(value => new URL(value).origin !== value || new URL(value).protocol !== 'https:')) {
      throw new Error('bundle catalog: allowed origins must be exact URL origins')
    }
    endpoint(config.url, config.allowedOrigins)
    if (config.publicKeys.length === 0) throw new Error('bundle catalog: at least one pinned public key is required')
    this.keys = config.publicKeys.map((value) => {
      if (!value.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('bundle catalog: pins must be PEM public keys')
      const key = createPublicKey(value)
      if (key.asymmetricKeyType !== 'ed25519') throw new Error('bundle catalog: only Ed25519 keys are accepted')
      return key
    })
  }

  /**
   * Verify exact signed bytes and publication metadata; expired caches still establish a revision floor.
   * @param bytes - complete bounded envelope bytes.
   * @param now - current epoch milliseconds.
   * @returns Authenticated entries; callers must check expiry before use.
   */
  verify(bytes: Uint8Array, now: number): VerifiedCatalog {
    if (bytes.length > this.config.maxEnvelopeBytes) throw new Error('bundle catalog: envelope exceeds byte limit')
    const envelope = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const parsed = envelopeSchema.parse(JSON.parse(envelope))
    const payload = decode(parsed.payload)
    const signature = decode(parsed.signature)
    if (signature.length !== 64 || !this.keys.some(key => verify(null, payload, key, signature))) {
      throw new Error('bundle catalog: signature verification failed')
    }
    const publication = payloadSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)))
    const issued = Date.parse(publication.issuedAt)
    const expires = Date.parse(publication.expiresAt)
    if (publication.channel !== this.config.channel || issued > now + this.config.clockSkewMs
      || expires <= issued || expires - issued > this.config.maxValidityMs) {
      throw new Error('bundle catalog: invalid channel or validity interval')
    }
    const base = endpoint(publication.artifactBaseUrl, this.config.allowedOrigins)
    if (!base.pathname.endsWith('/')) throw new Error('bundle catalog: artifact base must be a directory URL')
    const catalogBytes = Buffer.from(JSON.stringify(publication.catalog))
    if (catalogBytes.length > this.maxCatalogBytes) throw new Error('bundle catalog: catalog exceeds byte limit')
    const entries = parseCatalog(catalogBytes)
    if (entries.some(entry => entry.details === null)) throw new Error('bundle catalog: online entries require review guidance')
    return { revision: publication.revision, expiresAt: publication.expiresAt, artifactBaseUrl: base.href,
      entries, digest: createHash('sha256').update(payload).digest('hex'), envelope }
  }

  /**
   * Read only the existing cache, without network access or file creation.
   * @param now - current epoch milliseconds used to reject future-issued metadata.
   * @returns Verified cache or null for an absent file; corrupt caches reject instead of falling back.
   */
  async read(now: number): Promise<VerifiedCatalog | null> {
    let bytes: Buffer
    try { bytes = await boundedFile(this.config.cacheFile, this.config.maxEnvelopeBytes) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    return this.verify(bytes, now)
  }

  /**
   * Fetch and publish an unexpired catalog, rereading the revision floor under a cross-process writer lock.
   * @param previous - caller's last verified revision, retained even when expired.
   * @param signal - operation cancellation; publication already committed when cancellation arrives remains valid.
   * @param transport - instance-local HTTPS transport.
   * @returns Verified replacement after its atomic cache write completes.
   */
  async refresh(previous: VerifiedCatalog | null, signal: AbortSignal, transport: typeof fetch = fetch): Promise<VerifiedCatalog> {
    const bytes = await downloadCatalogBytes(this.config.url, this.config.maxEnvelopeBytes, this.config.timeoutMs, signal, transport)
    const next = this.verify(bytes, Date.now())
    assertRevision(next, previous)
    await mkdir(dirname(this.config.cacheFile), { recursive: true, mode: 0o700 })
    await withFileLock(this.config.cacheFile, async () => {
      const current = await this.read(Date.now())
      assertRevision(next, current)
      if (Date.parse(next.expiresAt) <= Date.now()) throw new Error('bundle catalog: catalog has expired')
      signal.throwIfAborted()
      await writeFileAtomic(this.config.cacheFile, next.envelope, { mode: 0o600, dirMode: 0o700 })
    }, { waitMs: this.config.lockWaitMs })
    signal.throwIfAborted()
    return next
  }

  /**
   * Download only the artifact named by verified metadata; the preparation owner checks its digest.
   * @param catalog - selected unexpired signed revision.
   * @param entry - entry selected from that revision by the preparation owner.
   * @param signal - preparation cancellation.
   * @returns Complete bytes within the declared size budget.
   */
  async artifact(catalog: VerifiedCatalog, entry: ReviewedBundle, signal: AbortSignal): Promise<Buffer> {
    if (Date.parse(catalog.expiresAt) <= Date.now()) throw new Error('bundle catalog: catalog has expired')
    return downloadCatalogBytes(new URL(entry.artifact.file, catalog.artifactBaseUrl).href,
      entry.artifact.size, this.config.timeoutMs, signal)
  }
}
