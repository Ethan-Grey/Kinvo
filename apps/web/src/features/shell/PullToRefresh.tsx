import { useEffect, useRef, useState } from 'react'
import { useRefresh } from '../../shared/refresh'

/** How far to pull (in px) before letting go refreshes. */
const THRESHOLD = 70
const MAX_PULL = 110

/**
 * Pull down from the top of any screen to fetch fresh data, like a native
 * app. Installed web apps on iPhone don't get the browser's own pull to
 * refresh, so Kinvo provides one. Touch only; nothing changes for mouse users.
 */
export function PullToRefresh() {
  const { refresh } = useRefresh()
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const start = useRef<number | null>(null)
  const pullRef = useRef(0)

  useEffect(() => {
    function onStart(e: TouchEvent) {
      // Only from the very top, and not while a sheet or dialog is open.
      if (window.scrollY > 0 || document.querySelector('dialog[open]')) return
      start.current = e.touches[0]?.clientY ?? null
    }
    function onMove(e: TouchEvent) {
      if (start.current === null) return
      const dy = (e.touches[0]?.clientY ?? 0) - start.current
      // Resistance, so it feels like stretching rather than dragging.
      pullRef.current = dy > 0 ? Math.min(MAX_PULL, dy * 0.5) : 0
      setPull(pullRef.current)
    }
    function onEnd() {
      if (start.current === null) return
      start.current = null
      if (pullRef.current >= THRESHOLD) {
        setRefreshing(true)
        refresh()
        window.setTimeout(() => setRefreshing(false), 700)
      }
      pullRef.current = 0
      setPull(0)
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [refresh])

  const visible = refreshing || pull > 4
  const ready = pull >= THRESHOLD
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center pt-[calc(env(safe-area-inset-top)+0.5rem)]"
      style={{ transform: `translateY(${refreshing ? 24 : pull - 24}px)`, opacity: visible ? 1 : 0 }}
    >
      <span className="flex size-10 items-center justify-center rounded-full border border-line bg-surface text-brand-ink shadow-md">
        <svg
          viewBox="0 0 24 24"
          className={`size-5 ${refreshing ? 'animate-spin' : ''}`}
          style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        >
          <path d="M20 12a8 8 0 1 1-2.3-5.6" />
          <path d="M20 4v5h-5" className={ready || refreshing ? 'opacity-100' : 'opacity-40'} />
        </svg>
      </span>
      <span className="sr-only">{refreshing ? 'Refreshing' : ''}</span>
    </div>
  )
}
