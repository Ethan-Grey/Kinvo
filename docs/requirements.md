# Requirements

This document lists what Kinvo must do. Each requirement has an ID so issues, pull requests and tests can refer to it (for example, "implements LN-04").

**Priority:** `Must` = required for v1.0. `Should` = planned for v1.x. `Could` = nice to have.

## Roles

| Role | Who | Summary |
|---|---|---|
| Lender | The person lending money | Invites borrowers, reviews requests, sets terms, confirms funds sent, records repayments |
| Borrower | Someone linked to a lender | Requests loans, accepts terms, views balances and history, flags payments made |

A single account can be a lender to some people and a borrower to others. Roles belong to the *relationship*, not the account.

## Accounts and access (AC)

| ID | Requirement | Priority |
|---|---|---|
| AC-01 | Users sign in with Google or an emailed magic link. | Must |
| AC-02 | A lender can create an invite link. Opening it while signed in links that user to the lender as a borrower. | Must |
| AC-03 | Invite links expire and can be revoked. | Must |
| AC-04 | Users can only see loans where they are the lender or the borrower. Enforced by the database, not just the UI. | Must |
| AC-05 | A lender can remove a borrower link. Existing loan history is kept. | Should |
| AC-06 | Users can export their own data and request account deletion. | Should |
| AC-07 | Sign in with Apple. Deferred: requires a paid Apple Developer account (see ADR-0005). | Could |

## Loan lifecycle (LN)

| ID | Requirement | Priority |
|---|---|---|
| LN-01 | A borrower can request a loan: amount, reason, and a proposed repayment schedule (one or more dated instalments). | Must |
| LN-02 | A lender can create an offer directly, without a prior request. | Should |
| LN-03 | The lender can approve, reject, or counter-offer. A counter-offer can change the amount, charge, schedule and conditions. | Must |
| LN-04 | Every proposal is stored as a new, immutable terms version. Earlier versions are never edited. | Must |
| LN-05 | Proposing a terms version counts as the proposer's acceptance of it. The other party must then accept, reject, or counter. | Must |
| LN-06 | Either party can withdraw before the loan becomes active. | Must |
| LN-07 | After both parties accept, the loan is *agreed* but not active. It becomes *active* only when the lender confirms the funds were sent. | Must |
| LN-08 | Once active, terms can only change through a new version both parties accept (for example, an extension). | Should |
| LN-09 | The lender can write off all or part of an outstanding balance. This is recorded as an event, not a deleted debt. | Should |

## Agreements (AG)

| ID | Requirement | Priority |
|---|---|---|
| AG-01 | Before accepting, the borrower sees principal, charge, total repayable, each instalment's date and amount, late-payment terms, and other conditions. | Must |
| AG-02 | Acceptance requires ticking a confirmation checkbox and pressing **Accept Loan Agreement**. | Must |
| AG-03 | The system records: lender ID, borrower ID, terms version, a hash of the exact terms shown, and the acceptance timestamp. | Must |
| AG-04 | The system records when the lender confirmed funds were sent. | Must |
| AG-05 | Either party can view or download a summary of any accepted agreement. | Should |

## Calculations (CA)

| ID | Requirement | Priority |
|---|---|---|
| CA-01 | All amounts are stored and calculated as integer cents (NZD). | Must |
| CA-02 | Principal and the one-off charge are stored separately. | Must |
| CA-03 | Instalment amounts must add up exactly to principal + charge. | Must |
| CA-04 | Charges never compound and are never added automatically. | Must |
| CA-05 | Late fees, if used, are a configurable term agreed upfront, and only applied by an explicit lender action. | Should |
| CA-06 | Payments are applied to the oldest unpaid instalment first. Within an instalment, the charge portion is cleared before principal (see ADR-0004). | Must |
| CA-07 | A payment cannot exceed the outstanding balance, so overpayments can't happen (ADR-0010). | Must |
| CA-08 | The outstanding balance is always calculated from the terms and confirmed payments. It is never stored as an editable field. | Must |

## Repayments (RP)

| ID | Requirement | Priority |
|---|---|---|
| RP-01 | The lender can record a repayment: amount, date received, method (bank transfer, cash, other), optional reference, optional notes. | Must |
| RP-02 | A borrower can flag "I've paid" with the same details. It stays *claimed* until the lender confirms or disputes it. | Must |
| RP-03 | Only confirmed repayments reduce the balance. | Must |
| RP-04 | A recorded repayment is never edited or deleted. Mistakes are corrected with a reversing entry. | Must |
| RP-05 | The system rejects exact duplicate submissions (same loan, amount, date and reference within a short window). | Should |

## Dashboards (DB)

| ID | Requirement | Priority |
|---|---|---|
| DB-01 | Lender: total outstanding, total lent, active loans, pending requests, overdue instalments, recent repayments. | Must |
| DB-02 | Borrower: outstanding balance, active loans, upcoming and overdue instalments, repayment progress, past loans and payments. | Must |
| DB-03 | Borrower history: loans taken, total borrowed and repaid, on-time instalment rate, average days late. Visible to the lender only, as numbers without labels (ADR-0011). | Must |
| DB-04 | Lender: interest/charges received per tax year (1 April – 31 March) for record keeping. | Should |

## Notifications (NT)

| ID | Requirement | Priority |
|---|---|---|
| NT-01 | Email notifications for: new request, counter-offer, rejection, agreement accepted, funds confirmed, payment claimed, payment confirmed. | Must |
| NT-02 | Borrower reminders the day before and the day of each instalment, at a fixed NZ morning time. | Must |
| NT-03 | Overdue notices to both parties. | Must |
| NT-04 | PWA push notifications as an additional channel. | Should |
| NT-05 | Users can choose which notifications they receive. | Should |

## Non-functional (NF)

| ID | Requirement | Priority |
|---|---|---|
| NF-01 | Works on current iOS Safari, Android Chrome and desktop browsers, and installs as a PWA. | Must |
| NF-02 | No secrets in the repository. Configuration through environment variables. | Must |
| NF-03 | Every state change is recorded in an append-only audit log. | Must |
| NF-04 | All dates shown and scheduled in `Pacific/Auckland`. Due dates are calendar dates, not timestamps. | Must |
| NF-05 | Core screens meet WCAG 2.2 AA. | Should |
| NF-06 | CI must pass (types, lint, tests, build) before merging to `main`. | Must |

## Out of scope for v1

- Moving money. Kinvo records transfers; it never makes them.
- Compounding interest or automatic fees.
- Lending groups with multiple lenders sharing borrowers (see ADR-0006).
- Native iOS/Android apps.

## Open legal questions

These need New Zealand legal advice before Kinvo is used beyond close family. The software should not try to answer them.

1. Whether a checkbox-and-button acceptance, with the records in AG-03, is sufficient evidence of agreement under the Contract and Commercial Law Act 2017 (electronic transactions).
2. At what point lending would count as "in trade" under the Credit Contracts and Consumer Finance Act 2003, bringing disclosure, fee and cost-cap obligations.
3. How charges received should be treated for income tax.
4. Obligations under the Privacy Act 2020 for storing other people's financial records.
