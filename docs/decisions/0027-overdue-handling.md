# 0027. Overdue handling: reminders that stop, payments that move

- Status: accepted
- Date: 2026-11-11

## Context

Long-overdue payments sat in "Overdue" while reminders kept going out. In practice the person owed then pushed the date back by hand. Each person owed handles this differently, so it has to be their choice, set for each person in Reminders.

## Decision

- **Stop late reminders** (`reminder_settings.late_until_days`). Once a payment is this many days late, no more overdue reminders go to either person. The default is to never stop.
- **Move late payments** (`move_after_days`, `move_by_days`, `move_whole_plan`). This is off by default. When it's on, the hourly reminder job (`private.move_overdue_payments`, run at the start of `queue_reminders`) moves the earliest unpaid payment once it's `move_after_days` late. It moves to `move_by_days` after its original due date (a week by default), or a further step on if that date has already passed.
  - **Whole plan:** every later payment moves by the same number of days.
  - **Just that payment:** only the amount still owed moves. Anything already paid of it stays on the original date. If it lands on another payment's date, the two are combined.
- A move is saved as a new terms version, like a lender reschedule, and both people get a `payment_moved` alert.
- The loan stays marked as running late (`loans.late_since`, `moved_to`) until the moved payment is paid. `times_moved` counts every move. The app shows the loan and the moved payment as **Overdue**, and counts it in Home's overdue figures.

## Consequences

- Late payments don't quietly drift. The new date and the move count are visible to both people.
- The total owed never changes. Only dates move.
- The dashboard's database overdue counts don't include moved payments. The app adds them on top.
