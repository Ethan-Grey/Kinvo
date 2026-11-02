import { useEffect, useRef, useState, type RefObject } from 'react'
import { receiptObjectUrl } from '../../data/images'
import { CloseIcon, DocumentIcon, DownloadIcon } from '../../shared/icons'
import { Notice, Skeleton, Spinner } from '../../shared/ui'

/**
 * Receipts are fetched once per screen and shared between the thumbnail and
 * the full-screen view. They're private files, downloaded with the viewer's
 * own permissions (storage RLS: only the lender and borrower can read them).
 */
const cache = new Map<string, Promise<string>>()

function loadReceipt(path: string): Promise<string> {
  let pending = cache.get(path)
  if (!pending) {
    pending = receiptObjectUrl(path)
    pending.catch(() => cache.delete(path)) // try again next time
    cache.set(path, pending)
  }
  return pending
}

function useReceipt(path: string, enabled = true) {
  const [state, setState] = useState<{ path: string; url?: string; error?: string } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    loadReceipt(path).then(
      (url) => !cancelled && setState({ path, url }),
      (err: Error) => !cancelled && setState({ path, error: err.message }),
    )
    return () => {
      cancelled = true
    }
  }, [path, enabled])
  return state?.path === path ? state : null
}

/**
 * A small preview of a receipt. Tapping it opens the receipt full screen,
 * with a button to save it to the phone.
 */
export function ReceiptThumb({
  path,
  label,
  className = 'size-16',
}: {
  path: string
  label: string
  className?: string
}) {
  const receipt = useReceipt(path)
  const dialogRef = useRef<HTMLDialogElement>(null)

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        aria-label={`View ${label}`}
        className={`relative shrink-0 overflow-hidden rounded-2xl border border-line bg-ring-track transition hover:border-brand-ink active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-brand-ink ${className}`}
      >
        {receipt?.url ? (
          <img src={receipt.url} alt="" className="size-full object-cover" />
        ) : receipt?.error ? (
          <span className="flex size-full items-center justify-center text-ink-muted">
            <DocumentIcon />
          </span>
        ) : (
          <Skeleton className="size-full rounded-none" />
        )}
      </button>
      <ReceiptDialog dialogRef={dialogRef} path={path} label={label} />
    </>
  )
}

function ReceiptDialog({
  dialogRef,
  path,
  label,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>
  path: string
  label: string
}) {
  const [open, setOpen] = useState(false)
  const receipt = useReceipt(path, open)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const sync = () => setOpen(dialog.open)
    // showModal() doesn't fire an event, so watch the attribute.
    const observer = new MutationObserver(sync)
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] })
    return () => observer.disconnect()
  }, [dialogRef])

  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close()
      }}
      className="m-auto max-h-[92svh] w-[min(100%-1.5rem,42rem)] max-w-none rounded-3xl border border-line bg-surface p-3 text-ink open:animate-fade-in"
    >
      <div className="mb-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate px-2 font-semibold">{label}</p>
        {receipt?.url && (
          <a
            href={receipt.url}
            download={`kinvo-receipt-${path.split('/').pop() ?? 'image.jpg'}`}
            className="flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-semibold hover:border-brand-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
          >
            <DownloadIcon className="size-4" />
            Save
          </a>
        )}
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close"
          className="flex size-10 items-center justify-center rounded-full text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
        >
          <CloseIcon />
        </button>
      </div>
      {receipt?.error ? (
        <Notice tone="error">{receipt.error}</Notice>
      ) : receipt?.url ? (
        <img src={receipt.url} alt={label} className="max-h-[78svh] w-full rounded-2xl object-contain" />
      ) : (
        <div className="p-6">
          <Spinner label="Loading receipt…" />
        </div>
      )}
    </dialog>
  )
}
