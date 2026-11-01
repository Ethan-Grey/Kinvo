-- =============================================================================
-- Tests for loans, versioned terms and agreement acceptance (M3).
-- Run with:  npx supabase test db
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

-- -----------------------------------------------------------------------------
-- Fixtures: Lena (lender), Bob (borrower), Casey (outsider)
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'lena@example.test',  '{"full_name": "Lena Lender"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test',   '{"full_name": "Bob Borrower"}'),
  ('00000000-0000-4000-8000-00000000000c', 'casey@example.test', '{"full_name": "Casey Outsider"}');

update public.profiles set can_lend = true where id = '00000000-0000-4000-8000-00000000000a';

insert into public.lending_relationships (id, lender_id, borrower_id) values (
  '00000000-0000-4000-8000-0000000000e1',
  '00000000-0000-4000-8000-00000000000a',
  '00000000-0000-4000-8000-00000000000b'
);

-- NZ calendar dates relative to today.
select set_config('test.yesterday', ((now() at time zone 'Pacific/Auckland')::date - 1)::text, true);
select set_config('test.d1', ((now() at time zone 'Pacific/Auckland')::date + 7)::text, true);
select set_config('test.d2', ((now() at time zone 'Pacific/Auckland')::date + 14)::text, true);
select set_config('test.today', ((now() at time zone 'Pacific/Auckland')::date)::text, true);
select set_config('test.tomorrow', ((now() at time zone 'Pacific/Auckland')::date + 1)::text, true);

-- Helper: a one-instalment schedule for a given date and amount.
create function pg_temp.one(d text, cents bigint) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('due_on', d, 'amount_cents', cents));
$$;
create function pg_temp.two(d1 text, c1 bigint, d2 text, c2 bigint) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('due_on', d1, 'amount_cents', c1),
    jsonb_build_object('due_on', d2, 'amount_cents', c2));
$$;
grant execute on all functions in schema pg_temp to authenticated;


-- =============================================================================
-- Bob requests $200 with no charge, repaid in one instalment
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);

select lives_ok(
  $$ select set_config('test.loan', public.create_loan(
       '00000000-0000-4000-8000-0000000000e1', 20000, 0,
       pg_temp.one(current_setting('test.d1'), 20000), 'Car repair')::text, true) $$,
  'a borrower can request a loan'
);
select is(
  (select status::text from public.loans where id = current_setting('test.loan')::uuid),
  'negotiating', 'a new request is negotiating'
);
select is(
  (select version || ' by ' || proposed_by from public.loan_terms where loan_id = current_setting('test.loan')::uuid),
  '1 by 00000000-0000-4000-8000-00000000000b', 'the request is version 1, proposed by the borrower'
);
select is(
  (select count(*)::int from public.term_acceptances a
   join public.loan_terms t on t.id = a.terms_id
   where t.loan_id = current_setting('test.loan')::uuid and a.accepted_by = '00000000-0000-4000-8000-00000000000b'),
  1, 'proposing counts as accepting your own proposal'
);
select is(
  (select char_length(terms_hash) from public.loan_terms where loan_id = current_setting('test.loan')::uuid),
  64, 'terms have a SHA-256 fingerprint'
);

select set_config('test.v1', (select id::text from public.loan_terms where loan_id = current_setting('test.loan')::uuid), true);
select set_config('test.v1_hash', (select terms_hash from public.loan_terms where id = current_setting('test.v1')::uuid), true);


