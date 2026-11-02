import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { formatShortDate } from '../../domain/dates'
import { formatCents, toCents, type Cents } from '../../domain/money'
import {
  getDashboardSummary,
  listUpcomingInstalments,
  type DashboardSummary,
  type UpcomingInstalment,
} from '../../data/dashboard'
import { listLoans, type LoanSummary } from '../../data/loans'
import { getMyProfile, listPeople } from '../../data/people'
import { RingAvatar } from '../../shared/Avatar'
import { AlertIcon, CheckIcon, DocumentIcon, InviteIcon, PaymentIcon, SendIcon } from '../../shared/icons'
import { ProgressRing } from '../../shared/ProgressRing'
import { useAsync } from '../../shared/useAsync'
import { Card, EmptyState, IconBubble, Notice, PageSkeleton, SectionHeader } from '../../shared/ui'
import { PushNudge } from '../account/PushNudge'
import { useAuth } from '../auth/useAuth'

const todayLabel = new Intl.DateTimeFormat('en-NZ', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Pacific/Auckland',
})

/**
 * Home tab: the balance that matters most to this person, anything waiting on
 * them, the people they lend to or borrow from, and what's due next (DB-01, DB-02).
 */
export function HomePage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const location = useLocation()
  const justJoined = (location.state as { joined?: boolean } | null)?.joined === true

  const [data] = useAsync(async () => {
    const [profile, people, summary, upcoming, loans] = await Promise.all([
      getMyProfile(userId),
      listPeople(userId),
      getDashboardSummary(),
      listUpcomingInstalments(6),
      listLoans(userId),
    ])
    return { profile, people, summary, upcoming, loans }
  }, userId)

  if (data.status === 'loading') return <PageSkeleton label="Loading your home screen" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>

  const { profile, people, summary, upcoming, loans } = data.data
  const isLender = profile.can_lend && (people.borrowers.length > 0 || summary.lending.activeCount > 0)
  const isBorrower = people.lenders.length > 0 || summary.borrowing.activeCount > 0
  const firstName = profile.display_name.split(' ')[0]
  // Lenders see who owes them; people who only borrow see who they owe.
  const circle = peopleWithBalances(loans).filter((p) => p.role === (isLender ? 'lender' : 'borrower'))

  return (
    <div className="space-y-7">
      <header>
        <p className="text-sm text-ink-muted">{todayLabel.format(new Date())}</p>
        <h1 className="text-[1.75rem] leading-tight font-semibold">Kia ora, {firstName}</h1>
      </header>

      {justJoined && <Notice tone="success">You’re connected. Tap + to ask for a loan.</Notice>}

      {isLender ? (
        <LendingHero summary={summary} loans={loans} />
      ) : isBorrower ? (
        <BorrowingHero summary={summary} loans={loans} />
      ) : null}

      <NeedsYou summary={summary} />

      {(isLender || isBorrower) && <PushNudge />}

      {isLender && isBorrower && <BorrowingStrip summary={summary} loans={loans} />}

      {circle.length > 0 && <PeopleStrip people={circle} isLender={isLender} />}

      {upcoming.length > 0 && <ComingUp upcoming={upcoming} />}

      {!isLender && !isBorrower && (
        <Card>
          {profile.can_lend ? (
            <EmptyState
              icon={<InviteIcon className="size-6" />}
              title="Invite your first borrower"
              action={
                <Link
                  to="/people#invite"
                  className="inline-flex min-h-12 items-center rounded-2xl bg-brand px-5 font-semibold text-on-brand"
                >
                  Create an invite link
                </Link>
              }
            >
              Send them a link. Once they join, you can offer a loan or record money they already owe.
            </EmptyState>
          ) : (
            <EmptyState icon={<InviteIcon className="size-6" />} title="Waiting for an invite">
              Ask the person lending to you to send you a Kinvo invite link, then open it on this device.
            </EmptyState>
          )}
        </Card>
      )}
    </div>
  )
}

/**
 * Where "Pay back" / "Record a payment" goes: straight to the payment page
 * when there's one loan, otherwise to the list of those loans to pick from.
 */
function payTarget(loans: LoanSummary[], role: 'lender' | 'borrower'): string | null {
  const active = loans.filter((l) => l.role === role && l.status === 'active' && (l.balance?.outstandingCents ?? 0) > 0)
  if (active.length === 0) return null
  if (active.length === 1 && active[0]) return `/loans/${active[0].id}/pay`
  return `/loans?show=${role === 'borrower' ? 'borrowing' : 'lending'}`
}

