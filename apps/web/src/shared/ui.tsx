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
import { Link } from 'react-router'
import { BackIcon } from './icons'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand shadow-[0_6px_16px_-6px_rgb(97_61_193/0.6)] hover:opacity-95',
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
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[0.95rem] font-semibold ' +
        'transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink ' +
        'active:scale-[0.98] ' +
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
  return <section className={`rounded-3xl border border-line bg-surface p-5 ${className}`}>{children}</section>
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
          'mt-1.5 block min-h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base ' +
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
  'mt-1.5 block w-full rounded-2xl border border-line bg-surface px-4 text-base ' +
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
      <select id={id} className={`${FIELD_CLASS} min-h-12`} {...rest}>
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
  positive: 'border border-positive text-positive',
  warning: 'bg-attention text-on-attention',
  danger: 'bg-danger text-on-danger',
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${BADGE_STYLES[tone]}`}
    >
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
      className={`rounded-2xl px-4 py-3 text-sm ${NOTICE_STYLES[tone]}`}
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
export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: StatTone
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`truncate font-display text-xl font-semibold tabular-nums ${STAT_VALUE[tone]}`}>{value}</p>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}

/**
 * Top of a screen: an optional back link, the title, and an optional action
 * on the right. Every screen has one, so titles sit in the same place.
 */
export function PageHeader({
  title,
  back,
  subtitle,
  action,
}: {
  title: ReactNode
  back?: { to: string; label: string }
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <header className="space-y-3">
      {back && <BackLink to={back.to} label={back.label} />}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] leading-tight font-semibold">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-ink-muted">{subtitle}</div>}
        </div>
        {action}
      </div>
    </header>
  )
}

/** "‹ Loans" at the top left of a screen. */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="-ml-2 inline-flex min-h-10 items-center gap-1 rounded-xl px-2 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
    >
      <BackIcon className="size-4" />
      {label}
    </Link>
  )
}

/** A heading inside a page, with an optional link on the right (e.g. "See all"). */
export function SectionHeader({ title, link }: { title: string; link?: { to: string; label: string } }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {link && (
        <Link to={link.to} className="text-sm font-medium text-brand-ink hover:underline">
          {link.label}
        </Link>
      )}
    </div>
  )
}

type BubbleTone = 'brand' | 'soft' | 'attention' | 'positive' | 'danger' | 'neutral'

const BUBBLE_STYLES: Record<BubbleTone, string> = {
  brand: 'bg-brand text-on-brand',
  soft: 'bg-brand-soft text-on-brand-soft',
  attention: 'bg-attention text-on-attention',
  positive: 'bg-positive text-on-positive',
  danger: 'bg-danger text-on-danger',
  neutral: 'border border-line text-ink-muted',
}

/** An icon in a coloured circle, used to say what kind of thing a row is. */
export function IconBubble({
  tone = 'soft',
  children,
  size = 'md',
}: {
  tone?: BubbleTone
  children: ReactNode
  size?: 'md' | 'lg'
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full ${size === 'lg' ? 'size-14' : 'size-10'} ${BUBBLE_STYLES[tone]}`}
    >
      {children}
    </span>
  )
}

/** What to show when a list is empty: what it's for, and what to do next. */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <IconBubble tone="soft" size="lg">
        {icon}
      </IconBubble>
      <p className="mt-4 font-display text-lg font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-xs text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Placeholder shapes while a screen loads, so the layout doesn't jump. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-2xl bg-ring-track ${className}`} />
}

export function PageSkeleton({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-5">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-40 w-full rounded-3xl" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

/** A row of pill buttons for choosing one option, e.g. loan filters. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: T; label: string; count?: number }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={
              'inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition ' +
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink ' +
              (selected ? 'bg-brand text-on-brand' : 'border border-line text-ink hover:border-brand-ink')
            }
          >
            {option.label}
            {option.count !== undefined && option.count > 0 && (
              <span className={`tabular-nums ${selected ? 'text-on-brand-muted' : 'text-ink-muted'}`}>
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
