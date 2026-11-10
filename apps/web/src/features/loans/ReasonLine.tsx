import { useState, type FormEvent } from 'react'
import { setLoanReason } from '../../data/loans'
import { Button } from '../../shared/ui'

/**
 * What the loan is for, as one line under the title. Either person can add it
 * later or change it, right here.
 */
export function ReasonLine({
  loanId,
  reason,
  onSaved,
}: {
  loanId: string
  reason: string | null
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(reason ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return setError('Say what it’s for.')
    setBusy(true)
    setError(null)
    try {
      await setLoanReason(loanId, text)
      setEditing(false)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <form onSubmit={save} className="mt-2 space-y-2" noValidate>
        <label className="sr-only" htmlFor="loan-reason">
          What it’s for
        </label>
        <input
          id="loan-reason"
          autoFocus
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Car repairs"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'loan-reason-error' : undefined}
          className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
        />
        {error && (
          <p id="loan-reason-error" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" busy={busy} className="min-h-10 px-4">
            Save
          </Button>
          <Button
            variant="secondary"
            className="min-h-10 px-4"
            onClick={() => {
              setText(reason ?? '')
              setError(null)
              setEditing(false)
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="-mx-1 mt-1 min-h-9 rounded-lg px-1 text-left break-words hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
    >
      {reason ? (
        <>
          For {reason} <span className="sr-only">(change what it’s for)</span>
        </>
      ) : (
        <span className="font-medium text-brand-ink">Add what it’s for</span>
      )}
    </button>
  )
}
