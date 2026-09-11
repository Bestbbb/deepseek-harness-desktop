/** Package the desktop-owned pnpm executable beside the bundled Node runtime. */

import { chmod, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const requireDesktop = createRequire(new URL('../package.json', import.meta.url))

/**
 * Copy the pinned pnpm distribution and write relocatable launchers.
 * The caller owns a freshly prepared output; no user installation is modified.
 * @param {string} output - generated desktop runtime directory.
 * @returns {Promise<string>} packaged pnpm version.
 */
export async function preparePackageManager(output) {
  const source = dirname(requireDesktop.resolve('pnpm'))
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  const desktop = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  if (manifest.version !== desktop.devDependencies.pnpm) {
    throw new Error('Desktop pnpm version does not match its pinned dependency; run pnpm install')
  }
  await cp(source, join(output, 'tools/pnpm'), { recursive: true, dereference: true, errorOnExist: true, force: false })
  const bin = join(output, 'node')
  await mkdir(bin, { recursive: true })
  const launcher = join(bin, 'pnpm')
  await writeFile(launcher, '#!/bin/sh\nexec "${0%/*}/node" "${0%/*}/../tools/pnpm/bin/pnpm.mjs" "$@"\n', { flag: 'wx' })
  await chmod(launcher, 0o755)
  await writeFile(join(bin, 'pnpm.cmd'), '@"%~dp0node.exe" "%~dp0..\\tools\\pnpm\\bin\\pnpm.mjs" %*\r\n', { flag: 'wx' })
  return manifest.version
}
