# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Sign in with Google or an emailed magic link (Supabase Auth, PKCE flow).
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
