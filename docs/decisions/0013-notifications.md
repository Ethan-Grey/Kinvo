# 0013. Notifications are written by the database and emailed from an outbox

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

People need to hear about things that need them (a request to answer, money to confirm) and about due dates, without opening the app. The family uses a mix of phones, and PWA push on iPhone only works once the app is installed to the home screen, so email has to be the reliable channel. Emails must never be sent twice, never be lost if Gmail has a hiccup, and never be sent for something the person did themselves.

## Decision

- **One `notifications` table is both the in-app list and the email outbox.** Each row has the recipient, the wording (title and body), a link inside the app, and an email status (`pending`, `sending`, `sent`, `failed`).
- **The database writes the wording.** A trigger on `audit_events` turns each loan or payment event into a notification for the other person (never the actor). Because every write already goes through database functions that log an audit event (ADR-0003), nothing can change without the right person hearing about it.
- **Reminders come from a scheduled job.** `private.queue_reminders()` runs hourly via pg_cron and acts from 9am NZ time:
  - the borrower, the day before and on the day an instalment is due, for the amount still owed on it;
  - both people, the day after a missed instalment, then every 7 days while it stays unpaid.
  Lenders aren't told about routine due dates, only about problems and payments to confirm.
- **A `dedupe_key` (unique) makes every notification idempotent.** Re-running the job, or the job overlapping itself, can't create duplicates.
- **An Edge Function sends the emails.** pg_cron calls `send-notifications` every 5 minutes. It claims pending rows with `FOR UPDATE SKIP LOCKED`, sends them through Gmail SMTP (port 465), and marks each sent, or puts it back in the queue to retry (up to 5 attempts; a row stuck in `sending` for 10 minutes is retried). The function checks a shared secret rather than a user login, since it's called by the database.
- **In the app**, a bell in the header shows the unread count and opens the list. Opening the list marks everything read. The count refreshes on every page change and when the app returns to the foreground.

## Consequences

- Email and the in-app list always say the same thing, and the wording is tested in pgTAP alongside the rules.
- Adding PWA push later means adding a second sender over the same rows, not new triggers.
- Emails can arrive up to about 5 minutes after the event; reminders arrive between 9:05 and 10am NZ.
- There's no per-person opt-out yet (NT-05). Every notification is emailed.

## Alternatives considered

- **Sending from the web app after each action:** simpler, but misses anything done in another tab or by the scheduled job, and loses emails if the browser closes.
- **Supabase Database Webhooks per table:** one per table and event, harder to test, and still needs dedupe and retries.
- **A third-party email service (Resend, Postmark):** better deliverability and stats, but another account and API key for a family-sized volume Gmail handles fine.
- **Push first:** not reliable on iPhone unless installed, so it stays a later addition (NT-04).
