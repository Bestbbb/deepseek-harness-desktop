/** Observed preferences, explicit revision-fenced writes, and no optimistic success state. */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-bundle-marketplace/client'
import type { NotificationPreferences } from '../settings.ts'
import css from './NotificationControls.module.css'

/** Registration-owned settings observation and write callback. */
export interface NotificationControlsInjected {
  hooks: { preference: Pick<SettingsScope<NotificationPreferences>, 'getSnapshot' | 'subscribe'> }
  /** Confirm only a settled Host observation with the requested field value. */
  save: (field: keyof NotificationPreferences, enabled: boolean, revision: number) => Promise<boolean>
}

/** Marketplace owner props, framework locale and settings observation. */
export type NotificationControlsProps = PropsRuntime<'settings.bundleMarketplace.action'>
  & PropsLocale<'desktop.notificationControls'> & InjectFace<NotificationControlsInjected>

/**
 * Offer saved completion and failure switches without sending a test notification.
 * @param props - Framework-bound settings and localized copy.
 * @returns The plugin-owned expandable editor.
 */
export function NotificationControls({ t, usePreference, save }: NotificationControlsProps) {
  const preference = usePreference(value => value)
  const value = preference.status === 'ready' ? preference.value : undefined
  const [saving, setSaving] = useState(false)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const writable = value !== undefined && preference.mode === 'host' && preference.writable && preference.revision !== undefined
  const update = async (field: keyof NotificationPreferences, enabled: boolean): Promise<void> => {
    if (pending.current || !writable || preference.revision === undefined) return
    pending.current = true
    setSaving(true)
    setUnconfirmed(false)
    try {
      const confirmed = await save(field, enabled, preference.revision)
      if (mounted.current) setUnconfirmed(!confirmed)
    } catch {
      // A failed transport cannot establish whether the Host persisted the choice.
      if (mounted.current) setUnconfirmed(true)
    } finally {
      pending.current = false
      if (mounted.current) setSaving(false)
    }
  }
  return <details data-notification-controls className={css.root}>
    <summary>{t('configure')}</summary>
    <p>{t('intro')}</p>
    {value === undefined ? <p role="status">{t(preference.status === 'loading' ? 'loading' : 'unavailable')}</p>
      : <fieldset disabled={!writable || saving}>
        <legend>{t('choices')}</legend>
        {(['completed', 'failed'] as const).map(field => <p key={field}><label>
          <input type="checkbox" checked={value[field]}
            onChange={(event) => { void update(field, event.target.checked) }} /> {t(field)}
        </label></p>)}
      </fieldset>}
    {value !== undefined && !writable && <p role="status">{t('unavailable')}</p>}
    {saving && <p role="status">{t('saving')}</p>}
    {unconfirmed && <p role="alert">{t('unconfirmed')}</p>}
    <p>{t('use')}</p>
    <p>{t('removal')}</p>
  </details>
}
