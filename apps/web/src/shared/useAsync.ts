import { useCallback, useEffect, useRef, useState } from 'react'

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error }

type Settled<T> = Exclude<AsyncState<T>, { status: 'loading' }>

/**
 * Runs `load` and tracks its result. It re-runs whenever `key` changes, or
 * when `reload()` is called (e.g. after creating something).
 *
 * Deliberately small. If data needs grow (caching, background refresh), this
 * is the one place to swap in a library like TanStack Query.
 */
export function useAsync<T>(load: () => Promise<T>, key = '') {
  const [version, setVersion] = useState(0)
  const requestKey = `${key}#${version}`
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
        if (!cancelled) setResult({ key: requestKey, state: { status: 'success', data } })
      },
      (error: unknown) => {
        if (cancelled) return
        const err = error instanceof Error ? error : new Error(String(error))
        setResult({ key: requestKey, state: { status: 'error', error: err } })
      },
    )
    return () => {
      cancelled = true
    }
  }, [requestKey])

  // A result for an older key is stale, so show loading until the new one arrives.
  const state: AsyncState<T> = result?.key === requestKey ? result.state : { status: 'loading' }
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return [state, reload] as const
}
