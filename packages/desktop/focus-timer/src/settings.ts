/** Plugin-owned duration preference; countdown state is never persisted. */

/** Namespace in the existing Harness user-settings document. */
export const FOCUS_TIMER_NAMESPACE = 'focus-timer'

/** Durable preference shared by Host registration and the browser's typed scope. */
export interface FocusTimerSettings {
  /** Whole minutes for a fresh timer; absence leaves the duration empty. */
  minutes?: number
}
