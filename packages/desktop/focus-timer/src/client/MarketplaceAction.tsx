/** The plugin owns its launch action; the marketplace only supplies an extension location. */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-bundle-marketplace/client'
import type { createFocusTimerStore } from './store.ts'

/** Marketplace exit callback, shared visibility actions and plugin-owned copy. */
export type MarketplaceActionProps = PropsRuntime<'settings.bundleMarketplace.action'>
  & PropsLocale<'desktop.focusTimer'> & PropsStore<ReturnType<typeof createFocusTimerStore>>

/**
 * Open the existing timer after closing Settings, without creating another timer instance.
 * @param props - Settings exit callback, shared visibility actions and localized copy.
 * @returns The plugin-owned launch button.
 */
export function MarketplaceAction({ close, actions, t }: MarketplaceActionProps) {
  return <button type="button" onClick={() => { close(); actions.setOpen(true) }}>{t('open')}</button>
}
