-- =============================================================================
-- Tests for removing a loan, and for "only the lender sets the charge".
-- Run with:  npx supabase test db
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

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

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'lena@example.test', '{"full_name": "Lena Lender"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test',  '{"full_name": "Bob Borrower"}');
update public.profiles set can_lend = true where id = '00000000-0000-4000-8000-00000000000a';
insert into public.lending_relationships (id, lender_id, borrower_id) values (
  '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');

select set_config('test.d1', ((now() at time zone 'Pacific/Auckland')::date + 7)::text, true);
create function pg_temp.one(p_amount bigint) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('due_on', current_setting('test.d1'), 'amount_cents', p_amount));
$$;
create function pg_temp.terms() returns public.loan_terms language sql as $$
  select t.* from public.loans l join public.loan_terms t on t.id = l.current_terms_id
  where l.id = current_setting('test.loan')::uuid;
$$;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated;

-- =============================================================================
-- The charge
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select throws_ok(
  $$ select public.create_loan('00000000-0000-4000-8000-0000000000e1', 20000, 2000, pg_temp.one(22000)) $$,
  'P0001', 'charge_set_by_lender', 'a borrower can''t add a charge to a request'
);
select set_config('test.loan',
  public.create_loan('00000000-0000-4000-8000-0000000000e1', 20000, 0, pg_temp.one(20000))::text, true);
select is((pg_temp.terms()).charge_cents, 0::bigint, 'a request has no charge');

-- Lena counters with a 10% charge.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select lives_ok(
  $$ select public.counter_offer(current_setting('test.loan')::uuid, (pg_temp.terms()).id, 20000, 2000, pg_temp.one(22000)) $$,
  'the lender can set a charge'
);

-- Bob asks for less. The charge follows Lena's 10%.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select throws_ok(
  $$ select public.counter_offer(current_setting('test.loan')::uuid, (pg_temp.terms()).id, 10000, 0, pg_temp.one(10000)) $$,
  'P0001', 'charge_set_by_lender', 'the borrower can''t drop the lender''s charge'
);
select throws_ok(
  $$ select public.counter_offer(current_setting('test.loan')::uuid, (pg_temp.terms()).id, 10000, 2000, pg_temp.one(12000)) $$,
  'P0001', 'charge_set_by_lender', 'or keep the old dollar amount on a smaller loan'
);
select lives_ok(
  $$ select public.counter_offer(current_setting('test.loan')::uuid, (pg_temp.terms()).id, 10000, 1000, pg_temp.one(11000)) $$,
  'the borrower can change the amount, with the charge at the lender''s rate'
);
select is((pg_temp.terms()).charge_cents, 1000::bigint, 'so 10% of $100 is $10');
select lives_ok(
  $$ select public.counter_offer(current_setting('test.loan')::uuid, (pg_temp.terms()).id, 3333, 333, pg_temp.one(3666)) $$,
  'odd amounts round to the nearest cent'
);

-- Lena drops the charge; Bob's next change must have none.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select public.counter_offer(current_setting('test.loan')::uuid, (pg_temp.terms()).id, 3333, 0, pg_temp.one(3333));
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select lives_ok(
  $$ select public.counter_offer(current_setting('test.loan')::uuid, (pg_temp.terms()).id, 5000, 0, pg_temp.one(5000)) $$,
  'the rate always comes from the lender''s latest proposal'
);


-- =============================================================================
-- Removing a loan
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select public.accept_terms(current_setting('test.loan')::uuid, (pg_temp.terms()).id, (pg_temp.terms()).terms_hash);
select pg_temp.confirm_funds_sent(current_setting('test.loan')::uuid, (now() at time zone 'Pacific/Auckland')::date, 'cash');
select is(
  (select lending_total_lent_cents from public.get_dashboard_summary()), 5000::bigint,
  'before removal it counts towards total lent'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select throws_ok(
  format('select public.remove_loan(%L)', current_setting('test.loan')),
  'P0001', 'lender_only', 'only the lender can remove a loan'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select lives_ok(
  format('select public.remove_loan(%L, %L)', current_setting('test.loan'), 'Just testing'),
  'the lender can remove an active loan'
);
select is(
  (select lending_total_lent_cents from public.get_dashboard_summary()), 0::bigint,
  'a removed loan no longer counts towards total lent'
);
select is((select count(*)::int from public.list_loan_balances()), 0, 'or balances');
select is((select count(*)::int from public.notifications where loan_id = current_setting('test.loan')::uuid), 0,
  'its alerts are cleared');
select throws_ok(
  format('select public.remove_loan(%L)', current_setting('test.loan')),
  'P0001', 'loan_already_removed', 'it can''t be removed twice'
);
reset role;

select is(
  (select payload ->> 'reason' from public.audit_events
   where loan_id = current_setting('test.loan')::uuid and event_type = 'loan_removed'),
  'Just testing', 'the audit log records who removed it and why'
);

-- Clearing alerts: only your own.
select set_config('test.bob_alerts', (select count(*)::text from public.notifications where recipient_id = '00000000-0000-4000-8000-00000000000b'), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select public.clear_notifications();
reset role;
select is((select count(*)::int from public.notifications where recipient_id = '00000000-0000-4000-8000-00000000000a'), 0,
  'a user can clear their alerts');
select is((select count(*)::text from public.notifications where recipient_id = '00000000-0000-4000-8000-00000000000b'),
  current_setting('test.bob_alerts'), 'without touching anyone else''s');

select * from finish();
rollback;
