/** Packaging never clears unowned paths, including paths redirected by directory links. */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const helper = pathToFileURL(resolve(import.meta.dirname, '../apps/desktop/scripts/runtime-output.mjs')).href
const roots: string[] = []

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-output-'))
  roots.push(root)
  return root
}

function prepare(output: string, protectedRoots: string[] = []): ReturnType<typeof spawnSync> {
  const script = `import { prepareRuntimeOutput } from ${JSON.stringify(helper)}; await prepareRuntimeOutput(${JSON.stringify(output)}, ${JSON.stringify(protectedRoots)})`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 })
  expect(child.error).toBeUndefined()
  expect(child.signal).toBeNull()
  return child
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 })
})

describe('desktop runtime output ownership', () => {
  it('initializes a missing output and permits replacing its own partial build', () => {
    const output = join(fixture(), 'nested/runtime')
    expect(prepare(output).status).toBe(0)
    writeFileSync(join(output, 'partial-build'), 'generated')
    expect(prepare(output).status).toBe(0)
    expect(existsSync(join(output, 'partial-build'))).toBe(false)
    expect(readFileSync(join(output, '.dsh-desktop-runtime'), 'utf8')).toContain('generated runtime v1')
  })

  it('accepts an empty directory and a completed legacy runtime', () => {
    const output = join(fixture(), 'runtime')
    mkdirSync(join(output, 'app'), { recursive: true })
    writeFileSync(join(output, 'app/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop-runtime' }))
    writeFileSync(join(output, 'runtime-manifest.json'), JSON.stringify({ harnessVersion: '1', nodeVersion: '22', platform: 'darwin', arch: 'arm64' }))
    expect(prepare(output).status).toBe(0)
    const empty = join(fixture(), 'empty')
    mkdirSync(empty)
    expect(prepare(empty).status).toBe(0)
  })

  it('preserves unowned files even when a runtime manifest exists', () => {
    const output = fixture()
    writeFileSync(join(output, 'keep'), 'user data')
    writeFileSync(join(output, 'runtime-manifest.json'), '{}')
    const result = prepare(output)
    expect(result.status).toBe(1)
    expect(String(result.stderr)).toContain('not owned by Harness Desktop')
    expect(readFileSync(join(output, 'keep'), 'utf8')).toBe('user data')
  })

  it('rejects a protected root and its ancestor even with a valid ownership marker', () => {
    const output = fixture()
    expect(prepare(output).status).toBe(0)
    const child = join(output, 'project')
    mkdirSync(child)
    writeFileSync(join(output, 'keep'), 'user data')
    expect(prepare(output, [output]).status).toBe(1)
    expect(prepare(output, [child]).status).toBe(1)
    expect(readFileSync(join(output, 'keep'), 'utf8')).toBe('user data')
  })

  it('rejects directory links and resolves aliases before checking protected roots', () => {
    const root = fixture()
    const target = join(root, 'target')
    expect(prepare(target).status).toBe(0)
    writeFileSync(join(target, 'keep'), 'user data')
    const alias = join(root, 'alias')
    symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(prepare(alias).status).toBe(1)
    const project = join(target, 'project')
    expect(prepare(project).status).toBe(0)
    expect(prepare(join(alias, 'project'), [project]).status).toBe(1)
    expect(readFileSync(join(target, 'keep'), 'utf8')).toBe('user data')
  })

  it('rejects a file without changing it', () => {
    const file = join(fixture(), 'file')
    writeFileSync(file, 'user data')
    expect(prepare(file).status).toBe(1)
    expect(readFileSync(file, 'utf8')).toBe('user data')
  })
})
