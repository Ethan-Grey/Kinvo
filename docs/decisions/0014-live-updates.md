# 0014. Live updates through Realtime on the notifications table

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

When one person asks for a loan or records a payment, the other person's open app didn't change until it was closed and reopened. Installed web apps on iPhone don't have the browser's pull-to-refresh either, so there was no obvious way to get fresh data.

## Decision

- **One live signal.** The app subscribes to Supabase Realtime `INSERT`s on `notifications`, filtered to the signed-in person. Every loan and payment event already creates a notification for the other person (ADR-0013), so "a notification arrived" means "something changed". One subscription covers everything, and Realtime applies the table's RLS, so nobody receives anyone else's.
- **Refresh everything that's on screen.** A shared refresh counter (`shared/refresh.ts`) is part of every `useAsync` request. Bumping it refetches every visible screen and the Alerts badge. Refreshes keep the current data on screen until the new data arrives, and a failed refresh keeps it too.
- **Belt and braces.** The counter also bumps when the app returns to the foreground, every 60 seconds while it's visible (phones pause sockets in the background), and when the user pulls down from the top of a screen.

## Consequences

- Changes show up within a second or two while the app is open, with no reopening.
- The Content Security Policy already allows `wss://` to the project's Supabase origin.
- It doesn't wake a closed app. That needs Web Push (NT-04), which can reuse the same notifications.
- Each open app holds one Realtime connection; fine for a family-sized app on the free tier.

## Alternatives considered

- **Subscribe to each table (loans, repayments, terms):** more precise, but more subscriptions, and RLS on joined tables is harder to reason about.
- **Polling only:** simple, but either slow (every minute) or wasteful (every few seconds).
