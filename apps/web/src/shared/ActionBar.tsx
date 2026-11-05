import { useEffect, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { CloseIcon } from './icons'

/**
 * A page's main buttons, fixed to the bottom of the screen just above the tab
 * bar. A spacer of the same height keeps the end of the page from hiding
 * behind it.
 */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <>
      <div aria-hidden="true" className="h-12" />
      <div
        className={
          'fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-10 ' +
          'bg-gradient-to-t from-canvas from-85% to-transparent pt-5 pb-8'
        }
      >
        <div className="mx-auto flex max-w-2xl gap-2 px-4 [&>*]:flex-1">{children}</div>
      </div>
    </>
  )
}

export interface Choice {
  label: string
  /** A page to open. */
  to?: string
  /** Or something to run. The sheet closes first. */
  run?: () => Promise<void> | void
  danger?: boolean
  hint?: string
}

/** A bottom sheet of follow-up choices, e.g. after tapping Decline. */
export function ChoiceSheet({
  open,
  title,
  choices,
  onClose,
}: {
  open: boolean
  title: string
  choices: Choice[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby="choice-sheet-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={
        'fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none bg-transparent p-0 text-ink ' +
        'open:animate-sheet-up sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md'
      }
    >
      {open && (
        <div className="rounded-t-3xl border border-line bg-surface px-5 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:rounded-3xl">
          <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-ring-track sm:hidden" />
          <div className="flex items-center justify-between">
            <h2 id="choice-sheet-title" className="text-xl font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-10 items-center justify-center rounded-full text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
            >
              <CloseIcon />
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {choices.map((c) => (
              <li key={c.label}>
                <button
                  type="button"
                  onClick={async () => {
                    onClose()
                    if (c.to) navigate(c.to)
                    else await c.run?.()
                  }}
                  className={
                    'flex min-h-14 w-full flex-col items-start justify-center rounded-2xl border border-line px-4 py-2 text-left ' +
                    'font-semibold transition hover:border-brand-ink focus-visible:outline-2 focus-visible:outline-brand-ink ' +
                    (c.danger ? 'text-danger hover:border-danger' : '')
                  }
                >
                  {c.label}
                  {c.hint && <span className="text-sm font-normal text-ink-muted">{c.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </dialog>
  )
}