/** Share of the total that's been repaid across a set of loans, 0–1. */
function repaidShare(loans: LoanSummary[]): number {
  let paid = 0
  let total = 0
  for (const loan of loans) {
    if (!loan.balance) continue
    paid += loan.balance.paidCents
    total += loan.balance.totalCents
  }
  return total === 0 ? 0 : paid / total
}

function HeroFrame({
  label,
  amount,
  ring,
  children,
  action,
}: {
  label: string
  amount: Cents
  ring: number
  children: ReactNode
  /** The main thing to do from here, e.g. Pay back. */
  action?: { to: string; label: string }
}) {
  const percent = Math.round(ring * 100)
  return (
    <section className="relative overflow-hidden rounded-3xl bg-brand p-5 text-on-brand">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-sans text-sm font-medium text-on-brand-muted">{label}</h2>
          <p className="mt-1 font-display text-[2.75rem] leading-none font-semibold tabular-nums">
            {formatCents(amount)}
          </p>
        </div>
        <div className="relative shrink-0" role="img" aria-label={`${percent}% repaid so far`}>
          <ProgressRing value={ring} size={76} stroke={7} tone="on-brand" track="stroke-white/25" />
          <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
            <span className="font-display text-lg font-semibold tabular-nums">{percent}%</span>
            <span className="text-[10px] text-on-brand-muted">repaid</span>
          </span>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-white/20 pt-4 text-sm">{children}</dl>
      {action && (
        <Link
          to={action.to}
          className={
            'mt-5 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-[#4e148c] ' +
            'transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'
          }
        >
          <PaymentIcon className="size-5" />
          {action.label}
        </Link>
      )}
    </section>
  )
}

function HeroFigure({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-on-brand-muted">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1.5 font-semibold tabular-nums">
        {alert && <AlertIcon className="size-4" />}
        {value}
      </dd>
    </div>
  )
}

function LendingHero({ summary, loans }: { summary: DashboardSummary; loans: LoanSummary[] }) {
  const l = summary.lending
  const lending = loans.filter((loan) => loan.role === 'lender' && loan.status === 'active')
  return (
    <HeroFrame
      label="Owed to you"
      amount={l.owedCents}
      ring={repaidShare(lending)}
      action={
        payTarget(loans, 'lender') ? { to: payTarget(loans, 'lender') ?? '', label: 'Record a payment' } : undefined
      }
    >
      <HeroFigure
        label="Overdue"
        value={l.overdueCount > 0 ? formatCents(l.overdueCents) : 'Nothing'}
        alert={l.overdueCount > 0}
      />
      <HeroFigure label="Active loans" value={String(l.activeCount)} />
      <HeroFigure label="Lent in total" value={formatCents(l.totalLentCents)} />
      <HeroFigure label="Charges this tax year" value={formatCents(l.chargesReceivedCents)} />
    </HeroFrame>
  )
}

function BorrowingHero({ summary, loans }: { summary: DashboardSummary; loans: LoanSummary[] }) {
  const b = summary.borrowing
  const borrowing = loans.filter((loan) => loan.role === 'borrower' && loan.status === 'active')
  return (
    <HeroFrame
      label="You owe"
      amount={b.owedCents}
      ring={repaidShare(borrowing)}
      action={payTarget(loans, 'borrower') ? { to: payTarget(loans, 'borrower') ?? '', label: 'Pay back' } : undefined}
    >
      <HeroFigure
        label="Next payment"
        value={b.nextDueOn && b.nextDueCents !== null ? formatCents(b.nextDueCents) : 'Nothing due'}
      />
      <HeroFigure label="Due" value={b.nextDueOn ? formatShortDate(b.nextDueOn) : '—'} />
      {b.overdueCount > 0 && <HeroFigure label="Overdue" value={formatCents(b.overdueCents)} alert />}
    </HeroFrame>
  )
}

