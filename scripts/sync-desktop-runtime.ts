/** Derive the desktop deployment's explicit workspace dependencies from its three application roots. */

import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { load } from 'js-yaml'

interface Manifest {
  name: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

const DESKTOP_ROOTS = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-desktop-native',
  '@deepseek-ai/dsh-web-frontend',
] as const

/**
 * Resolve required peer edges as well as production dependencies, excluding development-only packages.
 * Optional-only paths remain optional; any required path promotes the package and its required descendants.
 * @param manifests - workspace manifests discovered by the package-manager workspace patterns.
 * @param roots - entry packages that the desktop launches or mounts directly.
 * @returns sorted required and optional workspace declarations for the desktop deploy manifest.
 * @throws when a root, required workspace edge, or unique package name cannot be resolved.
 */
export function desktopRuntimeDependencies(
  manifests: readonly Manifest[],
  roots: readonly string[] = DESKTOP_ROOTS,
): { dependencies: Record<string, string>; optionalDependencies: Record<string, string> } {
  const workspace = new Map<string, Manifest>()
  for (const manifest of manifests) {
    if (workspace.has(manifest.name)) throw new Error(`desktop runtime: duplicate workspace package ${manifest.name}`)
    workspace.set(manifest.name, manifest)
  }
  if (roots.length === 0) throw new Error('desktop runtime: at least one application root is required')
  const requiredByName = new Map<string, boolean>()
  const queue = roots.map(name => ({ name, required: true }))
  for (const { name, required } of queue) {
    const previous = requiredByName.get(name)
    if (previous === true || previous === required) continue
    const manifest = workspace.get(name)
    if (manifest === undefined) throw new Error(`desktop runtime: missing workspace package ${name}`)
    requiredByName.set(name, required)
    const requiredPeers = Object.fromEntries(Object.entries(manifest.peerDependencies ?? {})
      .filter(([peer]) => manifest.peerDependenciesMeta?.[peer]?.optional !== true))
    const edges = { ...requiredPeers, ...manifest.dependencies, ...manifest.optionalDependencies }
    for (const [dependency, range] of Object.entries(edges)) {
      if (workspace.has(dependency)) {
        queue.push({
          name: dependency,
          required: required && manifest.optionalDependencies?.[dependency] === undefined,
        })
      }
      else if (range.startsWith('workspace:')) {
        throw new Error(`desktop runtime: ${name} requires missing workspace package ${dependency}`)
      }
    }
  }
  const declarations = (required: boolean): Record<string, string> => Object.fromEntries(
    [...requiredByName].filter(([, value]) => value === required)
      .map(([name]) => name).sort().map(name => [name, 'workspace:^']),
  )
  return { dependencies: declarations(true), optionalDependencies: declarations(false) }
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..')
  const { values } = parseArgs({ options: { write: { type: 'boolean', default: false } } })
  const workspace = load(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')) as { packages: string[] }
  const paths = globSync(workspace.packages.map(pattern => `${pattern}/package.json`), { cwd: root }).sort()
  const manifests = paths.map(path => JSON.parse(readFileSync(resolve(root, path), 'utf8')) as Manifest)
  const path = resolve(root, 'apps/desktop-runtime/package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest
  const declarations = desktopRuntimeDependencies(manifests)
  if (values.write) {
    writeFileSync(path, `${JSON.stringify({ ...manifest, ...declarations }, null, 2)}\n`)
  } else if (JSON.stringify(manifest.dependencies) !== JSON.stringify(declarations.dependencies)
    || JSON.stringify(manifest.optionalDependencies ?? {}) !== JSON.stringify(declarations.optionalDependencies)) {
    throw new Error('desktop runtime: dependency manifest is stale; run pnpm run desktop:sync, then pnpm install')
  }
  console.log(`desktop runtime: ${Object.keys(declarations.dependencies).length} required and ${Object.keys(declarations.optionalDependencies).length} optional workspace dependencies ${values.write ? 'recorded' : 'verified'}`)
}
