# 0024. My money: personal bills and "safe to spend until pay day"

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

The owner wanted to track their own bills as well as shared ones, and to know how much they can spend before the next pay.

## Decision

- **A private area** (`personal_bills`, `my_money`). RLS lets only the owner read it, and household members can't see it. Kinvo doesn't connect to a bank.
- **What you enter:**
  - take-home pay, how often (weekly, fortnightly or monthly) and the next pay day;
  - your balance whenever you check it;
  - your bills: fixed or a rough amount, and weekly, fortnightly, monthly or yearly.
- **Safe to spend** = the last balance you entered, plus pay assumed to have arrived since, minus everything due after that and before the next pay day. "Everything" means:
  - your bills;
  - your shared-account top-ups;
  - money you owe in loans, with overdue amounts always counted;
  - household bill shares you pay yourself.

  It's calculated on the device from your rows, and shown as a total, a per-day figure, and the list of what's coming out.
- **Where it shows:** Home shows the figure, or a prompt to set it up. The full page is at `/money`, linked from Account.

## Consequences

- It's only as accurate as the last balance entered. The page says which balance and date it's working from, and offers to update it.
- Reminders for personal bills, and imports from a bank, aren't part of this.
