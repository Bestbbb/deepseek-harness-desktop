import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> { return Promise.resolve() }
}

it('registers, validates and disposes the duration preference without a countdown record', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin(plugin)
    await fiber.await()
    expect(ctx.settings.get('focus-timer')).toEqual({})
    for (const minutes of [1, 25, 1440]) {
      await ctx.settings.update('focus-timer', { minutes })
      expect(ctx.settings.get('focus-timer')).toEqual({ minutes })
    }
    await ctx.settings.mutate('focus-timer', [{ op: 'unset', path: ['minutes'] }])
    for (const minutes of [0, -1, 0.5, 1441, '25']) {
      await expect(ctx.settings.update('focus-timer', { minutes })).rejects.toThrow()
      expect(ctx.settings.get('focus-timer')).toEqual({})
    }
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain('focus-timer')
  } finally {
    await ctx.fiber.dispose()
  }
})
