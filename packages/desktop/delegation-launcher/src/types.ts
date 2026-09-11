/** Browser-safe outcomes for explicit, session-authorized task control. */
export type TaskRead =
  | { kind: 'ready'; status: 'completed' | 'failed' | 'killed'; text: string; truncated: boolean }
  | { kind: 'pending' | 'unavailable' }

/** Cancellation acknowledges a request, never process termination. */
export type TaskCancellation = 'requested' | 'already-finished' | 'unconfirmed'
