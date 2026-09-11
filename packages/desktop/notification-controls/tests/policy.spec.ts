/** Host policy lifetime and durable preferences without a browser runtime. */
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'
import type {} from '@deepseek-ai/dsh-desktop-native'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> { return Promise.resolve() }
}

it('preserves defaults, reads live saved choices, delegates and retracts without changing the stored preference', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin(plugin)
    await fiber.await()
    const next = vi.fn(() => true)
    expect(ctx.settings.get('notification-controls')).toEqual({ completed: true, failed: true })
    expect(ctx.waterfall('desktop/task-notification', 'completed', next)).toBe(true)
    expect(ctx.waterfall('desktop/task-notification', 'error', next)).toBe(true)
    expect(next).toHaveBeenCalledTimes(2)
    await ctx.settings.update('notification-controls', { completed: false })
    expect(ctx.waterfall('desktop/task-notification', 'completed', next)).toBe(false)
    expect(next).toHaveBeenCalledTimes(2)
    expect(ctx.waterfall('desktop/task-notification', 'error', next)).toBe(true)
    await ctx.settings.update('notification-controls', { failed: false })
    expect(ctx.waterfall('desktop/task-notification', 'error', next)).toBe(false)
    await expect(ctx.settings.update('notification-controls', { failed: 'no' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.waterfall('desktop/task-notification', 'completed', next)).toBe(true)
    const replacement = ctx.plugin(plugin)
    await replacement.await()
    expect(ctx.settings.get('notification-controls')).toEqual({ completed: false, failed: false })
    expect(ctx.waterfall('desktop/task-notification', 'error', next)).toBe(false)
    await ctx.settings.update('notification-controls', { failed: true })
    expect(ctx.waterfall('desktop/task-notification', 'error', () => false)).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
