/** Shared panel visibility; the single sidebar component retains countdown state and owns its interval. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

type PanelState = { open: boolean }
type PanelActions = { setOpen: (draft: PanelState, open: boolean) => void }

/**
 * Create one root-scoped visibility store shared by sidebar and optional marketplace launchers.
 * @returns A handle whose lifetime follows the plugin's registered entries, with no module singleton.
 */
export function createFocusTimerStore(): EngineStoreHandle<PanelState, PanelActions> {
  return defineStore({
    init: (): PanelState => ({ open: false }),
    actions: { setOpen: (draft, open: boolean) => { draft.open = open } },
  })
}
