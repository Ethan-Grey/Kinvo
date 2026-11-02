-- =============================================================================
-- Deleting a user who accepted an invite failed:
--   lender_invites.accepted_by is "on delete set null", but the check
--   lender_invites_accepted_pair required accepted_by and accepted_at to be
--   both set or both empty. So the cleanup itself broke the rule.
--
-- New rule: an accepted invite always has accepted_at; accepted_by may be
-- empty afterwards if that person's account was deleted. The invite stays
-- "used" (accepted_at is what the invite functions check), so it can't be
-- reused.
-- =============================================================================
alter table public.lender_invites drop constraint lender_invites_accepted_pair;
alter table public.lender_invites add constraint lender_invites_accepted_pair
  check (accepted_by is null or accepted_at is not null);
