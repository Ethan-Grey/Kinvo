# 0022. Households: shared accounts, bills and a household tab

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

People who live together share rent, bills and shopping, and every household does it differently. One couple might top up a joint account that pays the rent automatically. A parent might pay the power and have the others pay her back. Flatmates might each pay their own rent share to the landlord. Treating each grocery run as a formal debt (accept, due date, reminders) is too much admin between people who live together. Loans to family need to stay as they are.

## Decision

- **Households are separate from loans.** Anyone can create one (up to 10 each) and invite people with a single-use link that lasts 7 days. Members see each other's name and photo, and everything in the household, but nothing outside it. Every write goes through a function; members can only read.
- **The shared account is optional.** When it's on, the balance is the sum of ledger entries: a starting balance, top-ups, bills, money in and out, and balance checks. **Regular top-ups** are assumed to happen on schedule, and the person can mark one as missed. **Check balance** records what the banking app says as an adjustment, so the estimate never drifts.
- **Bills** have a fixed amount or one that changes each time, a frequency, and one of four payment methods:
  - from the shared account (comes off the balance);
  - one person pays and the others' shares go on the household tab;
  - everyone pays their own share directly and ticks it off (nothing goes on the tab);
  - one person covers it (just tracked).
- **Splits.** A bill uses its own split, or the household default (percentages set by the household), or an equal split.
- **Bill dates.** Each due date is a row created up to 7 days ahead by an hourly job. That job also asks for amounts that change each time, from 3 days before. Any single date can be skipped, or paid differently that time (e.g. you covered the rent yourself), and its effects are redone.
- **Household tab and settling up.** The tab holds entries of the form "A owes B". Settle up records a payment the other way. With three or more people, the app suggests the fewest payments to clear everyone.
- **Warnings.** Everyone is warned if the shared account might not cover a bill due in the next 3 days.
- **Receipts.** Bill photos go in a private `household-receipts` bucket, readable by members only.

## Consequences

- One person can be in several households (theirs, their mum's, a sister's), each set up differently.
- Groceries and takeaways (quick add, paid by a member or from the shared account) are the next stage, along with a monthly overview and personal bills.
