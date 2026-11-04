-- =============================================================================
-- Tests for My money (ADR-0024).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'ethan@example.test', '{"full_name": "Ethan Grey"}'),
  ('00000000-0000-4000-8000-00000000000b', 'hana@example.test',  '{"full_name": "Hana Grey"}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select set_config('test.bill', public.save_personal_bill(null, 'Phone', 'phone', 'fixed', 4500, 'monthly',
  (now() at time zone 'Pacific/Auckland')::date + 3)::text, true);
select is((select name from public.personal_bills), 'Phone', 'you can add your own bill');
select lives_ok(format('select public.save_personal_bill(%L, %L, %L, %L, 5000, %L, %L)', current_setting('test.bill'),
  'Phone', 'phone', 'fixed', 'monthly', (now() at time zone 'Pacific/Auckland')::date + 3), 'and change it');
select is((select amount_cents from public.personal_bills), 5000::bigint, 'the change is saved');
select throws_ok($$ select public.save_personal_bill(null, '', 'phone', 'fixed', 100, 'monthly', current_date) $$,
  'P0001', 'invalid_bill_name', 'a bill needs a name');
select lives_ok($$ select public.save_pay(120000, 'fortnightly', current_date + 5) $$, 'you can set your pay');
select lives_ok($$ select public.set_my_balance(43210) $$, 'and what''s in your account');
select is((select balance_cents from public.my_money), 43210::bigint, 'which is kept');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select is((select count(*)::int from public.personal_bills) + (select count(*)::int from public.my_money), 0,
  'nobody else can see any of it');
select throws_ok(format('select public.stop_personal_bill(%L)', current_setting('test.bill')),
  'P0001', 'bill_not_found', 'or change it');
reset role;

select * from finish();
rollback;
