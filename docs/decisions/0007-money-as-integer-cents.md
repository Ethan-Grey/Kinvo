# 0007. Store money as integer cents

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Floating-point numbers can't represent most decimal amounts exactly (in JavaScript, `0.1 + 0.2 === 0.30000000000000004`). Small errors in a ledger accumulate and cause balances that are off by a cent.

## Decision

- Store every amount as a whole number of cents: `bigint` in PostgreSQL, `number` (checked with `Number.isSafeInteger`) in TypeScript.
- Convert to dollars only when displaying, using `Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' })`.
- Parse user input from a string into cents directly, without passing through a float.
- All amounts are NZD. There is no multi-currency support.

## Consequences

- Arithmetic is exact, and totals always reconcile.
- Every place money enters or leaves the system needs the conversion helpers. These live in `domain/money.ts` and are fully unit tested.

## Alternatives considered

- **`numeric` in Postgres and a decimal library in TypeScript:** works, but adds a dependency and two representations to keep in sync.