/** For people who both lend and borrow: their borrowing, under the lending card, with its own Pay back. */
function BorrowingStrip({ summary, loans }: { summary: DashboardSummary; loans: LoanSummary[] }) {
  const b = summary.borrowing
  const pay = payTarget(loans, 'borrower')
  return (
    <section className="rounded-3xl border border-line p-4">
      <Link to="/loans?show=borrowing" className="flex items-center gap-3">
        <IconBubble tone="soft">
          <PaymentIcon />
        </IconBubble>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-muted">You owe</p>
          <p className="font-display text-xl font-semibold tabular-nums">{formatCents(b.owedCents)}</p>
        </div>
        {b.nextDueOn && b.nextDueCents !== null && (
          <p className="text-right text-sm">
            <span className="block font-semibold tabular-nums">{formatCents(b.nextDueCents)}</span>
            <span className="text-ink-muted">due {formatShortDate(b.nextDueOn)}</span>
          </p>
        )}
      </Link>
      {pay && (
        <Link
          to={pay}
          className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand font-semibold text-on-brand transition active:scale-[0.98]"
        >
          Pay back
        </Link>
      )}
    </section>
  )
}

function NeedsYou({ summary }: { summary: DashboardSummary }) {
  const { repliesNeeded, fundsToSend, claimsToConfirm, claimsDisputed } = summary.actions
  const tasks = [
    {
      count: repliesNeeded,
      one: 'proposal to answer',
      many: 'proposals to answer',
      icon: <DocumentIcon />,
      tone: 'attention' as const,
      to: '/loans?show=waiting',
    },
    {
      count: fundsToSend,
      one: 'loan to send money for',
      many: 'loans to send money for',
      icon: <SendIcon />,
      tone: 'attention' as const,
      to: '/loans?show=waiting',
    },
    {
      count: claimsToConfirm,
      one: 'payment to confirm',
      many: 'payments to confirm',
      icon: <CheckIcon />,
      tone: 'attention' as const,
      to: '/loans?show=lending',
    },
    {
      count: claimsDisputed,
      one: 'payment disputed',
      many: 'payments disputed',
      icon: <AlertIcon />,
      tone: 'danger' as const,
      to: '/loans?show=borrowing',
    },
  ].filter((t) => t.count > 0)

  if (tasks.length === 0) return null

  return (
    <section className="space-y-3">
      <SectionHeader title="Needs you" />
      <ul className="grid grid-cols-2 gap-3">
        {tasks.map((task) => (
          <li key={task.one}>
            <Link
              to={task.to}
              className="flex h-full flex-col gap-3 rounded-3xl border border-line p-4 transition hover:border-brand-ink active:scale-[0.98]"
            >
              <IconBubble tone={task.tone}>{task.icon}</IconBubble>
              <span>
                <span className="block font-display text-2xl leading-none font-semibold tabular-nums">
                  {task.count}
                </span>{' '}
                <span className="mt-1 block text-sm text-ink-muted">{task.count === 1 ? task.one : task.many}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

interface PersonBalance {
  relationshipId: string
  name: string
  role: 'lender' | 'borrower'
  outstandingCents: Cents
  progress: number
  overdue: boolean
  photo: string | null
  /** Where Pay back goes for this person. */
  payTo: string
  nextDueOn: string | null
}

/** Groups active loans by person, so each person appears once with one ring. */
function peopleWithBalances(loans: LoanSummary[]): PersonBalance[] {
  const byPerson = new Map<string, { loans: LoanSummary[]; first: LoanSummary }>()
  for (const loan of loans) {
    if (loan.status !== 'active' || !loan.balance) continue
    const entry = byPerson.get(loan.relationshipId)
    if (entry) entry.loans.push(loan)
    else byPerson.set(loan.relationshipId, { loans: [loan], first: loan })
  }
  return [...byPerson.values()]
    .map(({ loans: group, first }) => ({
      relationshipId: first.relationshipId,
      name: first.otherPersonName,
      photo: first.otherPersonPhoto,
      role: first.role,
      outstandingCents: toCents(group.reduce((sum, l) => sum + (l.balance?.outstandingCents ?? 0), 0)),
      progress: repaidShare(group),
      overdue: group.some((l) => (l.balance?.overdueCount ?? 0) > 0),
      payTo: group.length === 1 ? `/loans/${first.id}/pay` : `/people/${first.relationshipId}`,
      nextDueOn:
        group
          .map((l) => l.balance?.nextDueOn ?? null)
          .filter((d): d is string => d !== null)
          .sort()[0] ?? null,
    }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.outstandingCents - a.outstandingCents)
}

function PeopleStrip({ people, isLender }: { people: PersonBalance[]; isLender: boolean }) {
  if (!isLender) return <OwedBars people={people} />
  return (
    <section className="space-y-3">
      <SectionHeader
        title={isLender ? 'Who owes you' : 'Who you owe'}
        link={{ to: '/people', label: 'See everyone' }}
      />
      <ul className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {people.map((person) => (
          <li key={person.relationshipId} className="shrink-0">
            <Link
              to={`/people/${person.relationshipId}`}
              className="flex w-28 flex-col items-center rounded-3xl border border-line px-2 py-4 text-center transition hover:border-brand-ink active:scale-[0.98]"
            >
              <RingAvatar
                name={person.name}
                photo={person.photo}
                progress={person.progress}
                overdue={person.overdue}
                size="lg"
              />
              <span className="mt-2 w-full truncate text-sm font-semibold">{person.name.split(' ')[0]}</span>
              <span
                className={`text-sm tabular-nums ${person.overdue ? 'font-semibold text-danger' : 'text-ink-muted'}`}
              >
                {formatCents(person.outstandingCents)}
              </span>
              <span className="sr-only">
                {person.role === 'borrower' ? 'owes you' : 'you owe'}, {Math.round(person.progress * 100)}% repaid
                {person.overdue ? ', overdue' : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Borrowers usually owe one or two people, so each gets a full-width bar
 * with what's owed, when the next payment is due, and a Pay back button.
 */
function OwedBars({ people }: { people: PersonBalance[] }) {
  return (
    <section className="space-y-3">
      <SectionHeader title="Who you owe" />
      <ul className="space-y-2">
        {people.map((person) => (
          <li key={person.relationshipId} className="rounded-3xl border border-line p-4">
            <Link to={`/people/${person.relationshipId}`} className="flex items-center gap-3">
              <RingAvatar
                name={person.name}
                photo={person.photo}
                progress={person.progress}
                overdue={person.overdue}
                size="lg"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-lg font-semibold">{person.name}</p>
                <p className={`text-sm ${person.overdue ? 'font-semibold text-danger' : 'text-ink-muted'}`}>
                  {person.overdue
                    ? 'A payment is overdue'
                    : person.nextDueOn
                      ? `Next payment ${formatShortDate(person.nextDueOn)}`
                      : `${Math.round(person.progress * 100)}% repaid`}
                </p>
              </div>
              <span className="font-display text-xl font-semibold tabular-nums">
                {formatCents(person.outstandingCents)}
              </span>
            </Link>
            <Link
              to={person.payTo}
              className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand font-semibold text-on-brand transition active:scale-[0.98]"
            >
              <PaymentIcon className="size-5" />
              Pay {person.name.split(' ')[0]}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

const dayName = new Intl.DateTimeFormat('en-NZ', { weekday: 'short', timeZone: 'UTC' })

function DateTile({ iso, overdue }: { iso: string; overdue: boolean }) {
  const date = new Date(`${iso}T00:00:00Z`)
  return (
    <span
      aria-hidden="true"
      className={
        'flex size-12 shrink-0 flex-col items-center justify-center rounded-2xl leading-none ' +
        (overdue ? 'bg-danger text-on-danger' : 'bg-brand-soft text-on-brand-soft')
      }
    >
      <span className="text-[10px] font-semibold">{dayName.format(date)}</span>
      <span className="mt-0.5 font-display text-lg font-semibold">{date.getUTCDate()}</span>
    </span>
  )
}

function ComingUp({ upcoming }: { upcoming: UpcomingInstalment[] }) {
  return (
    <section className="space-y-3">
      <SectionHeader title="Coming up" link={{ to: '/loans', label: 'All loans' }} />
      <ul className="space-y-2">
        {upcoming.map((item) => {
          const overdue = item.status === 'overdue'
          return (
            <li key={`${item.loanId}-${item.sequence}`}>
              <Link
                to={`/loans/${item.loanId}`}
                className="flex items-center gap-3 rounded-2xl p-2 transition hover:bg-brand-soft/30 active:scale-[0.99]"
              >
                <DateTile iso={item.dueOn} overdue={overdue} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {item.role === 'lender' ? `${item.otherPersonName} pays you` : `You pay ${item.otherPersonName}`}
                  </p>
                  <p className={`text-sm ${overdue ? 'font-medium text-danger' : 'text-ink-muted'}`}>
                    {overdue ? `Overdue since ${formatShortDate(item.dueOn)}` : formatShortDate(item.dueOn)}
                  </p>
                </div>
                <span className="font-display text-lg font-semibold tabular-nums">
                  {formatCents(item.remainingCents)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
