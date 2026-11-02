# 0015. Lenders can remove loans; only lenders set the charge

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Testing the app with a real account left fake loans that counted towards "total lent", charges and track records. Nothing could be deleted, by design (ADR-0003, ADR-0010), so there was no way to clean up.

Separately, borrowers could put a charge into their own request. In practice the lender decides whether to charge anything, and a borrower proposing one is confusing.

## Decision

**Removing a loan**
- The lender can remove any loan, at any stage, from its page ("Remove this loan", on its own confirmation page, with an optional reason).
- It's hidden, not erased. The status becomes `removed`, and every list, total, track record, balance and reminder only counts the statuses it needs, so the loan drops out of all of them for both people. Its alerts are deleted.
- The audit log keeps one `loan_removed` entry with who, when, the previous status and the reason.
- Borrowers can't remove loans. They can decline or withdraw before money moves.

**Clearing alerts**
- Anyone can clear their own alerts. They're a copy of what happened, not the record itself.

**The charge**
- A borrower's request always has no charge.
- Only the lender proposes a charge. After that the borrower can still suggest a different amount or plan, but the charge follows the lender's rate: `round(amount × lender's charge ÷ lender's amount)`. If the lender later drops the charge, it's zero again.
- This is enforced in `private.insert_terms` (`charge_set_by_lender`), so it holds for new requests and for every change. The app mirrors it, skipping the charge step for borrowers and showing the charge the lender set.

## Consequences

- Test data can be cleaned up without anyone touching the database.
- A lender could use removal to hide a real loan. Both people see it vanish, and the audit log keeps the entry. For a real loan that's ending early, "Forgive the rest" is the honest option and the removal page says so.
- Removed loans still appear in "Download my data", marked `removed`.

## Alternatives considered

- **Hard delete:** cleaner tables, but no trace if a real loan disappears, and repayments and audit entries would need cascading deletes.
- **Borrower may propose a charge that the lender accepts:** more flexible, but not how family lending works here, and it needs explaining on every request.
