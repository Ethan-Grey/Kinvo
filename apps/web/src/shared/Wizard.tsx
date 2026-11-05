/**
 * Building blocks for "one question per screen" flows (new loan, change
 * terms, record a payment). Each step asks one thing, shows how far along
 * you are, and has Back and Continue in the same place every time.
 */
import { useEffect, useId, useRef, type ReactNode, type Ref } from 'react'
import { ActionBar } from './ActionBar'
import { Button, Notice } from './ui'

export function WizardStep({
  step,
  of,
  title,
  hint,
  children,
  errors = [],
  onBack,
  backLabel = 'Back',
  next,
}: {
  /** 1-based position, for "Step 2 of 4". */
  step: number
  of: number
  title: string
  hint?: ReactNode
  children: ReactNode
  errors?: readonly string[]
  onBack?: () => void
  backLabel?: string
  /** The main button: Continue on most steps, the final action on the last. */
  next: { label: string; onClick?: () => void; submit?: boolean; busy?: boolean }
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const firstStep = useRef(step)

  // Moving to a new step puts focus (and screen readers) on its question and
  // scrolls it into view. Not on first render, so opening a flow doesn't jump.
  useEffect(() => {
    if (step === firstStep.current) return
    firstStep.current = -1
    headingRef.current?.focus({ preventScroll: true })
    headingRef.current?.scrollIntoView?.({ block: 'center' })
  }, [step])

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {Array.from({ length: of }, (_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-brand' : 'bg-ring-track'}`} />
          ))}
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          Step {step} of {of}
        </p>
        <h2 ref={headingRef} tabIndex={-1} className="mt-1 text-2xl leading-tight font-semibold outline-none">
          {title}
        </h2>
        {hint && <div className="mt-1 text-sm text-ink-muted">{hint}</div>}
      </div>

      <div className="space-y-5">{children}</div>

      {errors.length > 0 && (
        <Notice tone="error">
          {errors.length === 1 ? (
            errors[0]
          ) : (
            <ul className="list-inside list-disc space-y-0.5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      <ActionBar>
        {onBack && (
          <Button variant="secondary" className="!flex-none" onClick={onBack} disabled={next.busy}>
            {backLabel}
          </Button>
        )}
        <Button
          type={next.submit ? 'submit' : 'button'}
          busy={next.busy}
          onClick={next.submit ? undefined : next.onClick}
        >
          {next.label}
        </Button>
      </ActionBar>
    </div>
  )
}

/** A large dollar amount field: the one thing a money step asks for. */
export function MoneyField({
  label,
  value,
  onChange,
  hint,
  autoFocus = false,
  inputRef,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: ReactNode
  autoFocus?: boolean
  inputRef?: Ref<HTMLInputElement>
}) {
  const id = useId()
  return (
    <div>
      {/* The step's question says what to enter, so the label is for screen readers. */}
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex items-center rounded-2xl border border-line px-4 focus-within:border-brand-ink focus-within:outline-2 focus-within:outline-brand/20">
        <span aria-hidden="true" className="font-display text-4xl font-semibold text-ink-muted">
          $
        </span>
        <input
          ref={inputRef}
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
          placeholder="0"
          className="min-h-20 w-full bg-transparent pl-1 font-display text-4xl font-semibold tabular-nums outline-none placeholder:text-ink-muted/50"
        />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  )
}

/** Pill buttons that fill in a value with one tap. */
export function QuickPicks<T>({
  label,
  options,
  isActive,
  onPick,
}: {
  label: string
  options: readonly { label: string; value: T }[]
  isActive: (value: T) => boolean
  onPick: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = isActive(option.value)
        return (
          <button
            key={option.label}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(option.value)}
            className={
              'min-h-10 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-brand-ink ' +
              (active ? 'bg-brand text-on-brand' : 'border border-line hover:border-brand-ink')
            }
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** "−  3  +" for small whole numbers, like how many payments. */
export function CountStepper({
  label,
  value,
  min,
  max,
  onChange,
  unit,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  unit: (n: number) => string
}) {
  const id = useId()
  return (
    <div>
      <p id={id} className="text-sm font-medium">
        {label}
      </p>
      <div role="group" aria-labelledby={id} className="mt-1.5 flex items-center gap-3">
        <button
          type="button"
          aria-label={`Fewer ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          className="flex size-12 items-center justify-center rounded-full border border-line text-2xl font-semibold disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-brand-ink"
        >
          −
        </button>
        <output aria-live="polite" className="min-w-24 text-center font-display text-2xl font-semibold tabular-nums">
          {value} <span className="text-base font-normal text-ink-muted">{unit(value)}</span>
        </output>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          className="flex size-12 items-center justify-center rounded-full border border-line text-2xl font-semibold disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-brand-ink"
        >
          +
        </button>
      </div>
    </div>
  )
}
