/** Shared panel visibility; requests and task drafts stay in the single editor instance. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

type PanelState = { open: boolean }
type PanelActions = { setOpen: (draft: PanelState, open: boolean) => void }

/**
 * Create one plugin-owned visibility store shared by its two launchers.
 * @returns A handle disposed with the registered entries, without a module singleton.
 */
export function createDelegationStore(): EngineStoreHandle<PanelState, PanelActions> {
  return defineStore({
    init: () => ({ open: false }),
    actions: { setOpen: (draft: { open: boolean }, open: boolean) => { draft.open = open } },
  })
}
