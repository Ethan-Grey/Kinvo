-- A new loan status for loans the lender has removed (e.g. a test entry).
-- In its own migration because a new enum value can't be used in the same
-- transaction that adds it.
alter type public.loan_status add value if not exists 'removed';
