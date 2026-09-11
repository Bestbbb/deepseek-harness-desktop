/**
 * Service Definition for native desktop operations supplied by a desktop host.
 * @module @deepseek-ai/dsh-desktop
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { DesktopProfileName, DesktopProfileCandidate, DesktopProfileSelection, DesktopNotification, DesktopStatus } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Native desktop operations available only in a desktop composition. */
    desktop: DesktopHost
  }
}

/**
 * Native desktop capability. Implementations cross the process boundary into
 * the owning desktop shell and reject when that shell cannot complete the operation.
 */
export abstract class DesktopHost extends Service {
  constructor(ctx: Context) {
    super(ctx, 'desktop')
  }

  /**
   * Check that the native desktop host is reachable.
   * @returns Available status after a complete bridge round trip.
   */
  abstract status(): Promise<DesktopStatus>

  /**
   * Show and focus the primary application window.
   * @returns After the native host completes the operation.
   */
  abstract show(): Promise<void>

  /**
   * Open or focus the native local-agent settings window without running checks or changing preferences.
   * @returns After the native host completes the window operation; no agent-readiness claim.
   */
  abstract openLocalAgents(): Promise<void>

  /**
   * Display an operating-system notification.
   * @param notification - user-visible title and body.
   * @returns After the native host accepts the notification.
   */
  abstract notify(notification: DesktopNotification): Promise<void>

  /**
   * Enable or disable launch at user login.
   * @param enabled - desired autostart state.
   * @returns After the operating system records the state.
   */
  abstract setAutostart(enabled: boolean): Promise<void>

  /**
   * Read the native host's persisted startup selection without scanning plugin contents.
   * @returns Active, queued, trial and failed startup identities; no installation-health claim.
   */
  abstract profileSelection(): Promise<DesktopProfileSelection>

  /**
   * Queue a prepared Profile for the next full application launch; does not interrupt tasks.
   * A transport failure can leave the queue committed: inspect selection before retry or cleanup.
   * @param candidate - prepared identity with the expected active predecessor and manifest hash.
   * @returns After the native host records the pending selection.
   */
  abstract queueProfile(candidate: DesktopProfileCandidate): Promise<void>

  /**
   * Cancel the exact pending Profile without deleting its files or changing the active runtime.
   * @param profile - pending identity obtained from native selection.
   * @returns After the native host clears the pending selection.
   */
  abstract cancelProfile(profile: DesktopProfileName): Promise<void>
}

export default DesktopHost
