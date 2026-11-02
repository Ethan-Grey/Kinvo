import { formatDate } from '../../domain/dates'
import { formatCents } from '../../domain/money'
import { chargePercent } from '../../domain/schedule'
import type { TermsVersion } from '../../data/loans'

/**
 * The full terms of one version, laid out as the agreement both people see
 * (AG-01): amount, charge, total, every payment, and any conditions.
 */
export function TermsSummary({
  terms,
  lenderName,
  borrowerName,
}: {
  terms: TermsVersion
  lenderName: string
  borrowerName: string
}) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-2 tabular-nums">
        <Figure label={`${lenderName.split(' ')[0]} lends`} value={formatCents(terms.principalCents)} />
        <Figure
          label={`Charge (${chargePercent(terms.principalCents, terms.chargeCents)})`}
          value={formatCents(terms.chargeCents)}
        />
        <Figure label={`${borrowerName.split(' ')[0]} repays`} value={formatCents(terms.totalCents)} strong />
      </dl>

      <div>
        <h2 className="font-sans text-sm font-semibold">Repayment schedule</h2>
        <ol className="mt-2 space-y-1.5 text-sm tabular-nums">
          {terms.instalments.map((instalment, index) => (
            <li key={instalment.dueOn} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-on-brand-soft"
              >
                {index + 1}
              </span>
              <span className="flex-1">{formatDate(instalment.dueOn)}</span>
              <span className="font-semibold">{formatCents(instalment.amountCents)}</span>
            </li>
          ))}
        </ol>
      </div>

      <Clause title="If a payment is late" text={terms.lateTerms || 'No late-payment terms. No late fees apply.'} />
      {terms.conditions && <Clause title="Other conditions" text={terms.conditions} />}
    </div>
  )
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`min-w-0 rounded-2xl p-3 ${strong ? 'bg-brand text-on-brand' : 'border border-line'}`}>
      <dt className={`truncate text-xs ${strong ? 'text-on-brand-muted' : 'text-ink-muted'}`}>{label}</dt>
      <dd className="mt-0.5 truncate font-display text-lg font-semibold">{value}</dd>
    </div>
  )
}

function Clause({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h2 className="font-sans text-sm font-semibold">{title}</h2>
      <p className="mt-1 whitespace-pre-line text-sm">{text}</p>
    </div>
  )
}
