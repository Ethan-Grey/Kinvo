# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Proof of payment on every loan, for both lender and borrower. It's in two parts: the money the lender sent, and the payments back grouped by the instalment they paid off (a payment that covers two instalments shows under both). Each entry is a date and an amount; tap it to open the receipt full size or save it. Payments waiting to be confirmed are listed first.
- Phone notifications (ADR-0017): loan requests, payments and due dates pop up like a message, even with Kinvo closed. Turn them on per device in Account, or from the one-off card on Home. On iPhone, Kinvo needs to be on the Home Screen (iOS 16.4+). The app icon shows the unread count.
- Notifications and emails now go out the moment something happens, instead of within 5 minutes.
- Receipts (ADR-0016): every payment, and the lender sending the loan, needs a photo of the receipt or bank statement. Choose a photo, or paste an image copied from your banking app. Both people can view it. Images are re-encoded on the phone, which strips hidden data, and stored privately.
- Profile photos, visible only to you and the people you lend to or borrow from.
- New members confirm their real name (and can add a photo) before using the app.
- A clear Pay back button on Home, and a full-width bar for each person a borrower owes, with their own Pay button.
- Lenders can remove a loan that shouldn't be there, such as a test or a mistake (ADR-0015). It disappears from lists, totals, track records, reminders and alerts for both people, and the audit log keeps a note.
- "Clear all" on Alerts.

### Changed

- Only the lender sets a charge (ADR-0015). Borrowers' requests have none. Once the lender proposes one, the borrower can change the amount or plan, and the charge follows the lender's rate.
- One question per step:
  - Asking for, offering or changing a loan goes through short steps: who, how much, any charge, how it's paid back, then check and send.
  - Recording a payment asks how much, then how and when.
  - The loan page shows the proposal in one sentence. Accept, Suggest changes, I've sent the money and Record a payment each open their own page.
- Screens update by themselves (ADR-0014): a new loan request or payment appears on the other person's open app within seconds. The app also refreshes when reopened and when you pull down from the top of a screen.
- New look and navigation (docs/design.md):
  - A bottom tab bar with a raised + for the most common actions.
  - Repayment rings around each person.
  - A bold balance card, and "Needs you" tiles on Home.
  - Filters on the loan list, and a timeline for each loan's schedule.
  - Alerts with icons, grouped by day.
  - A settings-style Account page.
- Faster forms:
  - One-tap charge and payment amounts.
  - Pill buttons for payment method and frequency.
  - Optional terms tucked away until needed.
  - A person picker for new loans.
- Bricolage Grotesque for headings and amounts, self-hosted.

## [1.0.0] - 2026-11-02

First complete release: loans, agreements, repayments, dashboards, notifications and account settings (milestones M0–M7).

### Security

- Content Security Policy and other security headers on every page. The theme script moved out of the HTML so inline scripts can be forbidden.
- Schema-wide security audit in pgTAP: RLS on every table, no direct writes, no anonymous access, pinned `search_path`.
- `npm audit` in CI and weekly Dependabot updates.
- docs/security.md: threat model, controls and known limitations.

### Added

- Account page (person icon in the header): change your name, switch notification emails off, choose light or dark mode, download all your data as JSON, and sign out. Notification emails link to it.
- Automatic Supabase deploys: merging a change to migrations or Edge Functions applies it to the live project (docs/setup.md, section 7).
- Accessibility: a "Skip to content" link, a page title for each screen, and automated axe-core checks on every main component.
- Notifications (ADR-0013). A bell in the header with an unread count, and a list of everything that needs you, each linking to its loan.
- Emails for every loan and payment event the other person needs to know about, sent through Gmail by a new `send-notifications` Edge Function from a retrying outbox.
- Reminders at 9am NZ: to the borrower the day before and on the day a payment is due, and to both people the day after a missed payment, then weekly. 32 more pgTAP tests, Deno tests for the email builder, and a CI job for the Edge Function.
- Existing debts: when inviting someone, a lender can record money they already owe from before Kinvo, with a repayment plan. The borrower sees it before joining and must confirm it; once confirmed it's active straight away (ADR-0012). 20 more pgTAP tests.
- Bottom tab bar: Home, Loans and People.
- Home dashboard: a "Needs you" panel (proposals to answer, money to send, payments to confirm or disputed), lending figures (owed to you, overdue, total lent, charges received this tax year), borrowing figures (what you owe, next payment) and upcoming payments across all loans.
- People tab and person pages, with each borrower's track record (on-time payments and average lateness), visible to the lender only (ADR-0011).
- Lenders can stop lending to someone from their person page; history is kept.
- Payment allocation refactored into a single replay that also reports how each payment was split; 22 more pgTAP tests.