-- -----------------------------------------------------------------------------
-- Schedule validation
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ select public.create_loan('00000000-0000-4000-8000-0000000000e1', 20000, 0,
       pg_temp.one(current_setting('test.d1'), 19999)) $$,
  'P0001', 'schedule_total_mismatch', 'instalments must add up to principal + charge'
);
select throws_ok(
  $$ select public.create_loan('00000000-0000-4000-8000-0000000000e1', 20000, 0,
       pg_temp.one(current_setting('test.yesterday'), 20000)) $$,
  'P0001', 'schedule_date_in_past', 'due dates cannot be in the past'
);
select throws_ok(
  $$ select public.create_loan('00000000-0000-4000-8000-0000000000e1', 20000, 0,
       pg_temp.two(current_setting('test.d1'), 10000, current_setting('test.d1'), 10000)) $$,
  'P0001', 'schedule_dates_not_increasing', 'due dates must be in order with no repeats'
);
select throws_ok(
  $$ select public.create_loan('00000000-0000-4000-8000-0000000000e1', 20000, 0, '[]'::jsonb) $$,
  'P0001', 'invalid_schedule', 'a schedule needs at least one instalment'
);
select throws_ok(
  $$ select public.create_loan('00000000-0000-4000-8000-0000000000e1', 0, 0,
       pg_temp.one(current_setting('test.d1'), 1)) $$,
  'P0001', 'invalid_principal', 'the amount borrowed must be positive'
);
select throws_ok(
  $$ select public.create_loan('00000000-0000-4000-8000-0000000000e1', 20000, -1,
       pg_temp.one(current_setting('test.d1'), 19999)) $$,
  'P0001', 'invalid_charge', 'the charge cannot be negative'
);


-- -----------------------------------------------------------------------------
-- Bob can't accept or reject his own proposal
-- -----------------------------------------------------------------------------
select throws_ok(
  format('select public.accept_terms(%L, %L, %L)',
    current_setting('test.loan'), current_setting('test.v1'), current_setting('test.v1_hash')),
  'P0001', 'cannot_accept_own_terms', 'you cannot accept your own proposal'
);
select throws_ok(
  format('select public.reject_terms(%L)', current_setting('test.loan')),
  'P0001', 'cannot_reject_own_terms', 'you cannot reject your own proposal'
);


-- =============================================================================
-- Casey, an outsider, sees and can do nothing
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c"}', true);

select throws_ok(
  $$ select public.create_loan('00000000-0000-4000-8000-0000000000e1', 20000, 0,
       pg_temp.one(current_setting('test.d1'), 20000)) $$,
  'P0001', 'relationship_not_found', 'outsiders cannot create loans in a relationship'
);
select is((select count(*)::int from public.loans), 0, 'outsiders see no loans');
select is((select count(*)::int from public.loan_terms), 0, 'outsiders see no terms');
select is((select count(*)::int from public.instalments), 0, 'outsiders see no instalments');
select throws_ok(
  format('select public.accept_terms(%L, %L, %L)',
    current_setting('test.loan'), current_setting('test.v1'), current_setting('test.v1_hash')),
  'P0001', 'loan_not_found', 'outsiders cannot accept terms'
);


-- =============================================================================
-- Lena counter-offers: $200 + $20 charge, two instalments of $110
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);

select throws_ok(
  format($f$ select public.counter_offer(%L, gen_random_uuid(), 20000, 2000,
       pg_temp.two(current_setting('test.d1'), 11000, current_setting('test.d2'), 11000)) $f$,
    current_setting('test.loan')),
  'P0001', 'terms_changed', 'a counter-offer must be based on the latest version'
);
select lives_ok(
  format($f$ select set_config('test.v2', public.counter_offer(%L, %L, 20000, 2000,
       pg_temp.two(current_setting('test.d1'), 11000, current_setting('test.d2'), 11000),
       'Talk to me if you will be late', '', 'Can do it with a small charge')::text, true) $f$,
    current_setting('test.loan'), current_setting('test.v1')),
  'the lender can counter-offer'
);
select is(
  (select version from public.loan_terms where id = current_setting('test.v2')::uuid),
  2, 'the counter-offer is version 2'
);
select is(
  (select count(*)::int from public.loan_terms where loan_id = current_setting('test.loan')::uuid),
  2, 'version 1 is kept, not overwritten'
);
select throws_ok(
  format('select public.accept_terms(%L, %L, %L)',
    current_setting('test.loan'), current_setting('test.v1'), current_setting('test.v1_hash')),
  'P0001', 'terms_changed', 'superseded terms cannot be accepted'
);


-- =============================================================================
-- Bob accepts version 2
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select set_config('test.v2_hash', (select terms_hash from public.loan_terms where id = current_setting('test.v2')::uuid), true);

