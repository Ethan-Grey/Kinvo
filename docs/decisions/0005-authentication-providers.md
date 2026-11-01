# 0005. Google and email magic link; defer Apple

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

The brief asks for Google and Apple sign-in. Configuring Sign in with Apple requires a paid Apple Developer Program membership, even for websites. The project has no budget, and some users may not have Google accounts.

## Decision

Support Google sign-in and passwordless email magic links through Supabase Auth. Defer Sign in with Apple.

## Consequences

- Everyone can sign in: Google users in one tap, everyone else by email.
- No passwords are stored, so there's nothing to leak or reset.
- Magic-link emails depend on a reliable email provider, which is needed for notifications anyway.
- Apple sign-in can be added later without changes to the data model, since all providers map to the same `auth.users` record.

## Alternatives considered

- **Email and password:** password resets and storage add risk and friction for non-technical family members.
- **Apple now:** blocked on cost.
