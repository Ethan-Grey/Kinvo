/**
 * Small set of UI building blocks. Every screen uses these, so spacing,
 * colours and focus styles stay consistent.
 */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useId } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:opacity-90',
  secondary: 'border border-line bg-surface text-ink hover:border-brand-ink',
  ghost: 'text-ink-muted hover:text-ink',
  danger: 'border border-line bg-surface text-danger hover:border-danger',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  busy?: boolean
}

export function Button({
  variant = 'primary',
  busy = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium ' +
        'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink ' +
        'disabled:cursor-not-allowed disabled:opacity-60 ' +
        `${BUTTON_STYLES[variant]} ${className}`
      }
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span role={label ? 'status' : undefined} className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
      />
      {label && <span className="text-sm text-ink-muted">{label}</span>}
    </span>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-5 shadow-sm ${className}`}>
      {children}
    </section>
  )
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
}

export function TextField({ label, hint, className = '', ...rest }: TextFieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hintId}
        className={
          'mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base ' +
          'placeholder:text-ink-muted/70 focus:border-brand-ink focus:outline-2 focus:outline-brand/20'
        }
        {...rest}
      />
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  )
}

const FIELD_CLASS =
  'mt-1.5 block w-full rounded-xl border border-line bg-surface px-3 text-base ' +
  'placeholder:text-ink-muted/70 focus:border-brand-ink focus:outline-2 focus:outline-brand/20'

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  hint?: string
}

export function TextArea({ label, hint, className = '', ...rest }: TextAreaProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <textarea id={id} aria-describedby={hintId} rows={3} className={`${FIELD_CLASS} py-2`} {...rest} />
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  )
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: readonly { value: string; label: string }[]
}

export function Select({ label, options, className = '', ...rest }: SelectProps) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select id={id} className={`${FIELD_CLASS} min-h-11`} {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

type BadgeTone = 'neutral' | 'brand' | 'positive' | 'warning' | 'danger'

const BADGE_STYLES: Record<BadgeTone, string> = {
  neutral: 'border border-line text-ink-muted',
  brand: 'bg-brand-soft text-on-brand-soft',
  positive: 'bg-positive text-on-positive',
  warning: 'bg-attention text-on-attention',
  danger: 'bg-danger text-on-danger',
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_STYLES[tone]}`}>
      {children}
    </span>
  )
}

type NoticeTone = 'info' | 'success' | 'error'

const NOTICE_STYLES: Record<NoticeTone, string> = {
  info: 'bg-brand-soft text-on-brand-soft',
  success: 'border border-positive text-positive',
  error: 'border border-danger text-danger',
}

export function Notice({ tone = 'info', children }: { tone?: NoticeTone; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl px-4 py-3 text-sm ${NOTICE_STYLES[tone]}`}
    >
      {children}
    </div>
  )
}

/** Full-screen centred loading state. */
export function FullPageSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center text-brand-ink">
      <Spinner label={label} />
    </div>
  )
}

export function Logo({ className = 'size-9' }: { className?: string }) {
  return <img src="/favicon.svg" alt="" className={`${className} rounded-xl`} />
}

type StatTone = 'default' | 'brand' | 'danger'

const STAT_VALUE: Record<StatTone, string> = {
  default: 'text-ink',
  brand: 'text-brand-ink',
  danger: 'text-danger',
}

/** A labelled figure for dashboards, e.g. "Owed to you · $150.00". */
export function Stat({ label, value, hint, tone = 'default' }: { label: string; value: string; hint?: string; tone?: StatTone }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`truncate text-xl font-semibold tabular-nums ${STAT_VALUE[tone]}`}>{value}</p>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}
