/** Authenticated Remote consumer of reviewed preparation and native Profile selection. */
import type { Context } from '@deepseek-ai/cordis'
import { isDeepStrictEqual } from 'node:util'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import type { BundleCatalogId, PreparationOperation } from '@deepseek-ai/dsh-bundle-preparation'
import type { DesktopProfileName } from '@deepseek-ai/dsh-desktop'
import type { MarketplaceSnapshot, MarketplaceCommandResult, MarketplaceProfile } from './types.ts'

export type * from './types.ts'

/** Browser commands select catalog identities, never paths, shell commands or native credentials. */
export class BundleMarketplaceGateway extends TypertRemoteService {
  static inject = ['bundlePreparation', 'desktop']

  constructor(ctx: Context) {
    super(ctx, 'bundleMarketplace')
  }

  /**
   * Read preparation history only when requested; receipts are not evidence of activation.
   * @returns Newest-first journal observations, without paths, raw errors or configuration.
   */
  @Remote('history')
  async history(): Promise<readonly PreparationOperation[]> {
    try { return await this.ctx.bundlePreparation.listOperations() } catch {
      // Unconfigured, oversized and unreadable journals remain unavailable, not empty histories.
      throw new Error('Marketplace history is unavailable')
    }
  }

  /**
   * Open the native local-agent settings window; do not inspect accounts or change activation.
   * @returns Window acknowledgement only, or an uncertain response with native errors withheld.
   */
  @Remote('openLocalAgents')
  async openLocalAgents(): Promise<MarketplaceCommandResult> {
    try { await this.ctx.desktop.openLocalAgents() } catch {
      // Native window errors may include local paths; no agent or login state crosses this call.
      return 'unconfirmed'
    }
    return 'acknowledged'
  }

  /**
   * Read compatible discovery metadata and the native owner's current activation state.
   * @returns Fresh observations with no configuration, receipt contents or local filesystem paths.
   */
  @Remote('snapshot')
  async snapshot(): Promise<MarketplaceSnapshot> {
    try {
      const selection = await this.ctx.desktop.profileSelection()
      const names = new Set([selection.activeProfile,
        ...selection.pending === null ? [] : [selection.pending.profile],
        ...selection.trial === null ? [] : [selection.trial.profile]])
      const profiles: MarketplaceProfile[] = []
      for (const profile of names) {
        try { profiles.push({ profile, state: 'read', bundles: await this.ctx.bundlePreparation.profileBundles(profile) }) } catch {
          // Profile paths, package metadata errors and private configuration stay on the Host.
          profiles.push({ profile, state: 'unavailable' })
        }
      }
      if (!isDeepStrictEqual(selection, await this.ctx.desktop.profileSelection())) throw new Error('Selection changed')
      return { selection, profiles, entries: this.ctx.bundlePreparation.list().map(({ entry, issues }) => ({
        id: entry.id, title: entry.title, packageName: entry.packageName, version: entry.version,
        publisher: entry.publisher, source: entry.source, details: entry.details, issues,
      })) }
    } catch {
      throw new Error('Marketplace state is unavailable')
    }
  }

  /**
   * Prepare reviewed code and queue it for a later full application launch; never restart the app.
   * @param id - identity from the current reviewed catalog.
   * @param profile - native-selected Profile observed during confirmation.
   * @param version - exact observed installed version, or null for a previously absent Bundle.
   * @returns Acknowledgement or an uncertain outcome requiring a fresh snapshot before retry.
   */
  @Remote('queueActivation')
  async queueActivation(id: BundleCatalogId, profile: DesktopProfileName, version: string | null): Promise<MarketplaceCommandResult> {
    try { await this.ctx.bundlePreparation.queueActivation(id, profile, version) } catch {
      // Raw preparation errors can include private paths, configuration or subprocess output.
      return 'unconfirmed'
    }
    return 'acknowledged'
  }

  /**
   * Prepare removal from exactly the observed active Profile; original files remain available for recovery.
   * @param profile - observed native-selected Profile.
   * @param packageName - installed Bundle name, validated by the preparation service.
   * @param version - observed package version, checked before preparing removal.
   * @returns Queue acknowledgement or an uncertain outcome requiring a fresh snapshot.
   */
  @Remote('queueRemoval')
  async queueRemoval(profile: DesktopProfileName, packageName: string, version: string): Promise<MarketplaceCommandResult> {
    try { await this.ctx.bundlePreparation.queueRemoval(profile, packageName, version) } catch {
      // Paths, configuration and process diagnostics stay on the Host.
      return 'unconfirmed'
    }
    return 'acknowledged'
  }

  /**
   * Cancel exactly the observed pending generation without deleting its files or changing the active one.
   * @param profile - pending Profile identity from a fresh native selection.
   * @returns Acknowledgement or an uncertain outcome requiring a fresh snapshot.
   */
  @Remote('cancel')
  async cancel(profile: DesktopProfileName): Promise<MarketplaceCommandResult> {
    try { await this.ctx.desktop.cancelProfile(profile) } catch {
      // Native persistence errors remain private; callers reconcile through the selection read.
      return 'unconfirmed'
    }
    return 'acknowledged'
  }
}

export default BundleMarketplaceGateway
