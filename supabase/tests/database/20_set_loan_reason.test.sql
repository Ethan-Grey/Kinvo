-- =============================================================================
-- Adding or changing what a loan is for (ADR-0026).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'lena@example.test', '{"full_name": "Lena Lender"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test',  '{"full_name": "Bob Borrower"}'),
  ('00000000-0000-4000-8000-00000000000c', 'eve@example.test',  '{"full_name": "Eve Outsider"}');
insert into public.lending_relationships (id, lender_id, borrower_id) values (
  '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');
select set_config('test.plan', jsonb_build_array(jsonb_build_object(
  'due_on', ((now() at time zone 'Pacific/Auckland')::date + 7)::text, 'amount_cents', 10000))::text, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select set_config('test.loan', public.create_loan('00000000-0000-4000-8000-0000000000e1', 10000, 0,
  current_setting('test.plan')::jsonb)::text, true);

select lives_ok(format('select public.set_loan_reason(%L, %L)', current_setting('test.loan'), '  Groceries  '),
  'the person owed can add a reason later');
select is((select reason from public.loans where id = current_setting('test.loan')::uuid), 'Groceries', 'trimmed');
select throws_ok(format('select public.set_loan_reason(%L, %L)', current_setting('test.loan'), ' '),
  'P0001', 'loan_reason_required', 'it can''t be blanked');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select lives_ok(format('select public.set_loan_reason(%L, %L)', current_setting('test.loan'), 'Groceries and petrol'),
  'the other person can change it too');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c"}', true);
select throws_ok(format('select public.set_loan_reason(%L, %L)', current_setting('test.loan'), 'Mine now'),
  'P0001', null, 'outsiders can''t');
reset role;
select is((select reason from public.loans where id = current_setting('test.loan')::uuid), 'Groceries and petrol',
  'the last change stands');

select * from finish();
rollback;
