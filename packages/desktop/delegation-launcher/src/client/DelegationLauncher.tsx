/** One explicit review targets one observed session and connection; submissions are never replayed. */
import { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { TaskRead, TaskCancellation } from '../types.ts'
import { TaskList } from './TaskList.tsx'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionGenerationState } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createDelegationStore } from './store.ts'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import css from './DelegationLauncher.module.css'

/** A confirmed command outcome, distinct from completion of the delegated agent task. */
export type DelegationReceipt = { kind: 'success' | 'error'; text?: string }

/** Registration-owned reads and command submission; no service object reaches the component. */
export interface DelegationInjected {
  providers: () => Promise<string[]>
  submit: (sessionId: SessionId, provider: string, task: string) => Promise<DelegationReceipt | null>
  readJob: (sessionId: SessionId, id: JobId, generation: number) => Promise<TaskRead>
  cancelJob: (sessionId: SessionId, id: JobId, generation: number) => Promise<TaskCancellation>
  hooks: { connectionGeneration: ConnectionGenerationState }
}

/** Sidebar owner, shared visibility and renderer-bound session observations. */
export type DelegationProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'desktop.delegationLauncher'>
  & PropsStore<ReturnType<typeof createDelegationStore>> & InjectFace<DelegationInjected>

type Providers = { generation: number | undefined } & (
  | { kind: 'loading' | 'error' } | { kind: 'ready'; names: string[] }
)

/** @param props - Localized editor and injected commands. @returns An opt-in sidebar launcher and task review. */
export function DelegationLauncher({
  wide, t, useStore, actions, useSessions, useConnectionGeneration, providers, submit, readJob, cancelJob,
}: DelegationProps) {
  const open = useStore(state => state.open)
  const session = useSessions(state => state.current === undefined ? undefined : state.byId[state.current])
  const generation = useConnectionGeneration(value => value?.id)
  const [read, setRead] = useState<Providers>({ kind: 'loading', generation: undefined })
  const [revision, setRevision] = useState(0)
  const [provider, setProvider] = useState('')
  const [task, setTask] = useState('')
  const [consent, setConsent] = useState<{ sessionId: SessionId; generation: number; provider: string; task: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<{ sessionId: SessionId; generation: number; result: DelegationReceipt | null } | null>(null)
  const mounted = useRef(false)
  const submitting = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setConsent(null) }, [session?.id, generation])
  useEffect(() => {
    let live = true
    if (!open || generation === undefined) return () => { live = false }
    setRead({ kind: 'loading', generation })
    void providers().then(
      (names) => { if (live) setRead({ kind: 'ready', generation, names }) },
      () => { if (live) setRead({ kind: 'error', generation }) },
    )
    return () => { live = false }
  }, [open, generation, providers, revision])
  const names = read.kind === 'ready' && read.generation === generation ? read.names : []
  const authorized = consent !== null && consent.sessionId === session?.id && consent.generation === generation
    && consent.provider === provider && consent.task === task
  const valid = session !== undefined && generation !== undefined && names.includes(provider) && task.trim() !== '' && authorized && !busy
  const send = async (): Promise<void> => {
    if (!valid || submitting.current) return
    submitting.current = true
    setBusy(true)
    setReceipt(null)
    setConsent(null)
    try {
      const result = await submit(session.id, provider, task)
      if (mounted.current) setReceipt({ sessionId: session.id, generation, result })
    } catch {
      if (mounted.current) setReceipt({ sessionId: session.id, generation, result: null })
    } finally {
      submitting.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const close = () => { actions.setOpen(false); trigger.current?.focus() }
  const visibleReceipt = receipt?.sessionId === session?.id && receipt?.generation === generation ? receipt : null
  return <>
    <button type="button" className={css.trigger} ref={trigger} aria-label={t('title')} title={t('title')} onClick={() => { actions.setOpen(true) }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 12h7m-3-3 3 3-3 3m7-11h5v5h-5zm0 11h5v5h-5zM11 12l4-6m-4 6 4 6" /></svg>
      {wide && <span>{t('title')}</span>}
    </button>
    <Modal open={open} onClose={close} title={t('title')} headless className={clsx(css.dialog)}>
      <header className={css.header}>
        <h2>{t('title')}</h2>
        <button type="button" aria-label={t('close')} onClick={close}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
        </button>
      </header>
      <div className={css.content}>
        <p className={css.intro}>{t('intro')}</p>
        <div className={css.body} data-delegation-launcher>
          {session === undefined ? <p role="status">{t('noSession')}</p> : <p>{t('destination')}: <strong>{session.displayTitle}</strong><br /><code>{session.cwd}</code></p>}
          {session !== undefined && generation !== undefined && <TaskList key={`${session.id}:${generation}`}
            sessionId={session.id} generation={generation} t={t} useSessions={useSessions} readJob={readJob} cancelJob={cancelJob} />}
          {generation === undefined ? <p role="status">{t('disconnected')}</p>
            : read.kind === 'error' && read.generation === generation ? <p role="alert">{t('failed')}</p>
              : read.kind !== 'ready' || read.generation !== generation ? <p role="status">{t('loading')}</p>
                : names.length === 0 && <p role="status">{t('empty')}</p>}
          <label htmlFor={`${id}-provider`}>{t('provider')}</label>
          <select id={`${id}-provider`} value={names.includes(provider) ? provider : ''} disabled={busy || generation === undefined} onChange={(event) => { setProvider(event.target.value); setConsent(null); setReceipt(null) }}>
            <option value="">{t('choose')}</option>{names.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <button type="button" disabled={busy || generation === undefined} onClick={() => { setRevision(value => value + 1); setConsent(null) }}>{t('refresh')}</button>
          <label htmlFor={`${id}-task`}>{t('task')}</label>
          <textarea id={`${id}-task`} value={task} disabled={busy} placeholder={t('placeholder')} onChange={(event) => { setTask(event.target.value); setConsent(null); setReceipt(null) }} />
          <fieldset><legend>{t('risk')}</legend><label>
            <input type="checkbox" checked={authorized} disabled={busy || session === undefined || generation === undefined}
              onChange={(event) => {
                setConsent(event.target.checked && session !== undefined && generation !== undefined
                  ? { sessionId: session.id, generation, provider, task } : null)
              }} />
            {t('consent')}
          </label></fieldset>
          <button type="button" disabled={!valid} onClick={() => { void send() }}>{t(busy ? 'sending' : 'send')}</button>
          {visibleReceipt !== null && <div role={visibleReceipt.result?.kind === 'success' ? 'status' : 'alert'}>
            <p>{t(visibleReceipt.result === null ? 'unconfirmed' : 'submitted')}</p>
            {visibleReceipt.result?.text !== undefined && <p>{visibleReceipt.result.text}</p>}
          </div>}
        </div>
      </div>
    </Modal>
  </>
}
