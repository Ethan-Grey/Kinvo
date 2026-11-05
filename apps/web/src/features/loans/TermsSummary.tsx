import { formatDate } from '../../domain/dates'
import { formatCents } from '../../domain/money'
import type { TermsVersion } from '../../data/loans'

/** What's being agreed, at a glance: the total, and when each payment is due. */
export function TermsSummary({ terms }: { terms: TermsVersion }) {
  const count = terms.instalments.length
  return (
    <section className="space-y-4 rounded-3xl border border-line p-5" aria-label="What you’re agreeing to">
      <div>
        <p className="text-sm text-ink-muted">To pay back</p>
        <p className="font-display text-[2.75rem] leading-none font-semibold tabular-nums">
          {formatCents(terms.totalCents)}
        </p>
        {terms.chargeCents > 0 && (
          <p className="mt-1 text-sm text-ink-muted tabular-nums">
            {formatCents(terms.principalCents)} + {formatCents(terms.chargeCents)} charge
          </p>
        )}
      </div>
      <ul className="divide-y divide-line text-sm tabular-nums" aria-label={count === 1 ? 'Due' : `${count} payments`}>
        {terms.instalments.map((i) => (
          <li key={i.dueOn} className="flex justify-between py-2 first:pt-0 last:pb-0">
            <span>{formatDate(i.dueOn)}</span>
            <span className="font-semibold">{formatCents(i.amountCents)}</span>
          </li>
        ))}
      </ul>
      {terms.lateTerms && <p className="text-sm whitespace-pre-line text-ink-muted">If late: {terms.lateTerms}</p>}
      {terms.conditions && <p className="text-sm whitespace-pre-line text-ink-muted">{terms.conditions}</p>}
    </section>
  )
}
