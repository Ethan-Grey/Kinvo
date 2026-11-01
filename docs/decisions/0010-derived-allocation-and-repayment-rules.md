# 0010. Derive payment allocation by replay; repayment rules

- **Status:** Accepted. Partly supersedes ADR-0004 (where allocations are kept) and requirement CA-07 (overpayment credit).
- **Date:** 2026-11-02

## Context

ADR-0004 fixed *how* a payment is split: oldest instalment first, charge before principal. It also said the split would be stored in a `repayment_allocations` table and never recalculated.

Building M4 showed a problem with storing it. Payments can be reversed (RP-04). If an early payment is reversed, every later payment's stored allocation becomes wrong, because the money it covered should now fill the earlier instalment. Keeping stored allocations correct would mean rewriting them, which defeats the point of storing them.

## Decision

1. **Allocation is derived, not stored.** `private.instalment_progress(loan)` replays the loan's confirmed payments in the order received, applying ADR-0004's rules. It's deterministic, so the same payments always give the same result. Balances and instalment status (`paid`, `due`, `overdue`) are calculated the same way and never stored (CA-08).
2. **Payments can't exceed the outstanding balance.** The database rejects them, and the form shows the maximum. No credits exist, which replaces CA-07.
3. **An instalment is overdue from the day after its due date**, in NZ time, when it isn't fully paid.
4. **Only the lender confirms, disputes or reverses payments.** Reversal requires a reason. The original row is kept, marked `reversed`.
5. **Loans complete automatically** when the balance reaches zero, and reopen if a reversal means money is owed again.
6. **The lender can forgive what's left.** The loan closes as `written_off` and records the amount forgiven.

## Consequences

- Reversals are always correct with no repair step, and the history stays append-only apart from status changes.
- Changing the allocation rule would change how past loans display. If that's ever needed, the rule must be versioned per loan (for example, a `rules_version` column on `loans`).
- Calculation runs on each read. At family scale (a handful of payments per loan) this costs nothing. It can be cached later if needed.
- `instalment_progress` also records the date each instalment was fully paid, which feeds the on-time statistics in M5.

## Alternatives considered

- **Stored allocations, rewritten on reversal:** more code, two sources of truth, easy to get out of sync.
- **Reversal as a negative payment row:** keeps rows immutable, but negative amounts complicate the replay and confuse anyone reading the list.
