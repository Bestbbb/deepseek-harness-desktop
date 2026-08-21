import { describe, expect, it } from 'vitest'
import { alignFirstPartyAddSpecs } from '../src/plugin.ts'

describe('profile plugin arguments', () => {
  it('aligns bare first-party add specs to the running dsh release', () => {
    expect(alignFirstPartyAddSpecs([
      'add',
      '@deepseek-ai/dsh-subagent-codex',
      '@deepseek-ai/dsh-subagent-claude-code',
    ], '0.1.1-rc.1')).toEqual([
      'add',
      '@deepseek-ai/dsh-subagent-codex@0.1.1-rc.1',
      '@deepseek-ai/dsh-subagent-claude-code@0.1.1-rc.1',
    ])
  })

  it('preserves explicit first-party specs and third-party packages', () => {
    expect(alignFirstPartyAddSpecs([
      'add',
      '@deepseek-ai/dsh-subagent-codex@next',
      '@deepseek-ai/dsh-subagent-claude-code@0.1.1-rc.1',
      '@example/custom-bundle',
      '--save-exact',
    ], '0.1.1-rc.1')).toEqual([
      'add',
      '@deepseek-ai/dsh-subagent-codex@next',
      '@deepseek-ai/dsh-subagent-claude-code@0.1.1-rc.1',
      '@example/custom-bundle',
      '--save-exact',
    ])
  })

  it('leaves non-add pnpm commands untouched', () => {
    expect(alignFirstPartyAddSpecs([
      'remove',
      '@deepseek-ai/dsh-subagent-codex',
    ], '0.1.1-rc.1')).toEqual([
      'remove',
      '@deepseek-ai/dsh-subagent-codex',
    ])
  })
})
