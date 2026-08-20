/** Persistent sidebar recovery affordance when no configured model can run. */

import { useEffect } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ModelsSettingsStore } from './store.ts'
import { onboardingReadiness } from './store.ts'
import type { ModelsKey } from './locales.ts'
import styles from './CredentialStatus.module.css'

/** Dependencies supplied by the models-settings registrant. */
export interface CredentialStatusInjected {
  /** Shared models-settings controller. */
  controller: ModelsSettingsStore
  hooks: {
    /** Shared controller snapshot, bound by the slot renderer as useSnapshot. */
    snapshot: ModelsSettingsStore['store']
  }
  /** Models-settings translator. */
  t: (key: ModelsKey, values?: Record<string, string | number>) => string
}

/** Props supplied by the sidebar owner and the models-settings registrant. */
export type CredentialStatusProps =
  SidebarFooterActionOwnerProps & InjectFace<CredentialStatusInjected>

/**
 * Show a durable API-key warning after onboarding can be dismissed.
 * @param props - sidebar geometry and the shared models-settings store.
 * @returns a recovery button, or null when any provider is usable.
 */
export function CredentialStatus({ wide, controller, useSnapshot, t }: CredentialStatusProps) {
  const readiness = useSnapshot(onboardingReadiness)
  useEffect(() => {
    if (controller.store.getSnapshot().status === 'idle') void controller.load()
  }, [controller])
  if (readiness.kind !== 'credential-missing') return null
  return (
    <button
      type="button"
      className={styles.root}
      aria-label={t('credentialAction')}
      title={wide ? undefined : t('credentialAction')}
      onClick={() => {
        window.dispatchEvent(new CustomEvent('dsh-desktop-open-settings', {
          detail: { section: 'models' },
        }))
      }}
    >
      <span className={styles.badge} aria-hidden="true">!</span>
      {wide && <span>{t('credentialRequired')}</span>}
    </button>
  )
}
