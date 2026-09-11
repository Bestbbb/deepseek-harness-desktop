/** Cordis-owned verification and staging of reviewed local Bundle tarballs. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { parseCatalog } from './catalog.ts'
import { boundedFile } from './files.ts'
import { inspectArchive } from './archive.ts'
import { installCandidate } from './installer.ts'
import { prepareComposition, prepareRemoval } from './composition.ts'
import { assertBundleVersion, readProfileBundles } from './inventory.ts'
import { PreparationJournal } from './journal.ts'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { DesktopProfileCandidate, DesktopProfileName } from '@deepseek-ai/dsh-desktop'
import type { BundleCandidate, BundleCatalogId, BundleOperationId, Config, InstallerConfig, PreparationKind, PreparationOperation, PreparedBundle, PreparedDependencies, PreparedComposition, PreparedRemoval, ProfileBundle, ReviewedBundle } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Reviewed Bundle preparation and explicit native next-launch queueing. */
    bundlePreparation: BundlePreparation
  }
}

/** Verify catalog compatibility and stage reviewed bytes without importing package code. */
export class BundlePreparation extends Service {
  static Config: Schema<Config> = Schema.object({
    catalogFile: Schema.string().required(),
    artifactDirectory: Schema.string().required(),
    stagingDirectory: Schema.string().required(),
    hostVersion: Schema.string().required(),
    maxCatalogBytes: Schema.number().min(1).max(16 * 1024 * 1024).step(1).default(1024 * 1024),
    maxArtifactBytes: Schema.number().min(1).max(256 * 1024 * 1024).step(1).default(50 * 1024 * 1024),
    installer: Schema.union([Schema.const(false), Schema.object({
      nodeExecutable: Schema.string().required(),
      packageManagerEntry: Schema.string().required(),
      packageManagerVersion: Schema.string().required(),
      timeoutMs: Schema.number().min(1).max(2_147_483_647).step(1).required(),
      graceMs: Schema.number().min(1).max(2_147_483_647).step(1).required(),
      maxOutputBytes: Schema.number().min(1).max(1024 * 1024).step(1).required(),
      maxExpandedBytes: Schema.number().min(1).max(512 * 1024 * 1024).step(1).required(),
      maxArchiveEntries: Schema.number().min(1).max(1_000_000).step(1).required(),
      maxManifestBytes: Schema.number().min(1).max(16 * 1024 * 1024).step(1).required(),
    })]).default(false),
    composition: Schema.union([Schema.const(false), Schema.object({
      harnessHome: Schema.string().required(),
      profileName: Schema.string().pattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u).required(),
      dshEntry: Schema.string().required(),
      maxProfileBytes: Schema.number().min(1).max(2_147_483_647).step(1).required(),
      maxProfileEntries: Schema.number().min(1).max(1_000_000).step(1).required(),
    })]).default(false),
    journal: Schema.union([Schema.const(false), Schema.object({
      directory: Schema.string().required(),
      maxEntries: Schema.number().min(1).max(100_000).step(1).required(),
      maxRecordBytes: Schema.number().min(1).max(16 * 1024 * 1024).step(1).required(),
    })]).default(false),
  })

  private catalog: readonly ReviewedBundle[] = []
  private pending: {
    id: BundleOperationId
    done: Promise<PreparedBundle | PreparedDependencies | PreparedComposition | PreparedRemoval>
    abort: AbortController
  } | undefined
  private readonly journal: PreparationJournal | undefined
  private closed = false
  private readonly platform = `${process.platform}-${process.arch}`
  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'bundlePreparation')
    this.config = config
    this.journal = config.journal ? new PreparationJournal(config.journal, config.stagingDirectory) : undefined
    for (const path of [config.catalogFile, config.artifactDirectory, config.stagingDirectory]) {
      if (!isAbsolute(path)) throw new Error('bundle preparation: deployment paths must be absolute')
    }
    if (config.installer && (!isAbsolute(config.installer.nodeExecutable) || !isAbsolute(config.installer.packageManagerEntry))) {
      throw new Error('bundle preparation: installer executables must be absolute')
    }
    if (config.composition && (!config.installer || !isAbsolute(config.composition.harnessHome)
      || !isAbsolute(config.composition.dshEntry) || config.composition.profileName === 'node_modules')) {
      throw new Error('bundle preparation: composition requires an installer, absolute paths and a valid source Profile')
    }
    if (config.journal) {
      if (!isAbsolute(config.journal.directory)) throw new Error('bundle preparation: journal directory must be absolute')
      const roots = [config.stagingDirectory, ...config.composition ? [join(config.composition.harnessHome, 'profiles', config.composition.profileName)] : []]
      for (const root of roots) {
        const paths = [relative(root, config.journal.directory), relative(config.journal.directory, root)]
        if (paths.some(path => path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))) {
          throw new Error('bundle preparation: journal, staging and source Profile must not overlap')
        }
      }
    }
    ctx.effect(() => async () => {
      this.closed = true
      this.pending?.abort.abort(new Error('bundle preparation: service is disposed'))
      // Operation errors belong to the caller; disposal still waits for file cleanup.
      await this.pending?.done.catch(() => {})
    }, 'bundlePreparation.drain')
  }

  protected async [Service.init](): Promise<void> {
    this.catalog = parseCatalog(await boundedFile(this.config.catalogFile, this.config.maxCatalogBytes))
  }

  /**
   * List review records and every declared compatibility mismatch; performs no artifact I/O.
   * @returns Catalog-order candidates, not installation or runtime status.
   */
  list(): readonly BundleCandidate[] {
    return this.catalog.map(entry => ({ entry, issues: [
      ...entry.harnessVersions.includes(this.config.hostVersion) ? [] : ['harness-version' as const],
      ...entry.platforms.includes(this.platform) ? [] : ['platform' as const],
      ...entry.artifact.size <= this.config.maxArtifactBytes ? [] : ['artifact-size' as const],
    ] }))
  }

  /**
   * Read persisted attempt metadata without loading plugins or granting activation authority.
   * Unsettled records may belong to another live process; no automatic cleanup or retry occurs.
   * @returns Bounded history with altered receipts and unreadable records explicitly marked.
   */
  async listOperations(): Promise<readonly PreparationOperation[]> {
    this.ensureOpen()
    if (this.journal === undefined) throw new Error('bundle preparation: operation history is not configured')
    return this.journal.list(this.pending?.id)
  }

  /**
   * Read the selected Profile's ordered Bundle versions without importing code or changing files.
   * @param profile - identity supplied by the native selection owner, never a browser-supplied path.
   * @returns Manifest observations with null versions for unreadable packages, not runtime health.
   */
  async profileBundles(profile: DesktopProfileName): Promise<readonly ProfileBundle[]> {
    this.ensureOpen()
    if (!this.config.composition || !this.config.installer) throw new Error('bundle inventory: composition is not configured')
    return readProfileBundles(this.config.composition, this.config.installer.maxManifestBytes, profile)
  }

  /**
   * Stage a catalog-selected tarball in an exclusively created operation directory.
   * Rejects unknown/incompatible entries, overlapping operations, symlinks and mismatched bytes.
   * This does not resolve dependencies, inspect archive contents, install, or activate the Bundle.
   * @param id - identity obtained from the current catalog.
   * Recording failures can retain a completed candidate; receipts never grant activation authority.
   * @returns Receipt after preparation and optional history publication complete.
   */
  async prepare(id: BundleCatalogId): Promise<PreparedBundle> {
    return this.execute(id, 'artifact', entry => this.stage(entry))
  }

  /**
   * Prepare an offline candidate using bundled pnpm and a local subprocess provider.
   * Missing dependencies fail; scripts, hooks and automatic peer installation are disabled.
   * This creates no Profile and performs no activation. Preparation failures remove this operation's directory.
   * A subsequent history-publication failure can retain the completed candidate.
   * @param id - identity from the current catalog, never a caller-supplied receipt or file path.
   * @returns An installed candidate requiring separate composition and activation validation.
   */
  async prepareDependencies(id: BundleCatalogId): Promise<PreparedDependencies> {
    return this.prepareInstalled(id, 'dependencies', candidate => Promise.resolve(candidate))
  }

  /**
   * Build a private copy of the configured Profile and check its Bundle patches with dsh --dump-config.
   * Does not boot plugins, evaluate configuration expressions, switch Profiles or restart the app.
   * A history-publication failure can retain the completed candidate without authorizing activation.
   * @param id - identity selected from the current catalog.
   * @returns A composition receipt after source-configuration checks and boot-free validation.
   */
  async prepareComposition(id: BundleCatalogId): Promise<PreparedComposition> {
    const composition = this.config.composition
    if (!composition) throw new Error('bundle preparation: Profile composition is not configured')
    return this.prepareInstalled(id, 'composition', (candidate, subprocess, installer, signal) =>
      prepareComposition(subprocess, installer, composition, candidate, signal))
  }

  /**
   * Prepare a fresh Profile in the desktop home and queue it for the next full application launch.
   * Does not restart the runtime. After dispatch, transport failures retain all candidate files;
   * native selection must be inspected before retry or cleanup. History describes preparation only.
   * @param id - identity selected from the current reviewed catalog.
   * @param profile - native-selected Profile observed during confirmation.
   * @param version - observed installed version, or null only when the Bundle was absent.
   * @returns Candidate identity after native queue acknowledgement, not a running-plugin claim.
   */
  async queueActivation(id: BundleCatalogId, profile: DesktopProfileName, version: string | null): Promise<DesktopProfileCandidate> {
    const composition = this.config.composition
    if (!composition) throw new Error('bundle preparation: Profile composition is not configured')
    const desktop = this.ctx.get('desktop')
    if (desktop === undefined) throw new Error('bundle preparation: activation requires a native desktop host')
    const destination = `desktop-${randomUUID()}` as DesktopProfileName
    let queued!: DesktopProfileCandidate
    await this.prepareInstalled(id, 'composition', async (candidate, subprocess, installer, signal) => {
      const selection = await desktop.profileSelection()
      signal.throwIfAborted()
      if (selection.pending !== null || selection.trial !== null) {
        throw new Error('bundle preparation: another Profile is pending or starting')
      }
      if (selection.activeProfile !== profile) throw new Error('bundle preparation: observed active Profile changed')
      if (version === candidate.prepared.entry.version) throw new Error('bundle preparation: reviewed Bundle version is already selected')
      return prepareComposition(subprocess, installer, { ...composition, profileName: profile },
        candidate, signal, destination, version)
    }, async (result, signal, installer) => {
      signal.throwIfAborted()
      this.ensureOpen()
      await assertBundleVersion(composition, installer.maxManifestBytes, profile, result.candidate.prepared.entry.packageName, version)
      queued = { profile: destination, previousProfile: profile,
        manifestSha256: createHash('sha256').update(await boundedFile(join(result.profileDirectory, 'package.json'), installer.maxManifestBytes)).digest('hex') }
      signal.throwIfAborted()
      // Queue transport can commit before its reply is lost; prepared files must outlive rejection.
      await desktop.queueProfile(queued)
    })
    return queued
  }

  /**
   * Remove an observed Profile-owned Bundle in a fresh composition and queue the next full launch.
   * Refuses stale selection, changed versions, built-in packages and overlapping operations.
   * Original configuration, packages and Session data remain intact; unknown queue outcomes retain candidates.
   * @param profile - active Profile observed by the caller, checked against native selection.
   * @param packageName - listed package name, never a path or catalog identity.
   * @param version - exact observed version to remove.
   * @returns Native queue acknowledgement; removal is not active until a successful application restart.
   */
  async queueRemoval(profile: DesktopProfileName, packageName: string, version: string): Promise<DesktopProfileCandidate> {
    const composition = this.config.composition
    const installer = this.config.installer
    if (!composition || !installer) throw new Error('bundle preparation: removal requires configured composition and installer')
    const desktop = this.ctx.get('desktop')
    const subprocess = this.ctx.get('subprocess')
    if (desktop === undefined || subprocess === undefined) throw new Error('bundle preparation: removal requires desktop and local subprocess providers')
    const destination = `desktop-${randomUUID()}` as DesktopProfileName
    const removed = { packageName, version }
    let queued!: DesktopProfileCandidate
    await this.reserve(async (operationId, signal) => {
      const run = async (): Promise<PreparedRemoval> => {
        const deadline = new AbortController()
        const timer = setTimeout(() => { deadline.abort(new Error('bundle preparation: removal timed out')) }, installer.timeoutMs)
        const cancellation = AbortSignal.any([signal, deadline.signal])
        let root: string | undefined
        let result: PreparedRemoval | undefined
        try {
          const selection = await desktop.profileSelection()
          cancellation.throwIfAborted()
          if (selection.activeProfile !== profile || selection.pending !== null || selection.trial !== null) {
            throw new Error('bundle preparation: removal selection changed or another Profile is pending')
          }
          await mkdir(this.config.stagingDirectory, { recursive: true, mode: 0o700 })
          root = await mkdtemp(join(this.config.stagingDirectory, 'bundle-'))
          result = await prepareRemoval(subprocess, installer, { ...composition, profileName: profile }, root,
            removed, this.config.hostVersion, cancellation, destination)
          await writeFile(result.receiptPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
          cancellation.throwIfAborted()
          this.ensureOpen()
          return result
        } catch (error) {
          if (result !== undefined) await rm(result.profileDirectory, { recursive: true, force: true })
          if (root !== undefined) await rm(root, { recursive: true, force: true })
          throw error
        } finally { clearTimeout(timer) }
      }
      return this.journal === undefined ? run() : this.journal.runRemoval(operationId, removed, run)
    }, async (result, signal) => {
      signal.throwIfAborted()
      this.ensureOpen()
      queued = { profile: destination, previousProfile: profile,
        manifestSha256: createHash('sha256').update(await boundedFile(join(result.profileDirectory, 'package.json'), installer.maxManifestBytes)).digest('hex') }
      signal.throwIfAborted()
      // Native persistence may succeed even when its acknowledgement is lost.
      await desktop.queueProfile(queued)
    })
    return queued
  }

  private async prepareInstalled<T extends PreparedDependencies | PreparedComposition>(
    id: BundleCatalogId, kind: Exclude<PreparationKind, 'removal'>,
    finish: (candidate: PreparedDependencies, subprocess: SubprocessRuntime, installer: InstallerConfig, signal: AbortSignal) => Promise<T>,
    afterPrepared?: (result: T, signal: AbortSignal, installer: InstallerConfig) => Promise<void>,
  ): Promise<T> {
    const installer = this.config.installer
    if (!installer) throw new Error('bundle preparation: dependency preparation is not configured')
    const subprocess = this.ctx.get('subprocess')
    if (subprocess === undefined) throw new Error('bundle preparation: dependency preparation requires a local subprocess provider')
    return this.execute(id, kind, async (entry, signal) => {
      const deadline = new AbortController()
      const timer = setTimeout(() => { deadline.abort(new Error('bundle preparation: dependency preparation timed out')) }, installer.timeoutMs)
      const cancellation = AbortSignal.any([signal, deadline.signal])
      let prepared: PreparedBundle | undefined
      let completedProfile: string | undefined
      try {
        cancellation.throwIfAborted()
        prepared = await this.stage(entry)
        await inspectArchive(await boundedFile(prepared.artifactPath, entry.artifact.size), entry, installer)
        const candidate = await installCandidate(subprocess, installer, prepared, cancellation)
        await writeFile(candidate.receiptPath, `${JSON.stringify(candidate, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
        const result = await finish(candidate, subprocess, installer, cancellation)
        if ('profileDirectory' in result) completedProfile = result.profileDirectory
        if (result !== candidate) await writeFile(result.receiptPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
        cancellation.throwIfAborted()
        this.ensureOpen()
        return result
      } catch (error) {
        if (completedProfile !== undefined) await rm(completedProfile, { recursive: true, force: true })
        if (prepared !== undefined) await rm(dirname(prepared.artifactPath), { recursive: true, force: true })
        throw error
      } finally { clearTimeout(timer) }
    }, afterPrepared === undefined ? undefined : (result, signal) => afterPrepared(result, signal, installer))
  }

  private async execute<T extends PreparedBundle | PreparedDependencies | PreparedComposition>(
    id: BundleCatalogId, kind: Exclude<PreparationKind, 'removal'>, run: (entry: ReviewedBundle, signal: AbortSignal) => Promise<T>,
    afterPrepared?: (result: T, signal: AbortSignal) => Promise<void>,
  ): Promise<T> {
    this.ensureOpen()
    if (this.pending !== undefined) throw new Error('bundle preparation: another preparation is in progress')
    const candidate = this.list().find(item => item.entry.id === id)
    if (candidate === undefined) throw new Error('bundle preparation: unknown catalog entry')
    if (candidate.issues.length > 0) throw new Error(`bundle preparation: incompatible: ${candidate.issues.join(', ')}`)
    return this.reserve((operationId, signal) => this.journal === undefined ? run(candidate.entry, signal)
      : this.journal.run(operationId, kind, candidate.entry, () => run(candidate.entry, signal)), afterPrepared)
  }

  /** One reservation owns preparation, optional native dispatch, cancellation and disposal drainage. */
  private async reserve<T extends PreparedBundle | PreparedDependencies | PreparedComposition | PreparedRemoval>(
    run: (id: BundleOperationId, signal: AbortSignal) => Promise<T>,
    afterPrepared?: (result: T, signal: AbortSignal) => Promise<void>,
  ): Promise<T> {
    this.ensureOpen()
    if (this.pending !== undefined) throw new Error('bundle preparation: another preparation is in progress')
    const abort = new AbortController()
    const operationId = randomUUID() as BundleOperationId
    const preparation = run(operationId, abort.signal)
    const pending = afterPrepared === undefined ? preparation : preparation.then(async (result) => {
      await afterPrepared(result, abort.signal)
      return result
    })
    this.pending = { id: operationId, done: pending, abort }
    try {
      return await pending
    } finally {
      this.pending = undefined
    }
  }

  private async stage(entry: ReviewedBundle): Promise<PreparedBundle> {
    const bytes = await boundedFile(join(this.config.artifactDirectory, entry.artifact.file), entry.artifact.size)
    if (bytes.length !== entry.artifact.size || createHash('sha256').update(bytes).digest('hex') !== entry.artifact.sha256) {
      throw new Error('bundle preparation: artifact size or SHA-256 does not match the reviewed catalog')
    }
    this.ensureOpen()
    await mkdir(this.config.stagingDirectory, { recursive: true, mode: 0o700 })
    const directory = await mkdtemp(join(this.config.stagingDirectory, 'bundle-'))
    try {
      const artifactPath = join(directory, entry.artifact.file)
      const receiptPath = join(directory, 'prepared.json')
      await writeFile(artifactPath, bytes, { flag: 'wx', mode: 0o600 })
      const receipt: PreparedBundle = {
        schemaVersion: 1, state: 'prepared-not-enabled', entry,
        hostVersion: this.config.hostVersion, platform: this.platform, artifactPath, receiptPath,
      }
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
      this.ensureOpen()
      return receipt
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('bundle preparation: service is disposed')
  }
}

export default BundlePreparation
