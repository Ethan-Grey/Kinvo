# 0020. Split bills, repeating debts, and a warmer palette

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Most of what's owed between partners and flatmates is shopping and regular costs, not loans. Entering groceries through the full proposal steps was slow, and regular costs like a rent share had to be entered every time. The owner also chose a new palette (Camel, Ivory Mist, Silver, Molten Lava, Dark Coffee).

## Decision

**Split bills** (`create_split_bill`, loan kind `bill`):
- The person who paid enters the total, the receipt, who it's split with and how (evenly, by percentage, or by amount), and when to pay back.
- Each person gets their own debt for their share, in one payment. When something doesn't divide evenly, the person who paid takes the odd cent.
- Each person accepts their share. On accepting, it's active straight away and dated when the bill was paid (`originally_lent_on`), like an existing debt. There's no "paid out" step, because the money was already spent.
- The receipt is uploaded into each share's own folder (`attach_bill_receipt`), so each person can only see their own.

**Repeating debts** (`repeating_debts`, loan kind `repeating`):
- The person owed proposes an amount, a frequency (weekly, fortnightly or monthly), a start date and an optional end date.
- The other person accepts once. After that, an hourly job (`create_repeating_debts`) adds each one as an active debt due on its date, with both people's agreement recorded against it.
- Monthly dates are counted from the first date, so the 31st becomes the last day of shorter months.
- Changing the amount affects future debts only. The person owed can pause and restart it; restarting skips anything missed while it was paused. Either person can stop it.

**Palette:**
- Light mode: Ivory Mist background, Dark Coffee text, Molten Lava buttons.
- Dark mode: Dark Coffee background, Ivory Mist text, Camel buttons.
- This replaces the earlier "pure white and black backgrounds" rule, at the owner's request. Red and green stay for overdue and paid, with a red brighter than Molten Lava. All pairs are checked for WCAG AA.

## Consequences

- Each share and each repeating debt is an ordinary debt, so reminders, payments, receipts, proof of payment and track records all work unchanged.
- There's no "trust this person" shortcut yet: every bill share needs one tap to accept.
