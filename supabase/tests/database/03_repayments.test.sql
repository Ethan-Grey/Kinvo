-- =============================================================================
-- Tests for repayments, allocation, balances and write-offs (M4).
-- Run with:  npx supabase test db
--
-- Scenario (the brief's example): Bob borrows $200 with a $100 charge, repaid
-- as two instalments of $150. Each instalment carries $50 of the charge.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

-- Every payment and money-sent needs a receipt (ADR-0016). These stand-ins
-- upload one and pass it along, so the tests can focus on the payment rules.
create function pg_temp.receipt(p_loan uuid) returns text language plpgsql security definer as $h$
declare v_path text := p_loan || '/' || gen_random_uuid() || '.jpg';
begin
  if to_regclass('storage.objects') is not null then
    execute 'insert into storage.objects (bucket_id, name) values ($1, $2)' using 'receipts', v_path;
  end if;
  return v_path;
end
$h$;
create function pg_temp.record_repayment(
  p_loan uuid, p_amount bigint, p_on date, p_method public.payment_method, p_ref text default null, p_notes text default null
) returns uuid language sql as $h$
  select public.record_repayment(p_loan, p_amount, p_on, p_method, p_ref, p_notes, pg_temp.receipt(p_loan));
$h$;
create function pg_temp.confirm_funds_sent(p_loan uuid, p_on date, p_method public.payment_method, p_ref text default null)
returns void language sql as $h$
  select public.confirm_funds_sent(p_loan, p_on, p_method, p_ref, pg_temp.receipt(p_loan));
$h$;
grant execute on all functions in schema pg_temp to authenticated;

-- -----------------------------------------------------------------------------
-- Fixtures
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

select set_config('test.today', ((now() at time zone 'Pacific/Auckland')::date)::text, true);
select set_config('test.tomorrow', ((now() at time zone 'Pacific/Auckland')::date + 1)::text, true);

-- Lena offers (only the lender sets a charge), Bob accepts, Lena sends the money.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select set_config('test.loan', public.create_loan(
  '00000000-0000-4000-8000-0000000000e1', 20000, 10000,
  jsonb_build_array(
    jsonb_build_object('due_on', current_setting('test.tomorrow'), 'amount_cents', 15000),
    jsonb_build_object('due_on', (current_setting('test.tomorrow')::date + 7)::text, 'amount_cents', 15000)
  ))::text, true);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select public.accept_terms(l.id, t.id, t.terms_hash)
from public.loans l join public.loan_terms t on t.id = l.current_terms_id
where l.id = current_setting('test.loan')::uuid;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);

-- Repaying before the loan is funded isn't possible.
select throws_ok(
  format('select pg_temp.record_repayment(%L, 1000, %L, %L)', current_setting('test.loan'), current_setting('test.today'), 'cash'),
  'P0001', 'loan_not_active', 'payments can only be recorded on an active loan'
);

select pg_temp.confirm_funds_sent(current_setting('test.loan')::uuid, current_setting('test.today')::date, 'bank_transfer');

-- Move dates into the past so overdue logic can be tested: money sent 20 days
-- ago, first instalment due 10 days ago, second due next week.
reset role;
update public.loans set funds_sent_on = current_setting('test.today')::date - 20
where id = current_setting('test.loan')::uuid;
update public.instalments i set due_on = current_setting('test.today')::date - 10
from public.loans l where l.id = current_setting('test.loan')::uuid and i.terms_id = l.current_terms_id and i.sequence = 1;
set local role authenticated;


-- =============================================================================
-- Bob claims a payment; only Lena can confirm it
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);

select is(
  (select status from public.get_instalment_progress(current_setting('test.loan')::uuid) where sequence = 1),
  'overdue', 'an unpaid instalment is overdue the day after its due date'
);
select is(
  (select overdue_count || ' / ' || overdue_cents from public.list_loan_balances() where loan_id = current_setting('test.loan')::uuid),
  '1 / 15000', 'balances report the overdue instalment and amount'
);
select lives_ok(
  format($f$ select set_config('test.claim', pg_temp.record_repayment(%L, 5000, %L, 'bank_transfer', 'BOB-1', 'First bit')::text, true) $f$,
    current_setting('test.loan'), current_setting('test.today')),
  'the borrower can say they have paid'
);
select is(
  (select status::text from public.repayments where id = current_setting('test.claim')::uuid),
  'claimed', 'a borrower''s payment starts as a claim'
);
select is(
  (select paid_cents from public.list_loan_balances() where loan_id = current_setting('test.loan')::uuid),
  0::bigint, 'claims don''t reduce the balance until confirmed'
);
select throws_ok(
  format('select public.confirm_repayment(%L)', current_setting('test.claim')),
  'P0001', 'lender_only', 'the borrower cannot confirm their own claim'
);


