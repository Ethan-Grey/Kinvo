# 0012. Existing debts are attached to invites and confirmed by the borrower

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Most people who join Kinvo will already owe the lender money from before the app existed. Without a way to record that, the app starts out wrong. The lender would have to invent a "new" loan that never went through the normal request, accept and send-money steps.

## Decision

- **Attach to the invite.** When creating an invite, the lender can add a debt: the amount owed now, roughly when it was lent, what it was for, a repayment plan, and optional late-payment terms and conditions. It's validated immediately and stored on the invite (`lender_invites.existing_debt`).
- **The borrower sees it before joining.** The invite page says "Lena has recorded that you already owe her $300 for car rego".
- **Joining turns it into a proposal from the lender.** It becomes a loan with `kind = 'existing_debt'`, `originally_lent_on` set, and version 1 of the terms proposed by the lender. The borrower is taken straight to it.
- **The borrower must confirm.** "Confirm this debt" uses the same fingerprinted acceptance as any agreement (ADR-0009). They can also suggest a different plan or amount, or say "This isn't right", which declines it.
- **Confirming makes it active immediately**, with the funds date set to when the money was originally lent. There's no "confirm money sent" step, because the money moved long ago.
- **Only the amount still owed is recorded**, with no charge and no past payments. Track records (ADR-0011) therefore start from when the debt is confirmed.
- **Past due dates are allowed when the debt is created at join time.** An invite can sit for up to 7 days, so its first due date may have passed by then. The borrower sees the original dates and can confirm them or suggest new ones.

## Consequences

- No debt counts against anyone until they've agreed to it.
- Existing debts appear in balances, dashboards and reminders like any other active loan once confirmed.
- For people already connected, an existing debt can't be added this way. The lender can offer a normal loan instead. If needed later, `create_loan` can gain an `existing_debt` option using the same confirmation path.

## Alternatives considered

- **Counts straight away, no confirmation:** faster, but it's only the lender's word, which is weak if anyone disagrees.
- **Full history (original amount, charge and each past payment):** a more accurate track record, but much more to type for little practical gain.
