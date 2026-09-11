/** The installed Bundle supplies its own use action. */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-bundle-marketplace/client'
import type { createDelegationStore } from './store.ts'

type Props = PropsRuntime<'settings.bundleMarketplace.action'>
  & PropsLocale<'desktop.delegationLauncher'> & PropsStore<ReturnType<typeof createDelegationStore>>

/** @param props - Settings exit, shared visibility and localized copy. @returns The Bundle use button. */
export function MarketplaceAction({ close, actions, t }: Props) {
  return <button type="button" onClick={() => { close(); actions.setOpen(true) }}>{t('open')}</button>
}
