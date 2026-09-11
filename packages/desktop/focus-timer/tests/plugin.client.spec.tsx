// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { afterEach, expect, it, vi } from 'vitest'
import { stubSettingsScope, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { FocusTimerSettings } from '../src/settings.ts'
import type { FocusTimerInjected } from '../src/client/FocusTimer.tsx'
import * as plugin from '../src/client/index.ts'
import * as host from '../src/index.ts'
import { FocusTimer } from '../src/client/FocusTimer.tsx'
import { MarketplaceAction } from '../src/client/MarketplaceAction.tsx'

usePinnedBrowserLanguages('en-US')
const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

it('waits for the sidebar slot and removes the contribution and dictionary on disposal', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  expect('default' in host).toBe(false)
  expect('default' in plugin).toBe(false)
  const loader = Object.create(Loader.prototype) as Loader
  expect(loader.unwrapExports(host)).toBe(host)
  expect(loader.unwrapExports(plugin)).toBe(plugin)
  await ctx.plugin(host).await()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const preference = stubSettingsScope<FocusTimerSettings>()
  const bind = vi.fn(() => preference.scope)
  ctx.provide('settingsScope', { bind } as never)
  const slots = ctx.get('slots') as SlotRegistry
  const fiber = ctx.plugin(plugin)
  await fiber.await()
  expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
  const declare = () => slots.register({ name: 'root', children: {
    'sidebar.footer.action': { kind: 'list', scope: 'root' },
  } } as never, () => null)
  const stop = declare()
  await vi.waitFor(() => { expect(slots.entries('sidebar.footer.action')).toHaveLength(1) })
  expect(slots.entries('sidebar.footer.action')[0]!.component).toBe(FocusTimer)
  expect(bind).toHaveBeenCalledWith({ namespace: 'focus-timer' })
  const injected = slots.entries('sidebar.footer.action')[0]!.inject!() as unknown as FocusTimerInjected
  expect(injected.hooks.preference).toBe(preference.scope)
  expect(await injected.savePreference(25, 1)).toBe(false)
  expect(preference.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['minutes'], value: 25 }], 1)
  preference.publish({ status: 'ready', value: { minutes: 25 }, revision: 2, writable: true })
  expect(await injected.savePreference(25, 2)).toBe(true)
  expect(await injected.savePreference(15, 2)).toBe(false)
  preference.publish({ mode: 'memory' })
  expect(await injected.savePreference(25, 2)).toBe(false)
  preference.publish({ mode: 'host', writable: false })
  expect(await injected.savePreference(25, 2)).toBe(false)
  preference.publish({ writable: true, value: undefined })
  expect(await injected.savePreference(25, 2)).toBe(false)
  preference.mutate.mockRejectedValueOnce(new Error('unavailable'))
  await expect(injected.savePreference(null, 2)).rejects.toThrow('unavailable')
  expect(slots.entries('settings.bundleMarketplace.action')).toHaveLength(0)
  const declareMarket = () => slots.register({ name: 'root', priority: 1, children: {
    'settings.bundleMarketplace.action': { kind: 'keyed', scope: 'root' },
  } } as never, () => null)
  const stopMarket = declareMarket()
  await vi.waitFor(() => { expect(slots.entries('settings.bundleMarketplace.action')).toHaveLength(1) })
  expect(slots.entries('settings.bundleMarketplace.action')[0]!.component).toBe(MarketplaceAction)
  expect(slots.entries('settings.bundleMarketplace.action')[0]!.store).toBeDefined()
  expect(slots.entries('settings.bundleMarketplace.action')[0]!.store)
    .toBe(slots.entries('sidebar.footer.action')[0]!.store)
  stopMarket()
  expect(slots.entries('settings.bundleMarketplace.action')).toHaveLength(0)
  expect(slots.entries('sidebar.footer.action')).toHaveLength(1)
  declareMarket()
  await vi.waitFor(() => { expect(slots.entries('settings.bundleMarketplace.action')).toHaveLength(1) })
  stop()
  expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
  expect(slots.entries('settings.bundleMarketplace.action')).toHaveLength(0)
  declare()
  await vi.waitFor(() => { expect(slots.entries('sidebar.footer.action')).toHaveLength(1) })
  await vi.waitFor(() => { expect(slots.entries('settings.bundleMarketplace.action')).toHaveLength(1) })
  await fiber.dispose()
  expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
  expect(slots.entries('settings.bundleMarketplace.action')).toHaveLength(0)
  expect(() => locale.register('desktop.focusTimer', 'en', {})).not.toThrow()
})
