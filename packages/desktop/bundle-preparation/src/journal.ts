/** Per-attempt atomic metadata; unresolved records never imply that another process stopped. */
import { createHash } from 'node:crypto'
import { lstat, mkdir, opendir } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import { boundedFile } from './files.ts'
import type { BundleOperationId, JournalConfig, PreparationKind, PreparationOperation, PreparedBundle, PreparedComposition, PreparedDependencies, PreparedRemoval, ReviewedBundle, BundleCatalogId } from './types.ts'

type Prepared = PreparedBundle | PreparedDependencies | PreparedComposition | PreparedRemoval
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const beginFields = {
  schemaVersion: z.literal(1), id: z.string().regex(uuid),
  startedAt: z.iso.datetime(),
}
const beginSchema = z.discriminatedUnion('kind', [z.strictObject({
  ...beginFields, kind: z.enum(['artifact', 'dependencies', 'composition']),
  entry: z.strictObject({ id: z.string(), packageName: z.string(), version: z.string(), title: z.string() }),
}), z.strictObject({ ...beginFields, kind: z.literal('removal'),
  removed: z.strictObject({ packageName: z.string(), version: z.string() }),
})])
const terminalSchema = z.discriminatedUnion('state', [
  z.strictObject({ schemaVersion: z.literal(1), state: z.literal('failed') }),
  z.strictObject({ schemaVersion: z.literal(1), state: z.literal('prepared'),
    preparedState: z.enum(['prepared-not-enabled', 'dependencies-prepared-not-enabled', 'composition-checked-not-enabled', 'removal-checked-not-enabled']),
    directory: z.string().regex(/^bundle-[a-zA-Z0-9]{6}$/u),
    file: z.enum(['prepared.json', 'dependencies.json', 'composition.json', 'removal.json']), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
])
const outputs = {
  artifact: { state: 'prepared-not-enabled', file: 'prepared.json' },
  dependencies: { state: 'dependencies-prepared-not-enabled', file: 'dependencies.json' },
  composition: { state: 'composition-checked-not-enabled', file: 'composition.json' },
  removal: { state: 'removal-checked-not-enabled', file: 'removal.json' },
} as const

/** Own metadata publication and read-only observations for a deployment's preparation attempts. */
export class PreparationJournal {
  constructor(private readonly config: JournalConfig, private readonly stagingDirectory: string) {}

  /** Atomically publish bounded metadata; failures leave prior complete records intact. */
  private async write(path: string, value: unknown): Promise<void> {
    const text = `${JSON.stringify(value)}\n`
    if (Buffer.byteLength(text) > this.config.maxRecordBytes) throw new Error('bundle journal: record exceeds byte limit')
    await writeFileAtomic(path, text, { mode: 0o600, dirMode: 0o700 })
  }

  /**
   * Record one uniquely owned attempt before work and settle it only after work finishes.
   * Failure metadata contains no raw error, child output or configuration values.
   * @param id - freshly generated attempt identity.
   * @param kind - requested preparation stage.
   * @param entry - current reviewed catalog entry.
   * @param run - operation whose filesystem/process cleanup completes before rejection.
   * @returns The preparation result after its terminal metadata commits.
   */
  async run<T extends Prepared>(id: BundleOperationId, kind: Exclude<PreparationKind, 'removal'>, entry: ReviewedBundle, run: () => Promise<T>): Promise<T> {
    return this.record({ schemaVersion: 1, id, kind, startedAt: new Date().toISOString(),
      entry: { id: entry.id, packageName: entry.packageName, version: entry.version, title: entry.title } }, run)
  }

  /**
   * Record removal without inventing a reviewed artifact or catalog identity for installed code.
   * @param id - fresh operation identity.
   * @param removed - package and version observed in the source Profile.
   * @param run - owned preparation with cleanup on rejection.
   * @returns Removal receipt after terminal metadata publication, not activation authority.
   */
  async runRemoval(id: BundleOperationId, removed: PreparedRemoval['removed'], run: () => Promise<PreparedRemoval>): Promise<PreparedRemoval> {
    return this.record({ schemaVersion: 1, id, kind: 'removal', startedAt: new Date().toISOString(), removed }, run)
  }

  /** Persist operation-specific input metadata and independently settle its preparation receipt. */
  private async record<T extends Prepared>(begin: z.infer<typeof beginSchema>, run: () => Promise<T>): Promise<T> {
    const { id } = begin
    const directory = join(this.config.directory, `op-${id}`)
    await mkdir(this.config.directory, { recursive: true, mode: 0o700 })
    await mkdir(directory, { mode: 0o700 })
    await this.write(join(directory, 'begin.json'), begin)
    try {
      const result = await run()
      const bytes = await boundedFile(result.receiptPath, this.config.maxRecordBytes)
      const terminal = terminalSchema.parse({ schemaVersion: 1, state: 'prepared', preparedState: result.state,
        directory: relative(this.stagingDirectory, dirname(result.receiptPath)), file: basename(result.receiptPath),
        sha256: createHash('sha256').update(bytes).digest('hex') })
      await this.write(join(directory, 'result.json'), terminal)
      return result
    } catch (error) {
      try { await this.write(join(directory, 'result.json'), { schemaVersion: 1, state: 'failed' }) } catch (recordError) {
        throw new AggregateError([error, recordError], 'bundle journal: preparation or recording failed; inspect the unresolved operation')
      }
      throw error
    }
  }

  /** Read a record only when present; invalid or inaccessible data rejects. */
  private async read(path: string): Promise<unknown> {
    try { await lstat(path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedFile(path, this.config.maxRecordBytes)))
  }

  /** Inspect one record without exposing paths or turning its metadata into authority. */
  private async inspect(id: BundleOperationId, active: BundleOperationId | undefined): Promise<PreparationOperation> {
    const directory = join(this.config.directory, `op-${id}`)
    let begin: z.infer<typeof beginSchema>
    let terminal: z.infer<typeof terminalSchema> | undefined
    try {
      if (!(await lstat(directory)).isDirectory()) throw new Error('bundle journal: operation must be a directory')
      begin = beginSchema.parse(await this.read(join(directory, 'begin.json')))
      if (begin.id !== id) throw new Error('bundle journal: identity mismatch')
      const raw = await this.read(join(directory, 'result.json'))
      terminal = raw === undefined ? undefined : terminalSchema.parse(raw)
      if (terminal?.state === 'prepared' && (terminal.file !== outputs[begin.kind].file
        || terminal.preparedState !== outputs[begin.kind].state)) throw new Error('bundle journal: preparation kind mismatch')
    } catch {
      // Missing, malformed, linked or unreadable metadata remains visible but cannot be trusted.
      return { id, state: 'unreadable' }
    }
    const common = { id, kind: begin.kind, startedAt: begin.startedAt, ...begin.kind === 'removal'
      ? { removed: begin.removed } : { entry: { ...begin.entry, id: begin.entry.id as BundleCatalogId } } }
    if (terminal === undefined) return { ...common, state: id === active ? 'preparing' : 'unsettled' }
    if (terminal.state === 'failed') return { ...common, state: 'failed' }
    try {
      const prepared = join(this.stagingDirectory, terminal.directory)
      if (!(await lstat(prepared)).isDirectory()) throw new Error('bundle journal: preparation directory is unavailable')
      const bytes = await boundedFile(join(prepared, terminal.file), this.config.maxRecordBytes)
      if (createHash('sha256').update(bytes).digest('hex') !== terminal.sha256) throw new Error('bundle journal: receipt changed')
    } catch {
      // A missing or altered receipt is unavailable, not a reusable prepared candidate.
      return { ...common, state: 'unavailable' }
    }
    return { ...common, state: 'prepared', preparedState: terminal.preparedState }
  }

  /**
   * Read bounded operation history; only this service instance can identify its active attempt.
   * A prepared observation checks receipt bytes, not candidate code, runtime health or activation.
   * @param active - this instance's known in-flight identity, if any.
   * @returns Stable newest-first observations; unreadable records remain visible.
   */
  async list(active?: BundleOperationId): Promise<readonly PreparationOperation[]> {
    let directory
    try { directory = await opendir(this.config.directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const records: PreparationOperation[] = []
    for await (const entry of directory) {
      if (records.length >= this.config.maxEntries) throw new Error('bundle journal: history exceeds entry limit')
      const id = entry.name.slice(3)
      if (!entry.name.startsWith('op-') || !uuid.test(id)) throw new Error('bundle journal: unsupported history entry')
      records.push(await this.inspect(id as BundleOperationId, active))
    }
    return records.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '') || a.id.localeCompare(b.id))
  }
}
