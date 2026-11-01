# 0002. Use Supabase for database, auth and jobs

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Kinvo needs a relational database (loans, terms, instalments and payments are naturally relational), authentication, per-user access control, and a daily scheduled job for reminders. It should be free at family scale.

## Decision

Use Supabase: managed PostgreSQL with Row Level Security, Supabase Auth, and scheduled Edge Functions.

## Consequences

- Access control is enforced in the database itself, so a bug in the frontend can't leak another user's data.
- Plain SQL migrations live in the repo and are reviewable in pull requests.
- The free tier pauses projects after a period of inactivity. The daily reminder job keeps the project active. Production may need a paid plan if this proves unreliable.
- Business logic is partly in SQL (PL/pgSQL), which requires database tests (pgTAP) alongside TypeScript tests.

## Alternatives considered

- **Firebase:** document database is a poor fit for relational financial records; security rules are less expressive than SQL policies.
- **Custom Node API + Postgres:** more code to write and host, with no real benefit at this scale.
- **Self-hosting on a home server:** availability depends on home power and internet, which is a poor fit for money records.
