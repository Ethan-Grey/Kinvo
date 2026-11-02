# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
