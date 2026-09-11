import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BundleMarketplaceGateway } from '../src/index.ts'
import type { BundleCatalogId } from '@deepseek-ai/dsh-bundle-preparation'
import type { DesktopProfileName, DesktopProfileSelection } from '@deepseek-ai/dsh-desktop'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
const id = 'fixture' as BundleCatalogId
const profile = 'desktop-00000000-0000-4000-8000-000000000000' as DesktopProfileName
const selection: DesktopProfileSelection = { schemaVersion: 1, activeProfile: 'web' as DesktopProfileName,
  previousProfile: null, pending: null, trial: null, lastFailure: null }

async function bench() {
  const ctx = new Context()
  contexts.push(ctx)
  const queueActivation = vi.fn().mockResolvedValue({ profile })
  const queueRemoval = vi.fn().mockResolvedValue({ profile })
  const profileSelection = vi.fn().mockResolvedValue(selection)
  const profileBundles = vi.fn().mockResolvedValue([])
  const cancelProfile = vi.fn().mockResolvedValue(undefined)
  const openLocalAgents = vi.fn().mockResolvedValue(undefined)
  ctx.provide('bundlePreparation', { list: () => [{ entry: { id, title: 'Fixture', packageName: 'fixture', version: '1',
    publisher: 'Tests', source: 'https://example.com/fixture', details: null, artifact: { file: '/private/file.tgz' }, harnessVersions: ['private'] }, issues: [] }], queueActivation, queueRemoval, profileBundles } as never)
  ctx.provide('desktop', { profileSelection, cancelProfile, openLocalAgents } as never)
  const fiber = ctx.plugin(BundleMarketplaceGateway)
  await fiber.await()
  return { gateway: ctx.get('bundleMarketplace') as BundleMarketplaceGateway, queueActivation, queueRemoval, profileSelection, cancelProfile, profileBundles, openLocalAgents }
}

describe('marketplace gateway', () => {
  it('opens only the native settings window and withholds native errors', async () => {
    const b = await bench()
    await expect(b.gateway.openLocalAgents()).resolves.toBe('acknowledged')
    expect(b.openLocalAgents).toHaveBeenCalledExactlyOnceWith()
    expect(b.profileSelection).not.toHaveBeenCalled()
    expect(b.queueActivation).not.toHaveBeenCalled()
    b.openLocalAgents.mockRejectedValueOnce(new Error('/private/native/path'))
    await expect(b.gateway.openLocalAgents()).resolves.toBe('unconfirmed')
    expect(b.openLocalAgents).toHaveBeenCalledTimes(2)
  })
  it('keeps unreadable Profile metadata distinct and refuses a changed native selection', async () => {
    const b = await bench()
    b.profileSelection.mockResolvedValue({ ...selection, trial: { profile } })
    b.profileBundles.mockRejectedValueOnce(new Error('/private/config'))
    const value = await b.gateway.snapshot()
    expect(value.profiles).toEqual([{ profile: 'web', state: 'unavailable' }, { profile, state: 'read', bundles: [] }])
    const reading = Promise.withResolvers<[]>()
    b.profileBundles.mockReturnValueOnce(reading.promise)
    const request = b.gateway.snapshot()
    await vi.waitFor(() => { expect(b.profileBundles).toHaveBeenCalledTimes(3) })
    b.profileSelection.mockResolvedValue(selection)
    reading.resolve([])
    await expect(request).rejects.toThrow('Marketplace state is unavailable')
  })
  it('projects only discovery metadata and current native observations', async () => {
    const b = await bench()
    expect(await b.gateway.snapshot()).toEqual({ selection, profiles: [{ profile: 'web', state: 'read', bundles: [] }], entries: [{ id, title: 'Fixture', packageName: 'fixture',
      version: '1', publisher: 'Tests', source: 'https://example.com/fixture', details: null, issues: [] }] })
    b.profileSelection.mockResolvedValue({ ...selection, pending: { profile } })
    expect((await b.gateway.snapshot()).selection.pending).toEqual({ profile })
    expect(b.queueActivation).not.toHaveBeenCalled()
  })
  it('forwards explicit identities once and does not hide uncertain commits as safe retries', async () => {
    const b = await bench()
    await expect(b.gateway.queueActivation(id, profile, null)).resolves.toBe('acknowledged')
    expect(b.queueActivation).toHaveBeenCalledExactlyOnceWith(id, profile, null)
    await expect(b.gateway.queueRemoval(profile, 'fixture', '1')).resolves.toBe('acknowledged')
    expect(b.queueRemoval).toHaveBeenCalledExactlyOnceWith(profile, 'fixture', '1')
    b.queueRemoval.mockRejectedValueOnce(new Error('private path'))
    await expect(b.gateway.queueRemoval(profile, 'fixture', '1')).resolves.toBe('unconfirmed')
    await expect(b.gateway.cancel(profile)).resolves.toBe('acknowledged')
    expect(b.cancelProfile).toHaveBeenCalledExactlyOnceWith(profile)
    b.queueActivation.mockRejectedValueOnce(new Error('private config and credentials'))
    await expect(b.gateway.queueActivation(id, profile, '0.9')).resolves.toBe('unconfirmed')
    expect(b.queueActivation).toHaveBeenLastCalledWith(id, profile, '0.9')
    b.cancelProfile.mockRejectedValueOnce(new Error('private path'))
    await expect(b.gateway.cancel(profile)).resolves.toBe('unconfirmed')
    b.profileSelection.mockRejectedValueOnce(new Error('/private/secrets'))
    await expect(b.gateway.snapshot()).rejects.toThrow('Marketplace state is unavailable')
  })
})