select throws_ok(
  format('select public.withdraw_loan(%L)', current_setting('test.loan')),
  'P0001', 'cannot_withdraw_their_terms', 'you reject, not withdraw, the other person''s proposal'
);
select throws_ok(
  format('select public.accept_terms(%L, %L, %L)',
    current_setting('test.loan'), current_setting('test.v2'), repeat('0', 64)),
  'P0001', 'terms_changed', 'acceptance requires the exact terms fingerprint that was shown'
);
select lives_ok(
  format('select public.accept_terms(%L, %L, %L)',
    current_setting('test.loan'), current_setting('test.v2'), current_setting('test.v2_hash')),
  'the borrower can accept the lender''s counter-offer'
);
select is(
  (select status::text from public.loans where id = current_setting('test.loan')::uuid),
  'agreed', 'accepting makes the loan agreed, not active'
);
select is(
  (select count(*)::int from public.term_acceptances
   where terms_id = current_setting('test.v2')::uuid and terms_hash = current_setting('test.v2_hash')),
  2, 'both parties have accepted the same fingerprint'
);
select throws_ok(
  format($f$ select public.counter_offer(%L, %L, 20000, 0,
       pg_temp.one(current_setting('test.d1'), 20000)) $f$,
    current_setting('test.loan'), current_setting('test.v2')),
  'P0001', 'loan_not_negotiating', 'agreed terms cannot be countered'
);
select throws_ok(
  format('select public.confirm_funds_sent(%L, %L, %L)',
    current_setting('test.loan'), current_setting('test.today'), 'bank_transfer'),
  'P0001', 'lender_only', 'only the lender can confirm funds were sent'
);


-- =============================================================================
-- Lena confirms the money was sent
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);

select throws_ok(
  format('select public.confirm_funds_sent(%L, %L, %L)',
    current_setting('test.loan'), current_setting('test.tomorrow'), 'bank_transfer'),
  'P0001', 'invalid_sent_date', 'funds cannot be confirmed for a future date'
);
select lives_ok(
  format('select public.confirm_funds_sent(%L, %L, %L, %L)',
    current_setting('test.loan'), current_setting('test.today'), 'bank_transfer', 'KINVO-1'),
  'the lender can confirm funds were sent'
);
select is(
  (select status::text || ' / ' || funds_method::text from public.loans where id = current_setting('test.loan')::uuid),
  'active / bank_transfer', 'the loan is active once funds are confirmed'
);
select throws_ok(
  format('select public.withdraw_loan(%L)', current_setting('test.loan')),
  'P0001', 'loan_not_cancellable', 'an active loan cannot be withdrawn'
);
select throws_ok(
  $$ select public.end_relationship('00000000-0000-4000-8000-0000000000e1') $$,
  'P0001', 'relationship_has_open_loans', 'a relationship with an active loan cannot be ended'
);


-- -----------------------------------------------------------------------------
-- Direct writes are blocked
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ update public.loans set status = 'completed' $$,
  '42501', null, 'parties cannot change loan status directly'
);
select throws_ok(
  $$ update public.instalments set amount_cents = 1 $$,
  '42501', null, 'parties cannot edit the schedule directly'
);


-- -----------------------------------------------------------------------------
-- Audit trail
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select is(
  (select string_agg(event_type, ',' order by id) from public.audit_events
   where loan_id = current_setting('test.loan')::uuid),
  'loan_requested,terms_proposed,terms_accepted,funds_confirmed',
  'every step is recorded, and visible to the borrower'
);


-- =============================================================================
-- Rejection, and lender access being removed
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select set_config('test.loan2', public.create_loan(
  '00000000-0000-4000-8000-0000000000e1', 5000, 0,
  pg_temp.one(current_setting('test.d1'), 5000), null, '', '', 'Offer for the bus fare')::text, true);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select lives_ok(
  format('select public.reject_terms(%L, %L)', current_setting('test.loan2'), 'Sorted it, thanks'),
  'the borrower can reject a lender''s offer'
);
select is(
  (select status::text from public.loans where id = current_setting('test.loan2')::uuid),
  'rejected', 'a rejected loan is closed'
);

reset role;
update public.profiles set can_lend = false where id = '00000000-0000-4000-8000-00000000000a';
set local role authenticated;
select throws_ok(
  $$ select public.create_loan('00000000-0000-4000-8000-0000000000e1', 20000, 0,
       pg_temp.one(current_setting('test.d1'), 20000)) $$,
  'P0001', 'lender_access_required', 'no new loans once the lender loses lender access'
);

select * from finish();
rollback;
