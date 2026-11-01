import { formatDate } from '../../domain/dates'
import { formatCents } from '../../domain/money'
import { chargePercent } from '../../domain/schedule'
import type { TermsVersion } from '../../data/loans'

/**
 * The full terms of one version, laid out as the agreement both people see
 * (AG-01): amount, charge, total, every payment, and any conditions.
 */
export function TermsSummary({ terms, lenderName, borrowerName }: { terms: TermsVersion; lenderName: string; borrowerName: string }) {
  return (
    <div className="space-y-4">
      <dl className="space-y-2 tabular-nums">
        <Line label={`${lenderName} lends ${borrowerName}`} value={formatCents(terms.principalCents)} />
        <Line
          label={`One-off charge (${chargePercent(terms.principalCents, terms.chargeCents)})`}
          value={formatCents(terms.chargeCents)}
        />
        <div className="border-t border-line pt-2">
          <Line label={`${borrowerName} repays`} value={formatCents(terms.totalCents)} strong />
        </div>
      </dl>

      <div>
        <h3 className="text-sm font-medium text-ink-muted">Repayment schedule</h3>
        <table className="mt-2 w-full text-sm tabular-nums">
          <tbody className="divide-y divide-line">
            {terms.instalments.map((instalment, index) => (
              <tr key={instalment.dueOn}>
                <td className="w-8 py-2 text-ink-muted">{index + 1}.</td>
                <td className="py-2">{formatDate(instalment.dueOn)}</td>
                <td className="py-2 text-right font-medium">{formatCents(instalment.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Clause title="If a payment is late" text={terms.lateTerms || 'No late-payment terms. No late fees apply.'} />
      {terms.conditions && <Clause title="Other conditions" text={terms.conditions} />}
    </div>
  )
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className={strong ? 'font-medium' : 'text-ink-muted'}>{label}</dt>
      <dd className={strong ? 'text-lg font-semibold text-brand' : ''}>{value}</dd>
    </div>
  )
}

function Clause({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-ink-muted">{title}</h3>
      <p className="mt-1 whitespace-pre-line text-sm">{text}</p>
    </div>
  )
}
