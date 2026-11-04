import { useEffect, useId, useRef, useState } from 'react'
import { cleanImage, imageFromClipboard, ReceiptError, uploadReceipt } from '../../data/images'
import { CloseIcon, DocumentIcon } from '../../shared/icons'
import { Button, Notice, Spinner } from '../../shared/ui'

/**
 * Add the receipt: choose a photo, or paste one (e.g. a statement image copied
 * from the bank app). The image is cleaned and uploaded straight away, and
 * `onChange` gets its storage path, or null when removed.
 */
export function ReceiptField(
  props:
    | { loanId: string; onChange: (path: string | null) => void }
    /** Not uploaded yet (e.g. a bill split before its debts exist): get the cleaned image instead. */
    | { onImage: (jpeg: Blob | null) => void },
) {
  const inputId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview],
  )

  async function accept(file: Blob) {
    setBusy(true)
    setError(null)
    try {
      const jpeg = await cleanImage(file)
      if ('onImage' in props) {
        props.onImage(jpeg)
      } else {
        props.onChange(await uploadReceipt(props.loanId, jpeg))
      }
      setPreview(URL.createObjectURL(jpeg))
    } catch (err) {
      setError(err instanceof ReceiptError || err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Pasting anywhere on the page works too (e.g. ⌘V on a computer).
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (file) {
        event.preventDefault()
        void accept(file)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  async function handlePaste() {
    setError(null)
    try {
      const image = await imageFromClipboard()
      if (image) await accept(image)
      else setError('There’s no image to paste. Copy the statement image first, then tap Paste.')
    } catch {
      setError('Pasting isn’t allowed here. Choose the photo instead.')
    }
  }

  function remove() {
    setPreview(null)
    if ('onImage' in props) props.onImage(null)
    else props.onChange(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  if (preview) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-line">
        <img src={preview} alt="Receipt you added" className="max-h-72 w-full object-contain" />
        <button
          type="button"
          onClick={remove}
          aria-label="Remove receipt"
          className="absolute top-2 right-2 flex size-10 items-center justify-center rounded-full bg-surface text-ink shadow focus-visible:outline-2 focus-visible:outline-brand-ink"
        >
          <CloseIcon className="size-5" />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-line px-4 py-6 text-center">
        {busy ? (
          <Spinner label="Adding receipt…" />
        ) : (
          <>
            <DocumentIcon className="size-8 text-ink-muted" />
            <p className="text-sm text-ink-muted">A photo or screenshot of the receipt or bank statement.</p>
            <div className="grid w-full grid-cols-2 gap-2">
              <label
                htmlFor={inputId}
                className="flex min-h-12 cursor-pointer items-center justify-center rounded-2xl border border-line font-semibold hover:border-brand-ink focus-within:outline-2 focus-within:outline-brand-ink"
              >
                Choose photo
                <input
                  ref={fileRef}
                  id={inputId}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void accept(file)
                  }}
                />
              </label>
              <Button variant="secondary" onClick={handlePaste}>
                Paste
              </Button>
            </div>
          </>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}
