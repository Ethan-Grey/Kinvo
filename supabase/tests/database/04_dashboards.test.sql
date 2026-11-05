-- =============================================================================
-- Tests for dashboards and borrower track records (M5).
-- Run with:  npx supabase test db
--
-- Lena lends to Bob and Casey.
--   Loan A (Bob):  $200 + $100 charge, 2 × $150, due 30 and 10 days ago.
--                  First instalment paid 2 days early; second unpaid (10 days late).
--   Loan B (Bob):  a request Lena hasn't answered.
--   Loan C (Casey): agreed, waiting for Lena to send the money.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

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
-- Tax year boundaries (as the owner; the helper isn't exposed to users)
-- -----------------------------------------------------------------------------
select is(private.tax_year_start('2026-03-31'), '2025-04-01'::date, 'tax year runs to 31 March');
select is(private.tax_year_start('2026-04-01'), '2026-04-01'::date, 'a new tax year starts on 1 April');

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'lena@example.test',  '{"full_name": "Lena Lender"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test',   '{"full_name": "Bob Borrower"}'),
  ('00000000-0000-4000-8000-00000000000c', 'casey@example.test', '{"full_name": "Casey Cousin"}'),
  ('00000000-0000-4000-8000-00000000000d', 'dana@example.test',  '{"full_name": "Dana Outsider"}');
update public.profiles set can_lend = true where id = '00000000-0000-4000-8000-00000000000a';
insert into public.lending_relationships (id, lender_id, borrower_id) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c');

select set_config('test.today', ((now() at time zone 'Pacific/Auckland')::date)::text, true);
select set_config('test.d1', (current_setting('test.today')::date + 7)::text, true);
select set_config('test.d2', (current_setting('test.today')::date + 14)::text, true);

create function pg_temp.sched(a text, b text) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('due_on', a, 'amount_cents', 15000),
    jsonb_build_object('due_on', b, 'amount_cents', 15000));
$$;
create function pg_temp.accept(p_loan uuid) returns void language sql as $$
  select public.accept_terms(l.id, t.id, t.terms_hash)
  from public.loans l join public.loan_terms t on t.id = l.current_terms_id where l.id = p_loan;
$$;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated;

-- Loan A: Lena offers with a charge (only lenders set one), Bob accepts, Lena funds.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select set_config('test.loan_a', public.create_loan('00000000-0000-4000-8000-0000000000e1', 20000, 10000,
  pg_temp.sched(current_setting('test.d1'), current_setting('test.d2')), 'Test reason')::text, true);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select pg_temp.accept(current_setting('test.loan_a')::uuid);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select pg_temp.confirm_funds_sent(current_setting('test.loan_a')::uuid, current_setting('test.today')::date, 'bank_transfer');

-- Move loan A into the past: sent 40 days ago, due 30 and 10 days ago.
reset role;
update public.loans set funds_sent_on = current_setting('test.today')::date - 40 where id = current_setting('test.loan_a')::uuid;
update public.instalments i
set due_on = current_setting('test.today')::date - case i.sequence when 1 then 30 else 10 end
from public.loans l where l.id = current_setting('test.loan_a')::uuid and i.terms_id = l.current_terms_id;
set local role authenticated;

-- First instalment paid 2 days early (32 days ago).
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select pg_temp.record_repayment(current_setting('test.loan_a')::uuid, 15000, current_setting('test.today')::date - 32, 'cash');

-- Bob claims a small payment Lena hasn't confirmed.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select set_config('test.claim', pg_temp.record_repayment(
  current_setting('test.loan_a')::uuid, 1000, current_setting('test.today')::date, 'bank_transfer', 'BOB')::text, true);

-- Loan B: Bob's unanswered request.
select public.create_loan('00000000-0000-4000-8000-0000000000e1', 5000, 0,
  jsonb_build_array(jsonb_build_object('due_on', current_setting('test.d1'), 'amount_cents', 5000)), 'Test reason');

-- Loan C: Lena offers Casey; Casey accepts; money not sent yet.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select set_config('test.loan_c', public.create_loan('00000000-0000-4000-8000-0000000000e2', 30000, 0,
  pg_temp.sched(current_setting('test.d1'), current_setting('test.d2')), 'Test reason')::text, true);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c"}', true);
select pg_temp.accept(current_setting('test.loan_c')::uuid);


-- =============================================================================
-- Lena's dashboard
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);

