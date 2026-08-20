/**
 * Service Definition for native desktop operations supplied by a desktop host.
 * @module @deepseek-ai/dsh-desktop
 */

import { Context, Service } from '@deepseek-ai/cordis'

/** A user-visible operating-system notification. */
export interface DesktopNotification {
  /** Notification heading. */
  readonly title: string
  /** Notification body. */
  readonly body: string
}

/** Current native host availability. */
export interface DesktopStatus {
  /** Whether the native host accepted the status request. */
  readonly available: true
}

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
}

export default DesktopHost
