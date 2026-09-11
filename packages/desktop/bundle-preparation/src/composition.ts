/** Build a private Profile and validate its patch composition through the normal dsh launcher. */
import { constants } from 'node:fs'
import { cp, lstat, mkdir, realpath, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { resolveBundleDir } from '@deepseek-ai/dsh-app-boot'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { DesktopProfileName } from '@deepseek-ai/dsh-desktop'
import { boundedFile } from './files.ts'
import { installerEnvironment, runManaged } from './installer.ts'
import { assertBundleVersion, readProfileBundles } from './inventory.ts'
import type { CompositionConfig, InstallerConfig, PreparedComposition, PreparedDependencies, PreparedRemoval } from './types.ts'

const profileSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).optional(),
  dsh: z.looseObject({ profile: z.looseObject({ bundles: z.array(z.string()).optional() }).optional() }).optional(),
})

/** Paths beneath one directory, including the directory itself. */
function contains(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

/** Read an optional configuration file without accepting links or special files. */
async function optionalFile(path: string, maxBytes: number): Promise<Buffer | undefined> {
  try { await lstat(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  return boundedFile(path, maxBytes)
}

/**
 * Copy a deployment-selected Profile, overlay the prepared Bundle, and run boot-free composition validation.
 * Rejects candidates shadowed by an installation-owned Bundle under the upstream resolver.
 * The caller owns cancellation and removes the operation directory on any failure.
 * @param subprocess - local managed-process provider.
 * @param installer - executable paths and whole-operation budgets.
 * @param config - trusted source Profile and copy budgets.
 * @param candidate - freshly installed candidate, never a persisted caller-supplied receipt.
 * @param signal - operation cancellation and deadline.
 * @param destination - generated native Profile name for preparation in the original home; omitted for private validation.
 * @param expectedVersion - observed source version, null for absence; omitted only for standalone validation.
 * @returns A composition-checked Profile, not an activation or plugin health result.
 */
export async function prepareComposition(
  subprocess: SubprocessRuntime, installer: InstallerConfig, config: CompositionConfig,
  candidate: PreparedDependencies, signal: AbortSignal, destination?: DesktopProfileName, expectedVersion?: string | null,
): Promise<PreparedComposition> {
  const result = await compose(subprocess, installer, config, { kind: 'install', candidate, expectedVersion }, signal, destination)
  return { ...result, state: 'composition-checked-not-enabled', candidate }
}

/**
 * Remove a direct Profile-owned Bundle only in a private copy, then validate its remaining patches.
 * The caller owns the operation root and removes it on failure; original files are never deleted.
 * @param subprocess - local managed-process provider.
 * @param installer - trusted executable paths and operation limits.
 * @param config - selected source Profile and copy budgets.
 * @param root - exclusively created staging directory.
 * @param removed - observed package name and exact version, checked again before mutation.
 * @param hostVersion - deployment-owned Harness version.
 * @param signal - operation cancellation and deadline.
 * @param destination - generated next-launch Profile identity.
 * @returns A validated removal candidate, not runtime activation or data cleanup.
 */
export async function prepareRemoval(
  subprocess: SubprocessRuntime, installer: InstallerConfig, config: CompositionConfig,
  root: string, removed: PreparedRemoval['removed'], hostVersion: string, signal: AbortSignal, destination: DesktopProfileName,
): Promise<PreparedRemoval> {
  const result = await compose(subprocess, installer, config, { kind: 'remove', root, removed, hostVersion }, signal, destination)
  return { ...result, state: 'removal-checked-not-enabled', removed }
}

/** Shared copy, source-change checks and launcher validation for installation and removal. */
async function compose(
  subprocess: SubprocessRuntime, installer: InstallerConfig, config: CompositionConfig,
  change: { kind: 'install'; candidate: PreparedDependencies; expectedVersion: string | null | undefined }
    | { kind: 'remove'; root: string; removed: PreparedRemoval['removed']; hostVersion: string },
  signal: AbortSignal, destination: DesktopProfileName | undefined,
): Promise<Omit<PreparedComposition, 'candidate' | 'state'>> {
  const root = change.kind === 'install' ? dirname(change.candidate.receiptPath) : change.root
  const packageName = change.kind === 'install' ? change.candidate.prepared.entry.packageName : change.removed.packageName
  if (change.kind === 'install' && change.expectedVersion !== undefined) {
    await assertBundleVersion(config, installer.maxManifestBytes,
      config.profileName as DesktopProfileName, packageName, change.expectedVersion)
  }
  if (change.kind === 'remove') {
    const layers = await readProfileBundles(config, installer.maxManifestBytes, config.profileName as DesktopProfileName)
    const target = layers.find(layer => layer.packageName === packageName)
    if (!target?.removable || target.version !== change.removed.version) {
      throw new Error('bundle preparation: removal requires the observed version of a Profile-owned Bundle')
    }
  }
  const source = await realpath(join(config.harnessHome, 'profiles', config.profileName))
  if (contains(source, await realpath(root))) throw new Error('bundle preparation: staging must be outside the source Profile')
  const homePatch = join(config.harnessHome, 'cordis.patch.yml')
  const sourceFiles = [join(source, 'package.json'), join(source, 'cordis.patch.yml'), homePatch]
  const inputs = await Promise.all(sourceFiles.map(path => optionalFile(path, installer.maxManifestBytes)))
  const manifest = profileSchema.parse(JSON.parse(inputs[0]?.toString('utf8') ?? 'null'))
  const harnessHome = destination === undefined ? join(root, 'composition-home') : config.harnessHome
  const profileName = destination ?? 'candidate'
  const profileDirectory = join(harnessHome, 'profiles', profileName)
  await mkdir(dirname(profileDirectory), { recursive: true, mode: 0o700 })
  if (!(await lstat(dirname(profileDirectory))).isDirectory()) throw new Error('bundle preparation: Profiles root must be a real directory')
  await mkdir(profileDirectory, { mode: 0o700 })
  try {
    let bytes = 0
    let entries = 0
    const copy = async (from: string, to: string): Promise<void> => {
      const sourceRoot = await realpath(from)
      const copiedFiles: { path: string; size: number }[] = []
      await cp(from, to, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
        filter: async (path, destination) => {
          signal.throwIfAborted()
          const info = await stat(path)
          if (!info.isFile() && !info.isDirectory()) throw new Error('bundle preparation: unsupported Profile file')
          bytes += info.isFile() ? info.size : 0
          if (++entries > config.maxProfileEntries || bytes > config.maxProfileBytes) {
            throw new Error('bundle preparation: Profile copy exceeds its limit')
          }
          if ((await lstat(path)).isSymbolicLink()) {
            const target = await realpath(path)
            await mkdir(dirname(destination), { recursive: true })
            if (contains(sourceRoot, target)) {
              const copiedTarget = join(to, relative(sourceRoot, target))
              await symlink(copiedTarget, destination, info.isDirectory() ? 'junction' : 'file')
            } else await copy(target, destination)
            return false
          }
          if (info.isFile()) copiedFiles.push({ path: destination, size: info.size })
          return true
        } })
      for (const file of copiedFiles) {
        signal.throwIfAborted()
        bytes += (await stat(file.path)).size - file.size
        if (bytes > config.maxProfileBytes) throw new Error('bundle preparation: Profile copy exceeds its limit')
      }
    }
    await copy(source, profileDirectory)
    if (change.kind === 'install' && change.expectedVersion !== undefined) {
      await assertBundleVersion({ ...config, harnessHome }, installer.maxManifestBytes,
        profileName as DesktopProfileName, packageName, change.expectedVersion)
    }
    if (change.kind === 'remove') {
      const layers = await readProfileBundles({ ...config, harnessHome }, installer.maxManifestBytes, profileName as DesktopProfileName)
      if (!layers.some(layer => layer.packageName === packageName && layer.removable && layer.version === change.removed.version)) {
        throw new Error('bundle preparation: removal target changed during the Profile copy')
      }
    }
    const installedPath = join(profileDirectory, 'node_modules', packageName)
    // Only the newly copied candidate is mutable; an old package may be a pnpm link.
    let previous
    try { previous = await lstat(installedPath) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (previous?.isSymbolicLink()) await unlink(installedPath)
    else if (previous !== undefined) await rm(installedPath, { recursive: true })
    let bundles = [...manifest.dsh?.profile?.bundles ?? []]
    let dependencies = { ...manifest.dependencies }
    if (change.kind === 'install') {
      await mkdir(dirname(installedPath), { recursive: true })
      await copy(change.candidate.packageDirectory, installedPath)
      if (!bundles.includes(packageName)) bundles.push(packageName)
      dependencies[packageName] = `file:${change.candidate.prepared.artifactPath}`
    } else {
      bundles = bundles.filter(name => name !== packageName)
      dependencies = Object.fromEntries(Object.entries(dependencies).filter(([name]) => name !== packageName))
    }
    const composed = { ...manifest, dependencies,
      dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles, patchReload: 'startup' } } }
    await writeFile(join(profileDirectory, 'package.json'), `${JSON.stringify(composed, null, 2)}\n`, { mode: 0o600 })
    if (change.kind === 'install') {
      const resolved = resolveBundleDir('bundle preparation', packageName, config.dshEntry, profileDirectory)
      if (await realpath(resolved) !== await realpath(installedPath)) {
        throw new Error('bundle preparation: an installation-owned Bundle shadows the reviewed candidate')
      }
    }
    if (destination === undefined && inputs[2] !== undefined) await writeFile(join(harnessHome, 'cordis.patch.yml'), inputs[2], { flag: 'wx', mode: 0o600 })
    const env = { ...installerEnvironment(join(root, 'installer-home'), installer.nodeExecutable),
      DSH_HOME: harnessHome, DSH_TELEMETRY_DISABLED: '1' }
    if (change.kind === 'remove') {
      const installerHome = join(root, 'installer-home')
      await mkdir(installerHome, { mode: 0o700 })
      await writeFile(join(installerHome, 'empty.npmrc'), '', { flag: 'wx', mode: 0o600 })
      await writeFile(join(installerHome, 'global.npmrc'), '', { flag: 'wx', mode: 0o600 })
      const version = await runManaged(subprocess, installer, [installer.packageManagerEntry, '--version'], profileDirectory, env, signal, 'package manager')
      if (version !== installer.packageManagerVersion) throw new Error('bundle preparation: package manager version mismatch')
    }
    const hostVersion = await runManaged(subprocess, installer, [config.dshEntry, '--version'],
      profileDirectory, env, signal, 'Harness version')
    if (hostVersion !== (change.kind === 'install' ? change.candidate.prepared.hostVersion : change.hostVersion)) {
      throw new Error('bundle preparation: Harness version mismatch')
    }
    await runManaged(subprocess, installer, [installer.packageManagerEntry, 'install', '--lockfile-only', '--offline',
      '--ignore-scripts', '--ignore-pnpmfile', '--ignore-workspace', '--config.auto-install-peers=false', '--reporter=silent'],
    profileDirectory, env, signal, 'Profile lockfile')
    const lockfilePath = join(profileDirectory, 'pnpm-lock.yaml')
    await boundedFile(lockfilePath, installer.maxManifestBytes)
    const dump = await runManaged(subprocess, installer, [config.dshEntry, '--profile', profileName, '--dump-config'],
      profileDirectory, env, signal, 'Profile composition')
    const after = await Promise.all(sourceFiles.map(path => optionalFile(path, installer.maxManifestBytes)))
    const changed = inputs.some((value, index) => value === undefined
      ? after[index] !== undefined : after[index] === undefined || !value.equals(after[index]))
    if (changed) {
      throw new Error('bundle preparation: source Profile configuration changed during preparation')
    }
    if (change.kind === 'install' && change.expectedVersion !== undefined) {
      await assertBundleVersion(config, installer.maxManifestBytes,
        config.profileName as DesktopProfileName, packageName, change.expectedVersion)
    }
    const dumpPath = join(root, 'composition.yml')
    await writeFile(dumpPath, dump, { flag: 'wx', mode: 0o600 })
    signal.throwIfAborted()
    const sourceFingerprint = createHash('sha256').update(JSON.stringify(inputs.map(value => value?.toString('base64')))).digest('hex')
    return { schemaVersion: 1, harnessHome, profileName, profileDirectory, sourceProfile: source, sourceFingerprint,
      dumpPath, lockfilePath, receiptPath: join(root, change.kind === 'install' ? 'composition.json' : 'removal.json') }
  } catch (error) {
    await rm(profileDirectory, { recursive: true, force: true })
    throw error
  }
}
