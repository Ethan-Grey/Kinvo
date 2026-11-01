# Database schema (draft)

This is the planned schema. It will be implemented as migrations in milestone 3. Names and columns may change during implementation. If they do, this document is updated in the same pull request.

## Entity relationships

```mermaid
erDiagram
    profiles ||--o{ lender_invites : creates
    profiles ||--o{ lending_relationships : "is lender in"
    profiles ||--o{ lending_relationships : "is borrower in"
    lending_relationships ||--o{ loans : contains
    loans ||--|{ loan_terms : "has versions"
    loan_terms ||--|{ instalments : schedules
    loan_terms ||--o{ term_acceptances : "accepted by"
    loans ||--o{ repayments : receives
    repayments ||--o{ repayment_allocations : "split into"
    instalments ||--o{ repayment_allocations : "covered by"
    loans ||--o{ loan_events : "audit log"
    profiles ||--o{ notifications : receives
```

## Tables

All primary keys are `uuid`. All money columns are `bigint` cents with `CHECK (... >= 0)`. All tables have `created_at timestamptz not null default now()`.

### `profiles`
One row per signed-in user, linked to Supabase's `auth.users`.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK, FK → `auth.users.id` |
| display_name | text | |
| email | text | Copied from auth for notifications |

### `lender_invites`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| lender_id | uuid | FK → profiles |
| token_hash | text | Hash of the secret in the link. The raw token is never stored. |
| expires_at | timestamptz | |
| used_by | uuid | FK → profiles, null until used |
| revoked_at | timestamptz | |

### `lending_relationships`
Links one lender to one borrower. Replaces the `family_groups` idea from the brief (see ADR-0006).

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| lender_id | uuid | FK → profiles |
| borrower_id | uuid | FK → profiles |
| ended_at | timestamptz | Null while active |

Constraints: `UNIQUE (lender_id, borrower_id)`, `CHECK (lender_id <> borrower_id)`.

### `loans`
The "envelope" for one loan. Terms live in `loan_terms`. The brief's separate `loan_requests` table is folded in here: a request is just a loan in the `negotiating` state whose first terms version was proposed by the borrower.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| relationship_id | uuid | FK → lending_relationships |
| status | loan_status enum | `negotiating`, `agreed`, `active`, `completed`, `rejected`, `withdrawn`, `written_off` |
| reason | text | Borrower's stated reason |
| current_terms_id | uuid | FK → loan_terms, the latest version |
| funds_sent_at | timestamptz | Set when the lender confirms (AG-04) |

### `loan_terms`
Immutable. A counter-offer inserts a new row; nothing is updated.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| loan_id | uuid | FK → loans |
| version | int | 1, 2, 3... `UNIQUE (loan_id, version)` |
| proposed_by | uuid | FK → profiles |
| principal_cents | bigint | `> 0` |
| charge_cents | bigint | One-off charge, `>= 0` |
| late_terms | text | Plain-language late-payment terms, may be empty |
| conditions | text | Other agreed conditions |
| terms_hash | text | SHA-256 of the canonical terms, used in acceptances |

### `instalments`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| terms_id | uuid | FK → loan_terms |
| sequence | int | 1, 2, 3... |
| due_on | date | NZ calendar date |
| amount_cents | bigint | `> 0` |

Rule (checked in the proposing function): `sum(amount_cents) = principal_cents + charge_cents`.

### `term_acceptances`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| terms_id | uuid | FK → loan_terms |
| accepted_by | uuid | FK → profiles |
| terms_hash | text | Must equal `loan_terms.terms_hash` at acceptance time |
| accepted_at | timestamptz | |

`UNIQUE (terms_id, accepted_by)`.

### `repayments`
Never updated except for status transitions, and never deleted.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| loan_id | uuid | FK → loans |
| amount_cents | bigint | `> 0` |
| received_on | date | |
| method | payment_method enum | `bank_transfer`, `cash`, `other` |
| reference | text | Optional |
| notes | text | Optional |
| status | repayment_status enum | `claimed`, `confirmed`, `disputed`, `reversed` |
| submitted_by | uuid | FK → profiles |
| reverses_id | uuid | FK → repayments, set on a reversing entry |

### `repayment_allocations`
How a confirmed repayment was split. Written by the confirm function using ADR-0004's rules, then never changed.

| Column | Type | Notes |
|---|---|---|
| repayment_id | uuid | FK → repayments |
| instalment_id | uuid | FK → instalments, null for overpayment credit |
| charge_cents | bigint | |
| principal_cents | bigint | |

### `loan_events`
Append-only audit log. No role is ever granted `UPDATE` or `DELETE`.

| Column | Type | Notes |
|---|---|---|
| id | bigint | PK, identity |
| loan_id | uuid | FK → loans |
| actor_id | uuid | FK → profiles, null for system jobs |
| event_type | text | e.g. `terms_proposed`, `terms_accepted`, `funds_confirmed`, `repayment_confirmed` |
| payload | jsonb | Snapshot of what changed |
| occurred_at | timestamptz | |

### `notifications`
Outbox for emails and pushes. Rows are inserted by functions and sent by the scheduled job.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| recipient_id | uuid | FK → profiles |
| kind | text | e.g. `instalment_due_tomorrow` |
| loan_id | uuid | FK → loans, nullable |
| channel | text | `email`, `push` |
| send_after | timestamptz | |
| sent_at | timestamptz | |

`UNIQUE (recipient_id, kind, loan_id, send_after)` stops duplicate reminders.

## Derived views

| View | Purpose |
|---|---|
| `instalment_status` | Per instalment: amount covered, remaining, `paid` / `due` / `overdue` |
| `loan_balances` | Per loan: total owed, total confirmed paid, outstanding, credit |
| `borrower_history` | Per relationship: loans, totals, on-time rate, average days late |

## Row Level Security summary

| Table | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| profiles | Self, and people you share a relationship with | Self (display name only) |
| lending_relationships, loans, loan_terms, instalments, term_acceptances, repayments, repayment_allocations, loan_events | Lender or borrower of the relationship | None. Functions only. |
| lender_invites | The lender who created it | None. Functions only. |
| notifications | The recipient | None |