-- -----------------------------------------------------------------------------
-- Casey sees nothing
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c"}', true);
select is((select count(*)::int from public.repayments), 0, 'outsiders see no repayments');
select is((select count(*)::int from public.list_loan_balances()), 0, 'outsiders see no balances');
select throws_ok(
  format('select * from public.get_instalment_progress(%L)', current_setting('test.loan')),
  'P0001', 'loan_not_found', 'outsiders cannot read instalment progress'
);
select throws_ok(
  format('select pg_temp.record_repayment(%L, 100, %L, %L)', current_setting('test.loan'), current_setting('test.today'), 'cash'),
  'P0001', 'loan_not_found', 'outsiders cannot record payments'
);


-- =============================================================================
-- Lena confirms, then records a payment herself
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);

select lives_ok(
  format('select public.confirm_repayment(%L)', current_setting('test.claim')),
  'the lender can confirm a claim'
);
select is(
  (select paid_charge_cents || ' + ' || paid_principal_cents
   from public.get_instalment_progress(current_setting('test.loan')::uuid) where sequence = 1),
  '5000 + 0', 'a payment clears the instalment''s charge share before principal'
);

select lives_ok(
  format($f$ select set_config('test.p2', pg_temp.record_repayment(%L, 12000, %L, 'cash')::text, true) $f$,
    current_setting('test.loan'), current_setting('test.today')),
  'the lender can record a payment'
);
select is(
  (select status::text from public.repayments where id = current_setting('test.p2')::uuid),
  'confirmed', 'a lender''s payment counts straight away'
);
select is(
  (select string_agg(sequence || ':' || status || ':' || paid_cents, ', ' order by sequence)
   from public.get_instalment_progress(current_setting('test.loan')::uuid)),
  '1:paid:15000, 2:due:2000', 'payments fill the oldest instalment first, the rest flows to the next'
);
select is(
  (select paid_on::text from public.get_instalment_progress(current_setting('test.loan')::uuid) where sequence = 1),
  current_setting('test.today'), 'records the date an instalment was fully paid'
);
select is(
  (select paid_charge_cents || ' + ' || paid_principal_cents
   from public.get_instalment_progress(current_setting('test.loan')::uuid) where sequence = 2),
  '2000 + 0', 'the overflow goes to the next instalment''s charge first'
);
select is(
  (select outstanding_cents || ' / ' || overdue_count from public.list_loan_balances() where loan_id = current_setting('test.loan')::uuid),
  '13000 / 0', 'outstanding balance is total minus confirmed payments'
);


-- -----------------------------------------------------------------------------
-- Validation
-- -----------------------------------------------------------------------------
select throws_ok(
  format('select pg_temp.record_repayment(%L, 13001, %L, %L)', current_setting('test.loan'), current_setting('test.today'), 'cash'),
  'P0001', 'amount_exceeds_outstanding', 'a payment cannot exceed what is owed'
);
select throws_ok(
  format('select pg_temp.record_repayment(%L, 100, %L, %L)', current_setting('test.loan'), current_setting('test.tomorrow'), 'cash'),
  'P0001', 'invalid_received_date', 'a payment cannot be dated in the future'
);
select throws_ok(
  format('select pg_temp.record_repayment(%L, 100, %L, %L)', current_setting('test.loan'),
    (current_setting('test.today')::date - 30)::text, 'cash'),
  'P0001', 'received_before_funds_sent', 'a payment cannot predate the loan'
);
select set_config('test.dup', pg_temp.record_repayment(
  current_setting('test.loan')::uuid, 1000, current_setting('test.today')::date, 'bank_transfer', 'DUP')::text, true);
select throws_ok(
  format($f$ select pg_temp.record_repayment(%L, 1000, %L, 'bank_transfer', 'DUP') $f$,
    current_setting('test.loan'), current_setting('test.today')),
  'P0001', 'duplicate_repayment', 'an identical payment submitted twice is rejected'
);


