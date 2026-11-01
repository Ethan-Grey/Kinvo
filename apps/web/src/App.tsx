import { formatCents, toCents } from './domain/money'

/**
 * Placeholder home screen for milestone 1. It proves the build, styling and
 * domain layer are wired together. Replaced by the real app shell in M2.
 */
export default function App() {
  const example = {
    principal: toCents(20000),
    charge: toCents(2000),
  }
  const total = toCents(example.principal + example.charge)

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-8 px-4 py-12">
      <header className="flex items-center gap-3">
        <img src="/favicon.svg" alt="" className="size-10 rounded-xl" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kinvo</h1>
          <p className="text-sm text-ink-muted">A private lending ledger for families.</p>
        </div>
      </header>

      <section
        aria-labelledby="example-heading"
        className="rounded-2xl border border-line bg-surface p-5 shadow-sm"
      >
        <h2 id="example-heading" className="text-sm font-medium text-ink-muted">
          Example loan
        </h2>
        <dl className="mt-4 space-y-2 tabular-nums">
          <Row label="Borrowed" value={formatCents(example.principal)} />
          <Row label="One-off charge" value={formatCents(example.charge)} />
          <div className="border-t border-line pt-2">
            <Row label="Total to repay" value={formatCents(total)} emphasis />
          </div>
        </dl>
      </section>

      <p className="text-center text-xs text-ink-muted">In development · fictional data only</p>
    </main>
  )
}

interface RowProps {
  label: string
  value: string
  emphasis?: boolean
}

function Row({ label, value, emphasis = false }: RowProps) {
  return (
    <div className="flex justify-between">
      <dt className={emphasis ? 'font-medium' : 'text-ink-muted'}>{label}</dt>
      <dd className={emphasis ? 'text-lg font-semibold text-brand' : ''}>{value}</dd>
    </div>
  )
}
