// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as connectionApply } from '@deepseek-ai/dsh-client-connection/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import * as plugin from '../src/client/index.ts'
import { DelegationLauncher, type DelegationInjected } from '../src/client/DelegationLauncher.tsx'
import { MarketplaceAction } from '../src/client/MarketplaceAction.tsx'

vi.mock('@deepseek-ai/dsh-delegation-launcher/remote', () => ({ default: {} }))
usePinnedBrowserLanguages('en-US')
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose() })

it('uses the observed Session command, waits for slots and retracts every registration', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin({ apply: connectionApply }).await()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const providers = vi.fn().mockResolvedValue({ ok: true, value: ['fixture'] })
  const readJob = vi.fn().mockResolvedValue({ ok: true, value: { kind: 'pending' } })
  const cancelJob = vi.fn().mockResolvedValue({ ok: true, value: 'requested' })
  const dispose = vi.fn().mockResolvedValue(undefined)
  const command = vi.fn().mockResolvedValue({ ok: true, value: { result: { kind: 'success', text: 'Queued job' } } })
  ctx.provide('remote', { $mount: vi.fn().mockResolvedValue(dispose), delegationLauncher: { providers, readJob, cancelJob }, commands: { execute: command } } as never)
  ctx.provide('remote.delegationLauncher', { providers, readJob, cancelJob })
  ctx.provide('remote.commands', { execute: command })
  const id = SessionId('parent')
  const binding = vi.fn().mockReturnValue({ session: { command } })
  const getSnapshot = vi.fn().mockReturnValue({ current: id })
  ctx.provide('sessions', { binding, list: { getSnapshot } } as never)
  const slots = ctx.get('slots') as SlotRegistry
  const fiber = await ctx.plugin(plugin)
  expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
  const declare = () => slots.register({ name: 'root', children: {
    'sidebar.footer.action': { kind: 'list', scope: 'root' },
    'settings.bundleMarketplace.action': { kind: 'keyed', scope: 'root' },
  } } as never, () => null)
  const stop = declare()
  await vi.waitFor(() => { expect(slots.entries('settings.bundleMarketplace.action')).toHaveLength(1) })
  const entry = slots.entries('sidebar.footer.action')[0]!
  expect(entry.component).toBe(DelegationLauncher)
  expect(slots.entries('settings.bundleMarketplace.action')[0]!.component).toBe(MarketplaceAction)
  expect(slots.entries('settings.bundleMarketplace.action')[0]!.store).toBe(entry.store)
  const callbacks = entry.inject!() as unknown as DelegationInjected
  const job = JobId('subagent-1')
  await expect(callbacks.readJob(id, job, 3)).resolves.toEqual({ kind: 'unavailable' })
  await expect(callbacks.cancelJob(id, job, 3)).resolves.toBe('unconfirmed')
  const connection = ctx.get('connection') as ConnectionHandle
  const observed = vi.spyOn(connection.generation, 'getSnapshot').mockReturnValue({ id: 3, host: { home: '/test' } })
  getSnapshot.mockReturnValueOnce({ current: SessionId('other') })
  await expect(callbacks.readJob(id, job, 3)).resolves.toEqual({ kind: 'unavailable' })
  getSnapshot.mockReturnValueOnce({ current: SessionId('other') })
  await expect(callbacks.cancelJob(id, job, 3)).resolves.toBe('unconfirmed')
  expect(readJob).not.toHaveBeenCalled()
  expect(cancelJob).not.toHaveBeenCalled()
  await expect(callbacks.readJob(id, job, 3)).resolves.toEqual({ kind: 'pending' })
  await expect(callbacks.cancelJob(id, job, 3)).resolves.toBe('requested')
  expect(readJob).toHaveBeenCalledExactlyOnceWith(id, job)
  expect(cancelJob).toHaveBeenCalledExactlyOnceWith(id, job)
  readJob.mockResolvedValueOnce({ ok: false })
  cancelJob.mockResolvedValueOnce({ ok: false })
  await expect(callbacks.readJob(id, job, 3)).resolves.toEqual({ kind: 'unavailable' })
  await expect(callbacks.cancelJob(id, job, 3)).resolves.toBe('unconfirmed')
  observed.mockRestore()
  expect(providers).not.toHaveBeenCalled()
  await expect(callbacks.providers()).resolves.toEqual(['fixture'])
  providers.mockResolvedValueOnce({ ok: false })
  await expect(callbacks.providers()).rejects.toThrow('Delegation providers unavailable')
  binding.mockReturnValueOnce(undefined)
  await expect(callbacks.submit(id, 'fixture', 'task')).resolves.toBeNull()
  getSnapshot.mockReturnValueOnce({ current: SessionId('other') })
  await expect(callbacks.submit(id, 'fixture', 'task')).resolves.toBeNull()
  expect(command).not.toHaveBeenCalled()
  await expect(callbacks.submit(id, 'fixture', 'task')).resolves.toEqual({ kind: 'success', text: 'Queued job' })
  expect(command).toHaveBeenLastCalledWith(id, '/delegate-task {"provider":"fixture","task":"task"}', [])
  command.mockResolvedValueOnce({ ok: true, value: { result: { kind: 'error' } } })
  await expect(callbacks.submit(id, 'fixture', 'task')).resolves.toEqual({ kind: 'error' })
  command.mockResolvedValueOnce({ ok: false })
  await expect(callbacks.submit(id, 'fixture', 'task')).resolves.toBeNull()
  command.mockResolvedValueOnce({ ok: true, value: undefined })
  await expect(callbacks.submit(id, 'fixture', 'task')).resolves.toBeNull()
  stop()
  expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
  expect(slots.entries('settings.bundleMarketplace.action')).toHaveLength(0)
  declare()
  await vi.waitFor(() => { expect(slots.entries('settings.bundleMarketplace.action')).toHaveLength(1) })
  await fiber.dispose()
  expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
  expect(slots.entries('settings.bundleMarketplace.action')).toHaveLength(0)
  expect(dispose).toHaveBeenCalledOnce()
  expect(() => locale.register('desktop.delegationLauncher', 'en', {})).not.toThrow()
})
