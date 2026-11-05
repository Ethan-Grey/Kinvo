-- =============================================================================
-- A request to borrow needs a reason (ADR-0025).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'lena@example.test', '{"full_name": "Lena Lender"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test',  '{"full_name": "Bob Borrower"}');
insert into public.lending_relationships (id, lender_id, borrower_id) values (
  '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');
select set_config('test.plan', jsonb_build_array(jsonb_build_object(
  'due_on', ((now() at time zone 'Pacific/Auckland')::date + 7)::text, 'amount_cents', 10000))::text, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select throws_ok(
  format('select public.create_loan(%L, 10000, 0, %L)', '00000000-0000-4000-8000-0000000000e1', current_setting('test.plan')),
  'P0001', 'loan_reason_required', 'asking to borrow needs a reason'
);
select throws_ok(
  format('select public.create_loan(%L, 10000, 0, %L, %L)', '00000000-0000-4000-8000-0000000000e1', current_setting('test.plan'), '   '),
  'P0001', 'loan_reason_required', 'a blank reason doesn''t count'
);
select set_config('test.loan', public.create_loan('00000000-0000-4000-8000-0000000000e1', 10000, 0,
  current_setting('test.plan')::jsonb, 'Car repairs')::text, true);
select is((select reason from public.loans where id = current_setting('test.loan')::uuid), 'Car repairs',
  'the reason is kept on the loan');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select is((select body from public.notifications where kind = 'loan_requested'),
  'For Car repairs. Open Kinvo to accept, suggest changes, or decline.', 'and shown in the alert');
select lives_ok(
  format('select public.create_loan(%L, 10000, 0, %L)', '00000000-0000-4000-8000-0000000000e1', current_setting('test.plan')),
  'an offer from the person who''d be owed can leave it blank'
);
reset role;

select * from finish();
rollback;
