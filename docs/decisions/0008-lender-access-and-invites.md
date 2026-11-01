# 0008. Lender access is granted manually; borrowers join by single-use invite

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Kinvo runs on a public URL, and anyone with a Google account or email address can sign in. The app holds private financial records, so being able to sign in must not mean being able to do anything.

We need to decide who can act as a lender, how borrowers get connected, and whether people can find each other.

## Decision

1. **Lender access is a flag (`profiles.can_lend`) set by an administrator**, in SQL or the Supabase dashboard. It can't be changed through the app's API. Everyone can be a borrower.
2. **Borrowers join only through invite links.** There is no user search, so nobody can discover who uses Kinvo.
3. **Invite links are single-use and expire after 7 days.** The link contains a 256-bit random token. Only its SHA-256 hash is stored.
4. **A lender can have at most 10 open invites**, limiting the damage if an account is compromised.
5. **Accepting an invite reopens an ended relationship** rather than creating a second one, so a borrower's history stays in one place.

## Consequences

- A stranger who signs in sees an empty app and can do nothing.
- Granting lender access is a manual step, documented in [`docs/setup.md`](../setup.md).
- A forwarded invite link can be used by whoever opens it first. The lender sees who accepted on their people list, and can end the relationship if it was the wrong person.
- Adding self-service lender sign-up later only needs a new function that sets `can_lend`; no schema change.

## Alternatives considered

- **Anyone can lend:** anyone finding the URL could use the app and its database.
- **Reusable family invite link:** simpler to share, but a leaked link lets anyone join as a borrower.
- **Join by searching a lender's email:** reveals whether an email address is registered.
