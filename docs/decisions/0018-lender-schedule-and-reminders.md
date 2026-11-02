# ADR-0018: Lender changes the schedule and controls reminders

- Status: Accepted
- Date: 2026-11-02

## Context

Once a loan is running, its repayment dates were fixed. Real life moves: pay days change, someone needs an extra week. The lender also wanted to choose when reminders reach a borrower and to send their own.

## Decision

**Changing the schedule.** `reschedule_loan` lets the lender replace the repayment schedule of an active loan. The change applies immediately, with no acceptance from the borrower, who is notified with the lender's optional note. This was the owner's explicit choice: Kinvo is for family lending, and the lender is the one being flexible.

- The total owed (amount plus charge) can't change, so a reschedule can't add to the debt.
- It's stored as a new `loan_terms` version, accepted by the lender only. Earlier versions stay in the history and the audit log records `loan_rescheduled`.
- Payments are re-allocated to the new schedule oldest first, as always. The app keeps fully paid instalments locked so they read the same afterwards.

**Reminder settings** (`reminder_settings`, one row per lending relationship, set by the lender): the hour automatic reminders go out (NZ time, to the hour) and whether to send the day-before, on-the-day and overdue reminders, plus how often overdue reminders repeat (1–30 days). The lender is always told when a payment is late. With no row, the old behaviour applies (9am, all on, weekly).

**Custom reminders** (`custom_reminders`): a message from the lender to the borrower at a date and hour, once or repeating daily, weekly, fortnightly or monthly. Occurrences are calculated from the first date, so monthly reminders don't drift. A reminder tied to a loan stops when the loan stops being active; all stop if the connection ends. Up to 20 at a time per borrower. Only the lender sees the list.

The hourly `queue_reminders` job sends each reminder on the first run at or after its hour; dedupe keys stop repeats.

## Consequences

- A borrower can't block a schedule change. The notification and the version history keep it transparent.
- Hour precision only, because the job runs hourly.
