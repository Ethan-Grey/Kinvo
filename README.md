# Kinvo

[![CI](https://github.com/Ethan-Grey/Kinvo/actions/workflows/ci.yml/badge.svg)](https://github.com/Ethan-Grey/Kinvo/actions/workflows/ci.yml)

A private lending ledger for families. Kinvo records who borrowed what, on which terms, and how it's being repaid — so nobody has to rely on memory or screenshots of text messages.

> **Status:** Early development. The design is documented; application code is being built feature by feature. See the [roadmap](#roadmap).

## What it does

- **Loan requests and counter-offers.** A borrower asks for an amount and a repayment plan. The lender approves, rejects, or proposes different terms. Every proposal is kept as its own version.
- **Digital agreements.** Before a loan starts, the borrower sees the full terms (amount, charge, total, every due date) and explicitly accepts them. The exact terms accepted are stored and can't be edited afterwards.
- **Repayment tracking.** Partial, early and full payments. Balances are always *calculated* from the payment history, never typed in.
- **Borrower history.** On-time rate, days late, and totals, visible to the lender and to the borrower themselves.
- **Reminders.** Notifications before and on each due date.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React, TypeScript, Tailwind CSS | Typed UI, fast styling |
| App type | Progressive Web App | Installs on iPhone, Android and desktop without an app store |
| Backend | Supabase (PostgreSQL, Auth, Edge Functions) | Database-level security, auth and scheduled jobs in one place |
| Hosting | Vercel | Preview deploy per pull request, production from `main` |
| CI | GitHub Actions | Type checks, lint, tests and build on every PR |

The reasoning behind each major choice is recorded in [`docs/decisions/`](docs/decisions/).

## Repository layout

```text
kinvo/
├── apps/web/            React PWA (frontend)
├── supabase/
│   ├── migrations/      Versioned SQL: tables, security policies, functions
│   └── seed.sql         Fictional demo data only
├── docs/
│   ├── requirements.md  What the system must do
│   ├── architecture.md  How the pieces fit together
│   ├── database-schema.md
│   └── decisions/       Architecture Decision Records (ADRs)
├── tests/               Cross-cutting tests (database permissions, end-to-end)
└── .github/             CI workflows, issue and PR templates
```

## Design principles

1. **Money is never a float.** All amounts are stored as integer cents.
2. **Nothing financial is overwritten.** Corrections are new records that reverse old ones, so the full history is always visible.
3. **The database enforces the rules.** Clients can read their own data, but every change (accepting terms, recording a payment) goes through a server-side function that validates it.
4. **Status is derived, not stored where it can drift.** "Overdue" is calculated from due dates and payments, not set by hand.

## Getting started

Requires Node.js 22+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
```

Every pull request runs type checks, lint, tests and a production build in GitHub Actions. See [`docs/setup.md`](docs/setup.md) for the database and hosted services, [`apps/web/README.md`](apps/web/README.md) for all scripts, and [`CONTRIBUTING.md`](CONTRIBUTING.md) for branch and commit conventions.

## Roadmap

- [x] **M0 — Foundation:** requirements, architecture, schema design, decision records
- [x] **M1 — Scaffold:** React + TypeScript + Tailwind, CI pipeline, Vercel previews
- [x] **M2 — Auth & onboarding:** Google and email sign-in, lender invite links
- [x] **M3 — Loans:** requests, counter-offers, versioned terms, agreement acceptance
- [ ] **M4 — Repayments:** recording, allocation, borrower payment claims
- [ ] **M5 — Dashboards:** lender and borrower views, borrower history
- [ ] **M6 — Notifications:** email reminders, then PWA push
- [ ] **M7 — Hardening:** security review, accessibility, release v1.0.0

## Legal note

Kinvo is a record-keeping tool. Accepting an agreement in the app is evidence of what was agreed, but it does not by itself guarantee a legally enforceable contract. Anyone using it for lending should get New Zealand legal advice for their situation.

## Privacy

This repository contains no real financial data. All seed and test data is fictional.
