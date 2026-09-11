// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubSettingsScope, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { expect, it, vi } from 'vitest'
import type { NotificationPreferences } from '../src/settings.ts'
import { NotificationControls, type NotificationControlsInjected } from '../src/client/NotificationControls.tsx'
import * as plugin from '../src/client/index.ts'

usePinnedBrowserLanguages('en-US')
it('waits for its action slot, shares the existing settings scope, and retracts with either owner', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const preference = stubSettingsScope<NotificationPreferences>()
    const bind = vi.fn(() => preference.scope)
    ctx.provide('settingsScope', { bind } as never)
    const fiber = ctx.plugin(plugin)
    await fiber.await()
    expect(ctx.slots.entries('settings.bundleMarketplace.action')).toHaveLength(0)
    const declare = () => ctx.slots.register({ name: 'root', children: {
      'settings.bundleMarketplace.action': { kind: 'keyed', scope: 'root' },
    } } as never, () => null)
    const stop = declare()
    await vi.waitFor(() => { expect(ctx.slots.entries('settings.bundleMarketplace.action')).toHaveLength(1) })
    const entry = ctx.slots.entries('settings.bundleMarketplace.action')[0]!
    expect(entry.component).toBe(NotificationControls)
    expect(bind).toHaveBeenCalledWith({ namespace: 'notification-controls' })
    const injected = entry.inject!() as unknown as NotificationControlsInjected
    expect(injected.hooks.preference).toBe(preference.scope)
    expect(await injected.save('completed', false, 1)).toBe(false)
    expect(preference.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['completed'], value: false }], 1)
    preference.publish({ status: 'ready', mode: 'host', writable: true, value: { completed: false, failed: true }, revision: 2 })
    expect(await injected.save('completed', false, 1)).toBe(true)
    expect(await injected.save('failed', false, 2)).toBe(false)
    preference.publish({ writable: false })
    expect(await injected.save('completed', false, 2)).toBe(false)
    preference.publish({ writable: true, mode: 'memory' })
    expect(await injected.save('completed', false, 2)).toBe(false)
    preference.publish({ mode: 'host', value: undefined })
    expect(await injected.save('completed', false, 2)).toBe(false)
    preference.mutate.mockRejectedValueOnce(new Error('closed'))
    await expect(injected.save('failed', true, 2)).rejects.toThrow('closed')
    stop()
    expect(ctx.slots.entries('settings.bundleMarketplace.action')).toHaveLength(0)
    declare()
    await vi.waitFor(() => { expect(ctx.slots.entries('settings.bundleMarketplace.action')).toHaveLength(1) })
    await fiber.dispose()
    expect(ctx.slots.entries('settings.bundleMarketplace.action')).toHaveLength(0)
    expect(() => ctx.locale.register('desktop.notificationControls', 'en', {})).not.toThrow()
  } finally { await ctx.fiber.dispose() }
})
