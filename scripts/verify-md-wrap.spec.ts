/** The documentation check retains system-prompt coverage through snapshot file symlinks. */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkMarkdownWrap } from './verify-md-wrap.ts'

const roots: string[] = []

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-md-wrap-'))
  roots.push(root)
  mkdirSync(join(root, 'snapshots/source'), { recursive: true })
  mkdirSync(join(root, 'snapshots/alias'), { recursive: true })
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Markdown wrap corpus', () => {
  it('rejects wrapped system prompts without admitting other expected-file extensions', () => {
    const root = fixture()
    writeFileSync(join(root, 'snapshots/source/system-prompt.expected.md'), 'First line\nsecond line\n')
    writeFileSync(join(root, 'snapshots/source/system-prompt.expected.txt'), 'Not\nMarkdown\n')
    writeFileSync(join(root, 'snapshots/source/system-prompt.expected.other.md'), 'Not\nin scope\n')
    const result = checkMarkdownWrap(root)
    expect(result.checked).toBe(1)
    expect(result.violations).toEqual([{
      file: 'snapshots/source/system-prompt.expected.md', line: 1, text: 'First line',
    }])
  })

  // Windows file symlinks require developer mode or privileges not owned by this fixture.
  it.skipIf(process.platform === 'win32')('deduplicates file symlinks without traversing them as directories', () => {
    const root = fixture()
    writeFileSync(join(root, 'snapshots/source/system-prompt.expected.md'), '# Prompt\n\nOne physical line.\n')
    symlinkSync('../source/system-prompt.expected.md', join(root, 'snapshots/alias/system-prompt.expected.md'))
    expect(checkMarkdownWrap(root)).toEqual({ checked: 1, violations: [] })
  })
})
