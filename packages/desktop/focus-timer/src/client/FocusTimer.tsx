/** Component-owned timer state survives closing its panel, but not unmount or page reload. */
import { useEffect, useId, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FocusTimerSettings } from '../settings.ts'
import type { createFocusTimerStore } from './store.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import styles from './FocusTimer.module.css'

type Timer = { phase: 'idle' } | { phase: 'running'; deadline: number; remaining: number }
  | { phase: 'paused'; remaining: number } | { phase: 'done'; remaining: 0 }

/** Existing settings scope observed through renderer-bound hooks; writes use the displayed revision. */
export interface FocusTimerInjected {
  hooks: { preference: Pick<SettingsScope<FocusTimerSettings>, 'getSnapshot' | 'subscribe'> }
  /** Resolve true only when the settled Host observation contains the requested duration. */
  savePreference: (minutes: number | null, revision: number) => Promise<boolean>
}

/** Sidebar owner values and the framework-owned translator. */
export type FocusTimerProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'desktop.focusTimer'>
  & PropsStore<ReturnType<typeof createFocusTimerStore>> & InjectFace<FocusTimerInjected>

/**
 * Render an opt-in, second-resolution local timer. Wall-clock deadlines catch up after throttling or sleep.
 * @param props - sidebar geometry and localized labels.
 * @returns The sidebar button and its optional dialog.
 */
export function FocusTimer({ wide, t, useStore, actions, usePreference, savePreference }: FocusTimerProps) {
  const open = useStore(state => state.open)
  const preference = usePreference(state => state)
  const [draft, setDraft] = useState<string | null>(null)
  const saved = preference.status === 'ready' ? preference.value?.minutes : undefined
  const minutes = draft ?? (saved === undefined ? '' : String(saved))
  const [saving, setSaving] = useState(false)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const savingRef = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [timer, setTimer] = useState<Timer>({ phase: 'idle' })
  const trigger = useRef<HTMLButtonElement>(null)
  const inputId = useId()
  const duration = Number(minutes)
  const valid = Number.isInteger(duration) && duration >= 1 && duration <= 1440
  const deadline = timer.phase === 'running' ? timer.deadline : null

  useEffect(() => {
    if (deadline === null) return
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setTimer(remaining === 0 ? { phase: 'done', remaining: 0 } : { phase: 'running', deadline, remaining })
    }, 1000)
    return () => { clearInterval(interval) }
  }, [deadline])

  const remaining = timer.phase === 'idle' ? (valid ? duration * 60 : 0) : timer.remaining
  const formatted = t('remaining', { minutes: Math.floor(remaining / 60), seconds: String(remaining % 60).padStart(2, '0') })
  const active = timer.phase === 'running' || timer.phase === 'paused'
  const writable = preference.status === 'ready' && preference.mode === 'host' && preference.writable && preference.revision !== undefined
  const save = async (value: number | null): Promise<void> => {
    if (savingRef.current || !writable || preference.revision === undefined) return
    savingRef.current = true
    setSaving(true)
    setUnconfirmed(false)
    try {
      const confirmed = await savePreference(value, preference.revision)
      if (mounted.current) {
        setUnconfirmed(!confirmed)
        if (confirmed) setDraft(null)
      }
    } catch {
      // Transport failures cannot confirm persistence; retain the user's draft.
      if (mounted.current) setUnconfirmed(true)
    } finally {
      savingRef.current = false
      if (mounted.current) setSaving(false)
    }
  }
  const close = () => { actions.setOpen(false); trigger.current?.focus() }
  const start = () => {
    setDraft(minutes)
    const seconds = timer.phase === 'paused' ? timer.remaining : duration * 60
    setTimer({ phase: 'running', deadline: Date.now() + seconds * 1000, remaining: seconds })
  }

  return <>
    <button type="button" ref={trigger} className={styles.trigger} onClick={() => { actions.setOpen(true) }}
      aria-label={active ? t('badge', { time: formatted }) : t('title')} title={t('title')}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="12" cy="13" r="8" /><path d="M9 2h6m-3 3v-3m0 7v4l3 2" />
      </svg>
      {wide && <span>{active ? formatted : t('title')}</span>}
      {timer.phase === 'done' && <span className={styles.done} aria-label={t('done')}>✓</span>}
    </button>
    <Modal open={open} onClose={close} title={t('title')} closeLabel={t('close')} description={t('description')}>
      <div className={styles.body} data-focus-timer>
        <output role="timer" aria-live="off" className={styles.time}>{formatted}</output>
        <p role="status">{t(timer.phase)}</p>
        <label htmlFor={inputId}>{t('minutes')}</label>
        <input id={inputId} autoFocus type="number" min="1" max="1440" step="1" value={minutes} disabled={active || saving}
          onChange={(event) => { setDraft(event.target.value); setUnconfirmed(false) }} aria-describedby={`${inputId}-limit`} />
        <p id={`${inputId}-limit`} className={styles.hint}>{t('limit')}</p>
        <div className={styles.actions}>
          {timer.phase === 'running'
            ? <Button variant="primary" onClick={() => {
              const seconds = Math.max(0, Math.ceil((timer.deadline - Date.now()) / 1000))
              setTimer(seconds === 0 ? { phase: 'done', remaining: 0 } : { phase: 'paused', remaining: seconds })
            }}>{t('pause')}</Button>
            : <Button variant="primary" disabled={!valid || saving} onClick={start}>{t(timer.phase === 'paused' ? 'resume' : 'start')}</Button>}
          <Button variant="outline" disabled={timer.phase === 'idle'} onClick={() => { setTimer({ phase: 'idle' }) }}>{t('reset')}</Button>
        </div>
        <fieldset className={styles.preference}>
          <legend>{t('preference')}</legend>
          <p className={styles.hint}>{t('preferenceHint')}</p>
          <p>{t(preference.status === 'loading' ? 'loadingPreference' : !writable ? 'unavailablePreference'
            : saved === undefined ? 'noPreference' : 'savedPreference', { minutes: saved ?? '' })}</p>
          <div className={styles.actions}>
            <Button variant="outline" disabled={!writable || active || saving || !valid || duration === saved}
              onClick={() => { void save(duration) }}>{t(saving ? 'savingPreference' : 'savePreference')}</Button>
            <Button variant="outline" disabled={!writable || active || saving || saved === undefined}
              onClick={() => { void save(null) }}>{t('clearPreference')}</Button>
          </div>
          {unconfirmed && <p role="alert">{t('unconfirmedPreference')}</p>}
        </fieldset>
        <p className={styles.hint}>{t('lifetime')}</p>
      </div>
    </Modal>
  </>
}
