import { useCallback, useEffect, useRef, useState } from 'react'
import { useRefresh } from './refresh'

export type AsyncState<T> = { status: 'loading' } | { status: 'success'; data: T } | { status: 'error'; error: Error }

type Settled<T> = Exclude<AsyncState<T>, { status: 'loading' }>

/**
 * Runs `load` and tracks its result. It re-runs whenever `key` changes, when
 * `reload()` is called (e.g. after creating something), and whenever the app
 * refreshes (a live update arrives, the app reopens, or the user pulls down).
 *
 * A new `key` (a different loan, say) shows loading. A reload or refresh of
 * the same key keeps showing the current data until the new data arrives, so
 * the screen updates in place instead of flashing.
 *
 * Deliberately small. If data needs grow (caching, background refresh), this
 * is the one place to swap in a library like TanStack Query.
 */
export function useAsync<T>(load: () => Promise<T>, key = '') {
  const { generation } = useRefresh()
  const [version, setVersion] = useState(0)
  const requestKey = `${key}#${version}#${generation}`
  const [result, setResult] = useState<{ key: string; state: Settled<T> } | null>(null)

  // Always call the latest `load` without making it an effect dependency.
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    let cancelled = false
    loadRef.current().then(
      (data) => {
        if (!cancelled) setResult({ key, state: { status: 'success', data } })
      },
      (error: unknown) => {
        if (cancelled) return
        const err = error instanceof Error ? error : new Error(String(error))
        // A failed background refresh (e.g. briefly offline) keeps what's on screen.
        setResult((prev) =>
          prev?.key === key && prev.state.status === 'success' ? prev : { key, state: { status: 'error', error: err } },
        )
      },
    )
    return () => {
      cancelled = true
    }
    // `key` is part of requestKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  // A result for a different key is stale, so show loading until the new one arrives.
  const state: AsyncState<T> = result?.key === key ? result.state : { status: 'loading' }
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return [state, reload] as const
}
