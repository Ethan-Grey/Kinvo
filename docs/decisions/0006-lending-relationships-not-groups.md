# 0006. Model lender–borrower relationships, not family groups

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

The brief suggests `family_groups` and `group_members` tables, and says the system should eventually support multiple lenders. It doesn't define what a group is for. Groups would complicate access rules (can group members see each other's loans?) without a clear need.

## Decision

Model a direct `lending_relationships` row between one lender and one borrower. A borrower joins by opening a lender's invite link. Loans belong to a relationship.

## Consequences

- Multiple lenders work naturally: each has their own relationships, and one person can be a lender in one and a borrower in another.
- Access rules stay simple: you see loans in relationships you're part of.
- Groups can be added later as an optional layer on top of relationships if a real need appears.

## Alternatives considered

- **Family groups from the start:** unclear purpose, harder privacy rules.
- **No relationship table (loans link users directly):** no way to manage invites, end a relationship, or show per-borrower history cleanly.
