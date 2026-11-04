# 0023. Household spending and the monthly overview

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

Groceries and takeaways are most of what people who live together share. Each one is small, so recording it has to take seconds, and it shouldn't create a formal debt that needs accepting.

## Decision

- **`household_expenses`.** Any member records an amount, a category (groceries, takeaways, household, transport, fun, other), an optional note, receipt and date, and who paid it: a member or the shared account.
  - **From the shared account:** a ledger entry comes off the balance, and nobody owes anybody.
  - **Paid by a member:** everyone else's share goes on the household tab. The share uses the household split unless a custom split is given, which can be 100% one person. The others are notified.
- **Removing.** Whoever added it or paid it can remove it. Its tab and ledger entries are voided with it.
- **Quick add at `/spend`.** It opens the add screen straight away when you're in one household, so an iPhone Back Tap shortcut can open it.
- **Monthly overview** (`/households/:id/month/:yyyy-mm`):
  - spending and bills by category, with the change from the month before;
  - who paid what (a member or the shared account);
  - how much each person put into the shared account.

  Bills count in the month they're due.

## Consequences

- Personal bills and "safe to spend until pay day" are still to come, as a private area separate from households.
