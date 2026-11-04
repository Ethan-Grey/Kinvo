# 0019. Neutral wording, anyone can be owed, and reminder times

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Kinvo isn't only used for loans. People also pay someone back for something bought on their behalf, like groceries, and that goes both ways between partners and flatmates. "Lend" and "borrow" don't fit, and only an administrator could make someone a lender. One time per reminder type also wasn't enough: the owner wanted, say, 9am and 6pm on the day, then noon the day after.

## Decision

- **Wording.** The app and its notifications talk about what's owed: "Alex owes you", "You owe Hana", "Owed to you" and "You owe", and the "Owed" tab. Money going out is "paid out" (sent, or paid for something). The database keeps its names (`loans`, `lender_id`, `borrower_id`); only the words people see changed.
- **Anyone can be owed.** `profiles.can_lend` now defaults to true and every existing account was switched on. Connections still need a single-use invite that the other person accepts (ADR-0008). Two people can be connected both ways: one invite each.
- **Reminder times.** `reminder_rules` holds any number of reminders per person (up to 10), each a day relative to the due date (14 days before to 60 days after) and an hour. `reminder_settings` keeps an optional "keep reminding while late" repeat (every N days at an hour, after the last reminder). With no settings saved, the defaults apply: 9am the day before, on the day and the day after, then weekly. The person owed is always told at 9am the day after a missed payment, then weekly. This replaces the on/off switches from ADR-0018, and existing choices were carried over.

## Consequences

- Error and notification text no longer says "loan", so it reads right for shopping as well as lending.
- Anyone can send invites, but someone only appears in your list once they accept your link.
