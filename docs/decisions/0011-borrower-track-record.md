# 0011. Borrower track record: definitions and visibility

- **Status:** Accepted. Changes requirement DB-03 (borrowers no longer see their own record).
- **Date:** 2026-11-02

## Context

Lenders want to see how reliable each borrower has been. This is family, so the record needs to be factual, easy to explain, and not something that causes friction if someone reads it.

## Decision

**Visibility:** only the lender sees a borrower's track record. `list_borrower_records()` returns rows only for relationships where the caller is the lender. Borrowers see their own loans and payments, but no aggregate score.

**Presentation:** numbers only, such as "6 of 8 payments on time · late ones 4.5 days late on average". There are no labels like "Reliable" or "Often late".

**Definitions:**

- An instalment is **assessed** once it's been paid in full, or once its due date has passed on an active loan.
- **On time:** fully paid on or before its due date (NZ calendar dates).
- **Late:** fully paid after its due date, or still unpaid after it.
- **Days late:** the date it was fully paid (or today, if still unpaid) minus the due date. "Fully paid" is the date of the payment that completed it, from the same payment replay used everywhere else (ADR-0010).
- **Average lateness** covers late instalments only, so on-time payments don't dilute it.
- **Forgiven instalments** (unpaid when a loan was written off) are excluded. Forgiveness shouldn't count against the borrower.

## Consequences

- Every figure can be explained by pointing at the schedule and payment dates on the loan page.
- Unpaid overdue instalments grow "days late" daily, so the record reflects a current problem, not just past ones.
- If borrowers later need to see their record, the change is a function-level permission plus UI, with no schema change.

## Alternatives considered

- **Visible to the borrower too** (the original DB-03): more transparent, but the lender chose privacy.
- **A single score or label:** quicker to read, but harder to justify and more likely to upset people.
