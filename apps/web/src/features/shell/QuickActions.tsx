import { useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { formatCents } from '../../domain/money'
import { listLoans, type LoanSummary } from '../../data/loans'
import { getMyProfile, listPeople } from '../../data/people'
import { RingAvatar } from '../../shared/Avatar'
import {
  ChevronIcon,
  CloseIcon,
  HandIcon,
  InviteIcon,
  PaymentIcon,
  PlusIcon,
  RepeatIcon,
  SendIcon,
  SplitIcon,
} from '../../shared/icons'
import { useAsync } from '../../shared/useAsync'
import { IconBubble, Notice, Skeleton } from '../../shared/ui'
import { useAuth } from '../auth/useAuth'

/**
 * The raised + in the tab bar. Opens a bottom sheet with the things people do
 * most: start a loan, record a payment, invite someone. Only actions that make
 * sense for this person are shown.
 */
export function QuickActionsButton() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  function show() {
    setOpen(true)
    dialogRef.current?.showModal()
  }

  function close() {
    dialogRef.current?.close()
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label="New"
        aria-haspopup="dialog"
        className={
          '-mt-6 flex size-14 items-center justify-center rounded-full bg-brand text-on-brand ' +
          'shadow-[0_8px_20px_-6px_rgb(30_58_138/0.7)] ring-4 ring-canvas transition active:scale-95 ' +
          'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-ink'
        }
      >
        <PlusIcon className="size-7" />
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="quick-actions-title"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // A tap on the dimmed area outside the sheet closes it.
          if (e.target === dialogRef.current) close()
        }}
        className={
          'fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85svh] w-full max-w-none overflow-y-auto bg-transparent p-0 text-ink ' +
          'open:animate-sheet-up sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md'
        }
      >
        <div className="rounded-t-3xl border border-line bg-surface px-5 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:rounded-3xl">
          <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-ring-track sm:hidden" />
          <div className="flex items-center justify-between">
            <h2 id="quick-actions-title" className="text-xl font-semibold">
              What would you like to do?
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="flex size-10 items-center justify-center rounded-full text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
            >
              <CloseIcon />
            </button>
          </div>
          {open && <SheetBody onDone={close} />}
        </div>
      </dialog>
    </>
  )
}

function SheetBody({ onDone }: { onDone: () => void }) {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const navigate = useNavigate()
  const [choosingLoan, setChoosingLoan] = useState(false)
  const [data] = useAsync(async () => {
    const [profile, people, loans] = await Promise.all([getMyProfile(userId), listPeople(userId), listLoans(userId)])
    return { profile, people, loans }
  }, userId)

  if (data.status === 'loading') {
    return (
      <div className="mt-4 space-y-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    )
  }
  if (data.status === 'error') {
    return (
      <div className="mt-4">
        <Notice tone="error">{data.error.message}</Notice>
      </div>
    )
  }

  const { profile, people, loans } = data.data
  const active = loans.filter((l) => l.status === 'active')
  const go = (to: string) => {
    onDone()
    navigate(to)
  }

  if (choosingLoan) {
    return (
      <div className="mt-4">
        <p className="text-sm text-ink-muted">Which one is the payment for?</p>
        <ul className="mt-3 space-y-2">
          {active.map((loan) => (
            <li key={loan.id}>
              <LoanChoice loan={loan} onChoose={() => go(`/loans/${loan.id}/pay`)} />
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setChoosingLoan(false)}
          className="mt-4 min-h-11 text-sm font-medium text-ink-muted hover:text-ink"
        >
          Back
        </button>
      </div>
    )
  }

  const only = active.length === 1 ? active[0] : undefined
  const hasLenders = people.lenders.length > 0
  const hasBorrowers = people.borrowers.length > 0

  return (
    <ul className="mt-4 space-y-2">
      {hasLenders && (
        <Action
          icon={<HandIcon />}
          title="I owe someone"
          detail="Send a request with a repayment plan"
          onClick={() => go('/loans/new?as=borrower')}
        />
      )}
      {hasBorrowers && (
        <Action
          icon={<SendIcon />}
          title="Someone owes me"
          detail="Propose terms for someone to accept"
          onClick={() => go('/loans/new?as=lender')}
        />
      )}
      {hasBorrowers && (
        <Action
          icon={<SplitIcon />}
          title="Split a bill"
          detail="You paid, others owe you their share"
          onClick={() => go('/bills/new')}
        />
      )}
      {hasBorrowers && (
        <Action
          icon={<RepeatIcon />}
          title="Repeating"
          detail="Like a rent share, added automatically"
          onClick={() => go('/repeating/new')}
        />
      )}
      {active.length > 0 && (
        <Action
          icon={<PaymentIcon />}
          title="Record a payment"
          detail={only ? `For ${nameFor(only)}` : `Choose from ${active.length}`}
          onClick={() => (only ? go(`/loans/${only.id}/pay`) : setChoosingLoan(true))}
        />
      )}
      {profile.can_lend && (
        <Action
          icon={<InviteIcon />}
          title="Invite someone"
          detail="Create a link to connect a family member"
          onClick={() => go('/people#invite')}
        />
      )}
      {!hasLenders && !hasBorrowers && !profile.can_lend && (
        <li className="rounded-2xl border border-line p-4 text-sm text-ink-muted">
          Ask someone you owe for an invite link. Once you’re connected you can add what you owe here.{' '}
          <Link to="/account" onClick={onDone} className="font-medium text-brand-ink underline">
            Your account
          </Link>
        </li>
      )}
    </ul>
  )
}

function nameFor(loan: LoanSummary): string {
  return loan.role === 'lender' ? `what ${loan.otherPersonName} owes you` : `what you owe ${loan.otherPersonName}`
}

function Action({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: ReactNode
  title: string
  detail: string
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={
          'flex w-full items-center gap-3 rounded-2xl border border-line p-3 text-left transition ' +
          'hover:border-brand-ink active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-brand-ink'
        }
      >
        <IconBubble tone="soft">{icon}</IconBubble>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block text-sm text-ink-muted">{detail}</span>
        </span>
        <ChevronIcon className="size-5 text-ink-muted" />
      </button>
    </li>
  )
}

function LoanChoice({ loan, onChoose }: { loan: LoanSummary; onChoose: () => void }) {
  const balance = loan.balance
  const progress = balance && balance.totalCents > 0 ? balance.paidCents / balance.totalCents : 0
  return (
    <button
      type="button"
      onClick={onChoose}
      className="flex w-full items-center gap-3 rounded-2xl border border-line p-3 text-left hover:border-brand-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
    >
      <RingAvatar
        name={loan.otherPersonName}
        photo={loan.otherPersonPhoto}
        progress={progress}
        overdue={(balance?.overdueCount ?? 0) > 0}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          {loan.role === 'lender' ? `${loan.otherPersonName} pays you` : `You pay ${loan.otherPersonName}`}
        </span>
        <span className="block text-sm text-ink-muted tabular-nums">
          {balance ? `${formatCents(balance.outstandingCents)} left` : ''}
        </span>
      </span>
      <ChevronIcon className="size-5 text-ink-muted" />
    </button>
  )
}
