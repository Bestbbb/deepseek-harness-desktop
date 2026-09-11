/** Live task state comes from the existing Session control stream; output is read only on request. */
import { useEffect, useRef, useState } from 'react'
import type { SessionJob } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TaskRead, TaskCancellation } from '../types.ts'
import type { DelegationProps } from './DelegationLauncher.tsx'
import css from './DelegationLauncher.module.css'

type Props = Pick<DelegationProps, 't' | 'useSessions' | 'readJob' | 'cancelJob'> & { sessionId: SessionId; generation: number }
type RowProps = Omit<Props, 'useSessions'> & { job: SessionJob }
const NO_JOBS: readonly SessionJob[] = []

/**
 * Render subagent tasks visible to the selected session without fetching or polling.
 * @param props - Session observations and explicitly invoked control callbacks.
 * @returns Current task rows, including terminal jobs retained by the registry.
 */
export function TaskList({ useSessions, ...props }: Props) {
  const jobs = useSessions(state => state.jobsBySession[props.sessionId]) ?? NO_JOBS
  const rows = jobs.filter(job => job.kind === 'subagent')
  return <section className={css.tasks} aria-label={props.t('tasks')}>
    <h3>{props.t('tasks')}</h3>
    {rows.length === 0 ? <p>{props.t('noTasks')}</p> : <ul>
      {rows.map(job => <TaskRow key={job.id} {...props} job={job} />)}
    </ul>}
  </section>
}

/** Each row's pending request is local to its session and connection keyed parent. */
function TaskRow({ job, sessionId, generation, t, readJob, cancelJob }: RowProps) {
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState<TaskRead | null>(null)
  const [cancel, setCancel] = useState<TaskCancellation | null>(null)
  const mounted = useRef(false)
  const pending = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const terminal = job.status !== 'running' && job.status !== 'stopping'
  const perform = async (kind: 'read' | 'cancel'): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setReview(false)
    try {
      if (kind === 'read') {
        const result = await readJob(sessionId, job.id, generation)
        if (mounted.current) setOutput(result)
      } else {
        const result = await cancelJob(sessionId, job.id, generation)
        if (mounted.current) setCancel(result)
      }
    } catch {
      if (mounted.current) {
        if (kind === 'read') setOutput({ kind: 'unavailable' })
        else setCancel('unconfirmed')
      }
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return <li className={css.task}>
    <strong>{job.label}</strong><code>{job.id}</code>
    <p>{t(`job.${job.status}`)}</p>
    {terminal
      ? <button type="button" disabled={busy} onClick={() => { void perform('read') }}>{t('readResult')}</button>
      : job.status === 'running' && <button type="button" disabled={busy} onClick={() => { setReview(true); setCancel(null) }}>{t('cancelTask')}</button>}
    {busy && <p role="status">{t('taskBusy')}</p>}
    {review && !terminal && <div role="group" aria-label={t('cancelReview')}>
      <p>{t('cancelWarning')}</p>
      <button type="button" disabled={busy} onClick={() => { void perform('cancel') }}>{t('confirmCancel')}</button>
      <button type="button" onClick={() => { setReview(false) }}>{t('keepTask')}</button>
    </div>}
    {cancel !== null && <p role={cancel === 'unconfirmed' ? 'alert' : 'status'}>{t(`cancel.${cancel}`)}</p>}
    {output?.kind === 'ready' && <div>
      {output.text === '' ? <p>{t('emptyResult')}</p> : <pre className={css.output}>{output.text}</pre>}
      {output.truncated && <p>{t('truncatedResult')}</p>}
    </div>}
    {output?.kind === 'pending' && <p role="status">{t('resultPending')}</p>}
    {output?.kind === 'unavailable' && <p role="alert">{t('resultUnavailable')}</p>}
  </li>
}
