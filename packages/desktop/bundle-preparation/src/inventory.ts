/** Read Profile Bundle metadata with the same package precedence as the Harness launcher. */
import { realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { z } from 'zod'
import { resolveBundleDir, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import type { DesktopProfileName } from '@deepseek-ai/dsh-desktop'
import { boundedFile } from './files.ts'
import type { CompositionConfig, ProfileBundle } from './types.ts'

const manifestSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).optional(),
  dsh: z.looseObject({ profile: z.looseObject({
    bundles: z.array(z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/)).optional(),
  }).optional() }).optional(),
})
const bundleSchema = z.looseObject({
  version: z.string().min(1),
  dsh: z.looseObject({ bundle: z.looseObject({ patch: z.string().min(1) }) }),
})
const decode = (bytes: Buffer): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))

/**
 * Reject a changed Bundle version or an install target that is already listed.
 * @param config - trusted Profile location and inventory limits.
 * @param maxManifestBytes - per-manifest byte limit.
 * @param profile - observed native-selected Profile.
 * @param packageName - reviewed Bundle package name.
 * @param version - exact observed version, or null only when the Bundle was absent.
 * @returns Nothing when the fresh inventory agrees; unreadable listed versions never imply absence.
 */
export async function assertBundleVersion(
  config: CompositionConfig, maxManifestBytes: number, profile: DesktopProfileName, packageName: string, version: string | null,
): Promise<void> {
  const target = (await readProfileBundles(config, maxManifestBytes, profile)).find(bundle => bundle.packageName === packageName)
  if (version === null ? target !== undefined : target?.version !== version) {
    throw new Error('bundle preparation: observed Bundle version changed; refresh before installation')
  }
}

/**
 * Read listed Bundle versions without loading package code, creating Profiles or changing files.
 * Missing or invalid package metadata yields a null version; an invalid or changing Profile rejects the read.
 * @param config - deployment-owned home, launcher path and complete read limits.
 * @param maxManifestBytes - maximum bytes in any individual manifest.
 * @param profile - native-selected Profile identity.
 * @returns Ordered Bundle metadata, not live plugin health or a verified artifact identity.
 */
export async function readProfileBundles(
  config: CompositionConfig, maxManifestBytes: number, profile: DesktopProfileName,
): Promise<readonly ProfileBundle[]> {
  const directory = resolveProfileDir(profile, config.harnessHome)
  const manifestPath = join(directory, 'package.json')
  const before = await boundedFile(manifestPath, maxManifestBytes)
  const manifest = manifestSchema.parse(decode(before))
  const names = manifest.dsh?.profile?.bundles ?? []
  if (names.length > config.maxProfileEntries || new Set(names).size !== names.length) {
    throw new Error('bundle inventory: duplicate or excessive Profile layers')
  }
  let bytes = before.length
  const profileRoot = await realpath(directory)
  const bundles: ProfileBundle[] = []
  for (const packageName of names) {
    let version: string | null = null
    let removable = false
    try {
      const resolved = resolveBundleDir('bundle inventory', packageName, config.dshEntry, directory)
      const content = await boundedFile(join(resolved, 'package.json'), maxManifestBytes)
      bytes += content.length
      version = bundleSchema.parse(decode(content)).version
      const location = relative(profileRoot, await realpath(resolved))
      removable = Object.hasOwn(manifest.dependencies ?? {}, packageName)
        && location !== '' && location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location)
    } catch {
      // Resolution, file and metadata failures leave this listed package explicitly unconfirmed.
    }
    if (bytes > config.maxProfileBytes) throw new Error('bundle inventory: manifests exceed the complete read limit')
    bundles.push({ packageName, version, removable })
  }
  if (bytes > config.maxProfileBytes) throw new Error('bundle inventory: manifests exceed the complete read limit')
  if (!before.equals(await boundedFile(manifestPath, maxManifestBytes))) {
    throw new Error('bundle inventory: Profile changed during the read')
  }
  return bundles
}
