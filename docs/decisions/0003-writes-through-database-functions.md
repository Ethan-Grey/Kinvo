# 0003. All writes go through database functions

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Supabase lets clients insert and update tables directly, controlled by RLS policies. For financial records that's risky. A policy that allows a borrower to insert a repayment row can't easily also check that the amount is positive, the loan is active, the allocation is correct and an audit entry is written.

The brief requires that financial calculations are validated on the server and that loans and repayments can't be modified without authorisation.

## Decision

- RLS grants authenticated users `SELECT` only, on rows they're party to.
- No role used by clients has `INSERT`, `UPDATE` or `DELETE` on financial tables.
- Every change is a `SECURITY DEFINER` Postgres function (for example `propose_terms`, `accept_terms`, `confirm_funds_sent`, `record_repayment`, `confirm_repayment`). Each function:
  1. checks the caller is allowed to do this,
  2. validates the input and current state,
  3. makes the change,
  4. writes a `loan_events` row,
  5. queues any notifications,
  all in one transaction.

## Consequences

- Rules live in one place and can't be bypassed by a modified client.
- Every change is audited without relying on the developer remembering to log it.
- `SECURITY DEFINER` functions bypass RLS, so each one must check permissions itself. Every function gets pgTAP tests for both allowed and denied callers.
- Functions must set a fixed `search_path` to prevent hijacking.

## Alternatives considered

- **Direct table writes with RLS:** can't express multi-step validation or guarantee audit entries.
- **Edge Functions (TypeScript) for all writes:** works, but adds a network hop and splits a transaction across two systems.
