/** Preferences belong to this optional policy, not the native transport or marketplace. */

/** Namespace in the Harness user-settings document. */
export const NOTIFICATION_CONTROLS_NAMESPACE = 'notification-controls'

/** Independent permissions for the desktop's existing background task notifications. */
export interface NotificationPreferences {
  /** Permit completed top-level turn notifications. */
  completed: boolean
  /** Permit failed top-level turn notifications. */
  failed: boolean
}
