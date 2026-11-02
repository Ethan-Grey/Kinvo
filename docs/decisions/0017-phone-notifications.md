# 0017. Phone notifications through Web Push, sent the moment something happens

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Email (ADR-0013) and live updates while the app is open (ADR-0014) don't tell someone with Kinvo closed that a loan request or payment has arrived. Family members expect a pop-up like a message. Kinvo is a web app installed to the Home Screen, not an App Store app.

## Decision

- **Web Push with VAPID keys.** It works in Chrome, Edge and Firefox, and on iPhone and iPad from iOS 16.4 when Kinvo is opened from the Home Screen. No Apple developer account, App Store listing or Firebase project is needed.
- **One subscription per device.** It's turned on from a tap ("Notify this phone" in Account, or the one-off card on Home), because browsers only ask for permission after a tap. Subscriptions go in `push_subscriptions` through `save_push_subscription`. People only see their own; no one can insert directly.
- **Same outbox as email.** `notifications` gains `push_status`. The `send-notifications` function claims pending pushes with `SKIP LOCKED`, encrypts each with `web-push`, sends it, and records the result. Devices the push service reports as gone (404/410) are deleted. Alerts older than a day aren't pushed.
- **Sent straight away.** A statement-level trigger on `notifications` calls the sender through pg_net after commit. The 5-minute schedule stays as a fallback. This also makes emails near-instant.
- **Minimal payload.** Only the title, a short text, an in-app link and the unread count go in the push. The service worker only ever opens pages of Kinvo itself, and it sets the app icon badge.

## Consequences

- Each person has to turn it on once per device. iPhone users have to add Kinvo to the Home Screen first, and the app explains how.
- Push content passes through Apple's, Google's or Mozilla's servers encrypted end to end (RFC 8291). The service can't read it, but it does see that a message was sent.
- The private VAPID key lives only in Edge Function secrets. If it leaks, rotate it and every device will need to turn notifications on again.

## Alternatives considered

- **A native iOS app with APNs:** the most native feel, but it needs an Apple developer account, App Store review and a second codebase.
- **Firebase Cloud Messaging:** another account and SDK, and it still relies on Web Push on iPhone.
- **Sending pushes only on the 5-minute schedule:** simpler, but too slow to feel like a message.
