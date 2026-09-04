/** Restrict destructive preparation to an empty or previously generated runtime directory. */

import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const markerName = '.dsh-desktop-runtime'
const marker = 'Harness Desktop generated runtime v1\n'

async function physicalPath(path) {
  try {
    return await realpath(path)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return join(await physicalPath(parent), relative(parent, path))
  }
}

async function ownsRuntime(directory) {
  try {
    if (await readFile(join(directory, markerName), 'utf8') === marker) return true
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  // Completed pre-marker bundles identify both the runtime and its deployment root.
  try {
    const manifest = JSON.parse(await readFile(join(directory, 'runtime-manifest.json'), 'utf8'))
    const app = JSON.parse(await readFile(join(directory, 'app/package.json'), 'utf8'))
    return app.name === '@deepseek-ai/dsh-desktop-runtime'
      && ['harnessVersion', 'nodeVersion', 'platform', 'arch'].every(key => typeof manifest[key] === 'string')
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return false
    throw error
  }
}

/**
 * Replace a generated directory without accepting a repository, home, or their ancestors.
 * @param {string} output - requested runtime output directory.
 * @param {string[]} protectedRoots - repository and user-home directories that must survive.
 * @returns {Promise<void>} resolves after a marked output directory is ready.
 */
export async function prepareRuntimeOutput(output, protectedRoots) {
  const requested = resolve(output)
  const physical = await physicalPath(requested)
  if (dirname(physical) === physical) throw new Error('Desktop runtime output cannot be a filesystem root')
  for (const root of protectedRoots) {
    const inside = relative(physical, await physicalPath(resolve(root)))
    if (inside === '' || (!isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`))) {
      throw new Error('Desktop runtime output cannot contain the repository or user home')
    }
  }
  let existing
  try {
    existing = await lstat(requested)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error('Desktop runtime output must be a real directory, not a file or link')
    }
    if ((await readdir(requested)).length > 0 && !await ownsRuntime(requested)) {
      throw new Error('Refusing to replace a nonempty directory not owned by Harness Desktop; choose an empty output directory')
    }
    await rm(requested, { recursive: true, force: true })
  }
  await mkdir(requested, { recursive: true })
  await writeFile(join(requested, markerName), marker, { flag: 'wx' })
}