- Kinvo colour palette (Frozen Lake, Soft Periwinkle, Violet Twilight, Indigo, Dark Amethyst) on pure white or pure black backgrounds with no tints, a matching app icon, and every text/background pair checked against WCAG AA (docs/design.md).
- Repayments: lenders record payments directly; borrowers tap "I've paid" and the lender confirms or disputes it.
- Balances, progress bar and per-instalment status (paid, due, overdue from the day after the due date), calculated by replaying confirmed payments (ADR-0010).
- Corrections by reversal with a reason, never by editing or deleting; loans complete automatically and reopen if a reversal leaves money owed.
- Lenders can forgive the remaining balance, closing the loan as written off.
- Loan list shows what's owed, the next due date and an Overdue badge.
- 41 more pgTAP tests and 5 component tests.
- Light and dark mode, with a three-way switch (light, match device, dark) in the header and on the sign-in screen. The choice is saved per device and applied before the page paints.
- Loans: borrowers request and lenders offer, with counter-offers in either direction until one side accepts.
- Terms form with an even-split schedule builder (weekly, fortnightly, monthly) and editable payments; the charge is shown as a percentage of the amount borrowed.
- Loan agreement: full terms, a confirmation checkbox and **Accept Loan Agreement**, recorded with a SHA-256 fingerprint of the exact terms (ADR-0009).
- Loans become active only when the lender confirms the money was sent (date, method, reference).
- Loan list on the home screen with "your reply needed" first, and a loan page with the proposal history.
- Database migration with Row Level Security and 41 more pgTAP tests; date and schedule maths with unit tests.
- Sign in with Google or an email code (Supabase Auth).
- Lender invite links: single-use, 7-day expiry, hashed tokens, limit of 10 open per lender.
- People screen showing who you lend to and borrow from, with invite management for lenders.
- First database migration: profiles, invites, lending relationships, append-only audit events, Row Level Security and API functions.
- 37 pgTAP database tests and a CI job that runs them on every pull request.
- ADR-0008 (lender access and invites) and a setup guide.

### Fixed

- The database now waits up to 60 seconds for the email sender, instead of timing out on its first, slower start.
- Email sign-in now uses a one-time code, with a link fallback that works in any browser. Links alone failed when opened in a different browser, and can never reach an app installed on an iPhone home screen.
- Sign-in errors (unauthorised address, rate limits, expired codes) now explain what happened instead of a generic message.
- A deploy missing its configuration, or any crash, now shows an error screen instead of a blank page.

## [0.1.0] - 2026-11-02

### Added

- Web app scaffold: Vite, React 19, TypeScript (strict), Tailwind CSS 4.
- Installable PWA: manifest, app icons and service worker.
- `domain/money.ts`: integer-cent parsing, formatting, summing and proportional allocation, with unit tests.
- ESLint rule keeping `domain/` free of React, Supabase and other app layers.
- GitHub Actions CI: type check, lint, unit tests and build on every pull request.
- npm workspaces at the repository root.
- Project requirements, architecture overview and draft database schema.
- Architecture Decision Records 0001–0007.
- Contribution guidelines, issue templates and pull request template.

[Unreleased]: https://github.com/Ethan-Grey/Kinvo/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Ethan-Grey/Kinvo/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/Ethan-Grey/Kinvo/releases/tag/v0.1.0
