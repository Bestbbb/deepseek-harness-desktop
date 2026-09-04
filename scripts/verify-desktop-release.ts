/** Reject desktop packages whose native, runtime, or release-tag versions disagree. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Check a nonempty set of desktop component versions against the application and optional tag.
 * @param versions - Version records, including the desktop application.
 * @param tag - Optional public desktop release tag.
 * @throws When a component or tag disagrees with the application version.
 */
export function verifyDesktopVersions(versions: Readonly<Record<string, string>>, tag?: string): void {
  const expected = versions['apps/desktop/package.json']
  if (expected === undefined || expected.length === 0) throw new Error('Desktop application version is missing')
  for (const [file, version] of Object.entries(versions)) {
    if (version !== expected) throw new Error(`${file}: desktop version must be ${expected}, received ${version}`)
  }
  if (tag !== undefined && tag !== `desktop-v${expected}`) {
    throw new Error(`Desktop tag must be desktop-v${expected}, received ${tag}`)
  }
}

function jsonVersion(root: string, path: string): string {
  const value: unknown = JSON.parse(readFileSync(resolve(root, path), 'utf8'))
  if (typeof value !== 'object' || value === null || !('version' in value) || typeof value.version !== 'string') {
    throw new Error(`${path}: missing string version`)
  }
  return value.version
}

/**
 * Read version-bearing package and native manifests and validate a release.
 * @param root - Repository root.
 * @param tag - Optional public desktop release tag.
 */
export function verifyDesktopRelease(root: string, tag?: string): void {
  const paths = [
    'apps/desktop/package.json',
    'apps/desktop-runtime/package.json',
    'packages/desktop/desktop/package.json',
    'packages/desktop/desktop-native/package.json',
    'apps/desktop/src-tauri/tauri.conf.json',
  ]
  const versions = Object.fromEntries(paths.map(path => [path, jsonVersion(root, path)]))
  const cargoPath = 'apps/desktop/src-tauri/Cargo.toml'
  const cargo = readFileSync(resolve(root, cargoPath), 'utf8')
  const section = cargo.match(/^\[package\]\r?\n([^]*?)(?=^\[|$(?![^]))/m)?.[1]
  const version = section?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1]
  if (version === undefined) throw new Error(`${cargoPath}: missing package version`)
  verifyDesktopVersions({ ...versions, [cargoPath]: version }, tag)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..')
  const tag = process.argv[2]
  verifyDesktopRelease(root, tag)
  console.log('Desktop application, runtime, native packages, and release tag are aligned.')
}
