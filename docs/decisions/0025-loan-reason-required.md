# 0025. Asking to borrow needs a reason

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

The person being asked for money wants to know what it's for before they accept. Until now the reason was optional and only shown in small text.

## Decision

- **Required for requests.** `create_loan` rejects a request from the person who'd owe (the borrower) without a reason, with the error `loan_reason_required`. Offers from the person who'd be owed can still leave it blank.
- **Asked first.** In the app, a request starts with "What do you need it for?", before the amount, charge and plan.
- **Shown everywhere it matters:**
  - in the alert ("For …");
  - in a "What it's for" panel at the top of the loan page and the Accept page;
  - on the loan's row in lists.

## Consequences

- Loans made before this change may have no reason; the panel is hidden for those.
