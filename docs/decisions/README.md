# Architecture Decision Records

An ADR records one significant decision: the context, what was decided, and the consequences. ADRs are never rewritten. If a decision changes, a new ADR supersedes the old one.

| # | Decision | Status |
|---|---|---|
| [0001](0001-pwa-instead-of-native.md) | Ship as a PWA instead of a native app | Accepted |
| [0002](0002-supabase-backend.md) | Use Supabase for database, auth and jobs | Accepted |
| [0003](0003-writes-through-database-functions.md) | All writes go through database functions | Accepted |
| [0004](0004-payment-allocation.md) | Allocate payments oldest-instalment first, charge before principal | Accepted |
| [0005](0005-authentication-providers.md) | Google and email magic link; defer Apple | Accepted |
| [0006](0006-lending-relationships-not-groups.md) | Model lender–borrower relationships, not family groups | Accepted |
| [0007](0007-money-as-integer-cents.md) | Store money as integer cents | Accepted |
| [0008](0008-lender-access-and-invites.md) | Lender access is granted manually; borrowers join by single-use invite | Accepted |

New ADRs copy [`template.md`](template.md).