-- -----------------------------------------------------------------------------
-- Disputes and reversals
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select set_config('test.claim2', pg_temp.record_repayment(
  current_setting('test.loan')::uuid, 3000, current_setting('test.today')::date, 'cash')::text, true);
select throws_ok(
  format('select public.reverse_repayment(%L, %L)', current_setting('test.dup'), 'mine'),
  'P0001', 'lender_only', 'only the lender can reverse a payment'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select throws_ok(
  format('select public.dispute_repayment(%L, %L)', current_setting('test.claim2'), '  '),
  'P0001', 'reason_required', 'a dispute needs a reason'
);
select lives_ok(
  format('select public.dispute_repayment(%L, %L)', current_setting('test.claim2'), 'Not in my account yet'),
  'the lender can dispute a claim'
);
select throws_ok(
  format('select public.reverse_repayment(%L, %L)', current_setting('test.dup'), ''),
  'P0001', 'reason_required', 'a reversal needs a reason'
);
select lives_ok(
  format('select public.reverse_repayment(%L, %L)', current_setting('test.dup'), 'Entered twice'),
  'the lender can reverse a mistaken payment'
);
select is(
  (select status::text || ' / ' || reversal_reason from public.repayments where id = current_setting('test.dup')::uuid),
  'reversed / Entered twice', 'a reversed payment is kept, with the reason'
);
select is(
  (select outstanding_cents from public.list_loan_balances() where loan_id = current_setting('test.loan')::uuid),
  13000::bigint, 'reversed and disputed payments don''t count'
);
select throws_ok(
  $$ update public.repayments set amount_cents = 1 $$,
  '42501', null, 'payments cannot be edited directly'
);


-- -----------------------------------------------------------------------------
-- Completion, reopening and forgiveness
-- -----------------------------------------------------------------------------
select set_config('test.final', pg_temp.record_repayment(
  current_setting('test.loan')::uuid, 13000, current_setting('test.today')::date, 'bank_transfer', 'FINAL')::text, true);
select is(
  (select status::text from public.loans where id = current_setting('test.loan')::uuid),
  'completed', 'the loan completes when nothing is owed'
);
select throws_ok(
  format('select pg_temp.record_repayment(%L, 100, %L, %L)', current_setting('test.loan'), current_setting('test.today'), 'cash'),
  'P0001', 'loan_not_active', 'no payments on a completed loan'
);
select lives_ok(
  format('select public.reverse_repayment(%L, %L)', current_setting('test.final'), 'Transfer bounced'),
  'a payment on a completed loan can still be reversed'
);
select is(
  (select status::text from public.loans where id = current_setting('test.loan')::uuid),
  'active', 'reversing the final payment reopens the loan'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select throws_ok(
  format('select public.forgive_remaining(%L)', current_setting('test.loan')),
  'P0001', 'lender_only', 'only the lender can forgive a loan'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select is(
  public.forgive_remaining(current_setting('test.loan')::uuid, 'Call it even'),
  13000::bigint, 'forgiving returns the amount written off'
);
select is(
  (select status::text || ' / ' || written_off_cents from public.loans where id = current_setting('test.loan')::uuid),
  'written_off / 13000', 'the loan closes as written off, recording the amount'
);
select is(
  (select outstanding_cents from public.list_loan_balances() where loan_id = current_setting('test.loan')::uuid),
  0::bigint, 'nothing is outstanding after a write-off'
);
select throws_ok(
  format('select public.reverse_repayment(%L, %L)', current_setting('test.p2'), 'too late'),
  'P0001', 'loan_closed', 'payments on a written-off loan cannot be reversed'
);
select is(
  (select string_agg(event_type, ',' order by id) from public.audit_events
   where loan_id = current_setting('test.loan')::uuid and event_type not in ('loan_requested', 'loan_offered')
     and event_type not like 'terms_%' and event_type <> 'funds_confirmed'),
  'repayment_claimed,repayment_confirmed,repayment_recorded,repayment_recorded,repayment_claimed,repayment_disputed,repayment_reversed,repayment_recorded,loan_completed,repayment_reversed,loan_reopened,loan_written_off',
  'every payment event is in the audit trail'
);

select * from finish();
rollback;