select is(
  (select lending_owed_cents || ' / ' || lending_overdue_cents || ' / ' || lending_overdue_count
   from public.get_dashboard_summary()),
  '15000 / 15000 / 1', 'lender sees what is owed and what is overdue'
);
select is(
  (select lending_total_lent_cents || ' / ' || lending_active_count from public.get_dashboard_summary()),
  '20000 / 1', 'total lent counts only loans where money was sent'
);
select is(
  (select replies_needed || ' / ' || funds_to_send || ' / ' || claims_to_confirm from public.get_dashboard_summary()),
  '1 / 1 / 1', 'lender sees a request to answer, money to send and a claim to confirm'
);
select is(
  (select borrowing_owed_cents || ' / ' || borrowing_active_count from public.get_dashboard_summary()),
  '0 / 0', 'a lender with no borrowing sees zero borrowing figures'
);

-- Track records (lender only)
select is(
  (select loans_funded || ' / ' || loans_open || ' / ' || total_borrowed_cents || ' / ' || total_repaid_cents || ' / ' || owed_cents || ' / ' || overdue_cents
   from public.list_borrower_records() where borrower_name = 'Bob Borrower'),
  '1 / 1 / 20000 / 15000 / 15000 / 15000', 'Bob''s money figures are correct'
);
select is(
  (select instalments_assessed || ' / ' || instalments_on_time || ' / ' || instalments_late || ' / ' || average_days_late
   from public.list_borrower_records() where borrower_name = 'Bob Borrower'),
  '2 / 1 / 1 / 10.0', 'one instalment on time, one 10 days late'
);
select is(
  (select instalments_assessed || ' / ' || coalesce(average_days_late::text, 'none')
   from public.list_borrower_records() where borrower_name = 'Casey Cousin'),
  '0 / none', 'a borrower with no funded loans has no record yet'
);
select is(
  (select count(*)::int from public.list_borrower_records()), 2, 'the lender sees one record per borrower'
);
select is(
  (select count(*)::int from public.list_upcoming_instalments()), 1,
  'upcoming payments only include active loans'
);


-- =============================================================================
-- Bob's dashboard
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);

select is(
  (select borrowing_owed_cents || ' / ' || borrowing_overdue_cents || ' / ' || borrowing_overdue_count
   from public.get_dashboard_summary()),
  '15000 / 15000 / 1', 'borrower sees what they owe and what is overdue'
);
select is(
  (select borrowing_next_due_on::text || ' / ' || borrowing_next_due_cents from public.get_dashboard_summary()),
  (current_setting('test.today')::date - 10)::text || ' / 15000', 'borrower sees the next unpaid instalment'
);
select is(
  (select replies_needed || ' / ' || claims_disputed from public.get_dashboard_summary()),
  '0 / 0', 'the borrower''s own request doesn''t count as a reply needed'
);
select is(
  (select role || ' / ' || other_person_name || ' / ' || remaining_cents || ' / ' || status
   from public.list_upcoming_instalments()),
  'borrower / Lena Lender / 15000 / overdue', 'upcoming payments show who, how much and whether overdue'
);
select is(
  (select count(*)::int from public.list_borrower_records()), 0, 'borrowers cannot see track records'
);

-- Lena disputes Bob's claim; it shows up for Bob.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select public.dispute_repayment(current_setting('test.claim')::uuid, 'Not received');
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select is(
  (select claims_disputed from public.get_dashboard_summary()), 1, 'a disputed claim needs the borrower''s attention'
);


-- =============================================================================
-- Casey and an outsider
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c"}', true);
select is(
  (select borrowing_active_count || ' / ' || funds_to_send from public.get_dashboard_summary()),
  '0 / 0', 'an agreed but unfunded loan is not yet active for the borrower'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d"}', true);
select is(
  (select lending_owed_cents + borrowing_owed_cents + replies_needed + claims_to_confirm from public.get_dashboard_summary()),
  0::bigint, 'an outsider''s dashboard is empty'
);
select is((select count(*)::int from public.list_upcoming_instalments()), 0, 'outsiders see no upcoming payments');

-- Anonymous visitors can't call the dashboard.
reset role;
set local role anon;
select throws_ok('select * from public.get_dashboard_summary()', '42501', null, 'anonymous users cannot read dashboards');
reset role;

-- Charges received (checked as the owner, since the expected value depends on today's date).
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
set local role authenticated;
select is(
  (select charges_received_cents from public.get_dashboard_summary()),
  (select case when (now() at time zone 'Pacific/Auckland')::date - 32
                    >= (select tax_year_start from public.get_dashboard_summary())
               then 5000::bigint else 0::bigint end),
  'charges received this tax year come from how each payment was split'
);

select * from finish();
rollback;
