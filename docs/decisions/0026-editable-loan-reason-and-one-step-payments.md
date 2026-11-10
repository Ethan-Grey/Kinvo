# 0026. Editable loan reason and one-screen payments

- Status: accepted
- Date: 2026-11-10

## Context

People forget what older loans were for. Offers could leave the reason blank, and once a loan was made there was no way to add one. Recording a payment took three screens (amount, then method/date/reference, then receipt), which was slow for something done often.

## Decision

- `public.set_loan_reason(loan, reason)` lets either person on a loan add or change its reason. It can't be blanked, is capped at 500 characters and is logged as `reason_changed`.
- The loan page shows the reason as a line under the title. Tapping it edits it in place. With no reason, it shows "Add what it's for". Offers now ask for the reason as an optional wizard step.
- Payments are one screen: the amount (pre-filled, with quick picks) and the receipt. The date is today and the method is bank transfer. The receipt stays required, as the proof both people rely on.

## Consequences

- Payments made on an earlier day, or in cash, are recorded as today's bank transfer. The receipt shows the real details if they matter.
- Any loan can gain a reason later, so lists and alerts become more useful over time.
