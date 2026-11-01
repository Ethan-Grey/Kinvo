# 0004. Allocate payments oldest-instalment first, charge before principal

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Loans have a principal and a one-off charge, repaid over one or more instalments. When a payment doesn't exactly match an instalment, the system needs a fixed rule for what it pays off. The brief also requires the charge to be tracked separately from principal.

## Decision

When a repayment is confirmed:

1. **Oldest unpaid instalment first.** Fill instalment 1 completely before anything goes to instalment 2.
2. **Charge before principal.** Each instalment carries a share of the charge. That share is cleared before the instalment's principal.
3. **Overpayment becomes credit.** Anything left after the final instalment is recorded as credit, visible to both parties.

An instalment's charge share is the total charge spread across instalments in proportion to their amounts. Rounding remainders (whole cents) go to the earliest instalment, so shares always add up exactly to the total charge.

The resulting split is stored in `repayment_allocations` and never recalculated.

### Worked example

Principal $200.00, charge $100.00, two instalments of $150.00. Each instalment carries $50.00 of charge and $100.00 of principal.

A payment of $200.00 is allocated as:

| Instalment | Charge | Principal | Instalment remaining |
|---|---|---|---|
| 1 | $50.00 | $100.00 | $0.00 |
| 2 | $50.00 | $0.00 | $100.00 |

## Consequences

- Behaviour is predictable and easy to explain to borrowers.
- Charges received are known exactly for record keeping.
- Allocation is stored, so a later change to this rule won't rewrite history.

## Alternatives considered

- **Borrower picks the instalment:** more UI and edge cases for little benefit.
- **Principal first:** delays recognising the charge and makes partial-payment records harder to read.
- **Proportional split of every payment:** precise but hard for users to follow.
