/** On-demand preparation observations; activation remains owned by native Profile selection. */
import { useEffect, useState, type ReactNode } from 'react'
import type { PreparationOperation } from '@deepseek-ai/dsh-bundle-preparation/types'
import type { MarketplaceProps } from './MarketplaceTab.tsx'
import css from './MarketplaceTab.module.css'

/**
 * Read once per mounted connection/refresh key; discard settlements after replacement or unmount.
 * @param props - Connected state, read-only journal callback and locale-owned labels.
 * @returns Journal observations or an explicit unavailable state, without mutation actions.
 */
export function OperationHistory({ connected, history, t }: Pick<MarketplaceProps, 'history' | 't'> & { connected: boolean }): ReactNode {
  const [read, setRead] = useState<readonly PreparationOperation[] | 'loading' | 'error'>('loading')
  useEffect(() => {
    let live = true
    if (connected) void history().then(
      (value) => { if (live) setRead(value) },
      () => { if (live) setRead('error') },
    )
    return () => { live = false }
  }, [connected, history])
  if (!connected) return <p role="status">{t('offline')}</p>
  if (read === 'loading') return <p role="status">{t('historyLoading')}</p>
  if (read === 'error') return <p role="alert">{t('historyFailed')}</p>
  if (read.length === 0) return <p role="status">{t('historyEmpty')}</p>
  return <ul className={css.list}>{read.map((operation) => {
    const bundle = operation.entry ?? operation.removed
    return <li className={css.card} key={operation.id}>
      <div>
        <h4>{operation.entry?.title ?? operation.removed?.packageName ?? t('historyUnknown')}</h4>
        {bundle && <p><code>{bundle.packageName}</code> · {bundle.version}</p>}
        {operation.kind !== undefined && <p>{t(`operation-${operation.kind}`)}</p>}
        <p>{t(`operation-${operation.state}`)}</p>
        {operation.startedAt !== undefined && <time dateTime={operation.startedAt}>{operation.startedAt}</time>}
        <details className={css.current}><summary>{t('operationId')}</summary><code>{operation.id}</code></details>
      </div>
    </li>
  })}</ul>
}
