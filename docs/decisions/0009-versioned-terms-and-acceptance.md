# 0009. Versioned terms, fingerprinted acceptance and two-way negotiation

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

A loan's terms may go back and forth several times before both people agree. Afterwards, there must be no doubt about exactly what each person accepted (AG-03), and nothing previously agreed may be silently overwritten.

Two concrete risks:

1. Someone opens a proposal, the other person sends a counter-offer, and the first person accepts terms that are no longer current.
2. A record says "Bob accepted version 2", but version 2 could later be edited.

## Decision

- **Every proposal is a new, immutable `loan_terms` row** with its own instalments. Nothing is updated in place.
- **Each version gets a SHA-256 fingerprint** of a canonical JSON description: amounts, every instalment, and the late-payment and other conditions.
- **Accepting sends back the version id and fingerprint the user was shown.** The database rejects the acceptance if either no longer matches the current terms, or if the stored terms no longer produce that fingerprint.
- **Proposing counts as the proposer's acceptance.** Either party can counter, in either direction, until the other accepts.
- **Counter-offers must name the version they respond to**, so a newer proposal is never overwritten unseen.
- **The one-off charge is entered in dollars, and shown as a percentage of the amount borrowed** so the cost is obvious to both people.
- **Late-payment terms are plain text.** Kinvo never applies fees automatically (CA-04, CA-05).

## Consequences

- The full negotiation history is always visible, and each acceptance can be checked against its fingerprint.
- A stale screen can't produce a wrong agreement. The user sees "the terms changed" and reloads.
- Storage grows with each counter-offer. At family scale this is negligible.

## Alternatives considered

- **One mutable terms row with an audit log:** history exists, but reconstructing exactly what was shown is harder and depends on the log being complete.
- **Lender-only counters:** simpler, but the brief's own example has a borrower proposing their own plan, and both directions use the same mechanism anyway.
