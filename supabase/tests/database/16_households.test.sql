-- =============================================================================
-- Tests for households (ADR-0022).
-- Run with:  npx supabase test db
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(40);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'ethan@example.test', '{"full_name": "Ethan Grey"}'),
  ('00000000-0000-4000-8000-00000000000b', 'hana@example.test',  '{"full_name": "Hana Grey"}'),
  ('00000000-0000-4000-8000-00000000000c', 'mum@example.test',   '{"full_name": "Mum Grey"}'),
  ('00000000-0000-4000-8000-00000000000d', 'casey@example.test', '{"full_name": "Casey Outsider"}');

select set_config('test.today', ((now() at time zone 'Pacific/Auckland')::date)::text, true);
create function pg_temp.d(p_offset int) returns date language sql as $$
  select current_setting('test.today')::date + p_offset;
$$;
create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-00000000000' || p)::text, true);
$$;
create function pg_temp.tab(p_household uuid, p_to text, p_by text) returns bigint language sql security definer as $$
  select coalesce(sum(case when owed_to::text like '%' || p_to and owed_by::text like '%' || p_by then amount_cents
                           when owed_to::text like '%' || p_by and owed_by::text like '%' || p_to then -amount_cents end), 0)::bigint
  from public.household_tab_entries where household_id = p_household and voided_at is null;
$$;
create function pg_temp.balance(p_household uuid) returns bigint language sql security definer as $$
  select coalesce(sum(amount_cents), 0)::bigint from public.shared_account_entries
  where household_id = p_household and voided_at is null and occurred_on <= current_setting('test.today')::date;
$$;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated;

-- =============================================================================
-- Our place: Ethan and Hana, with a shared account
-- =============================================================================
select pg_temp.as_user('a');
select set_config('test.home', public.create_household('Our place', true, 'Joint Co-op', 50000)::text, true);
select is((select role from public.household_members where user_id = '00000000-0000-4000-8000-00000000000a'), 'owner',
  'whoever creates a household runs it');
select is(pg_temp.balance(current_setting('test.home')::uuid), 50000::bigint, 'the starting balance is recorded');

select set_config('test.token', public.create_household_invite(current_setting('test.home')::uuid), true);
select pg_temp.as_user('d');
select is((select count(*)::int from public.households), 0, 'outsiders can''t see it');
select throws_ok(format('select public.create_bill(%L, %L, %L, %L, 100, %L, %L, %L)',
  current_setting('test.home'), 'Rent', 'rent', 'fixed', 'weekly', pg_temp.d(0), 'shared_account'),
  'P0001', 'household_not_found', 'or add to it');

select pg_temp.as_user('b');
select is((select status || ' ' || household_name || ' ' || invited_by from public.preview_household_invite(current_setting('test.token'))),
  'valid Our place Ethan Grey', 'Hana sees who invited her');
select is(public.accept_household_invite(current_setting('test.token')), current_setting('test.home')::uuid, 'and joins');
select pg_temp.as_user('d');
select throws_ok(format('select public.accept_household_invite(%L)', current_setting('test.token')),
  'P0001', 'invite_used', 'an invite works once');
select pg_temp.as_user('b');
select is((select count(*)::int from public.profiles where id = '00000000-0000-4000-8000-00000000000a'), 1,
  'members can see each other''s name');

-- Both top up $350 a week from today.
select lives_ok(format('select public.create_topup(%L, 35000, %L, %L)', current_setting('test.home'), 'weekly', pg_temp.d(0)),
  'Hana sets up her weekly top-up');
select pg_temp.as_user('a');
select public.create_topup(current_setting('test.home')::uuid, 35000, 'weekly', pg_temp.d(0));
select is(pg_temp.balance(current_setting('test.home')::uuid), 120000::bigint, 'today''s top-ups go in');

-- Rent: $600 a week from the shared account, due in 2 days.
select set_config('test.rent', public.create_bill(current_setting('test.home')::uuid, 'Rent', 'rent', 'fixed', 60000,
  'weekly', pg_temp.d(2), 'shared_account')::text, true);
select is(
  (select amount_cents from public.shared_account_entries where kind = 'bill' and voided_at is null),
  -60000::bigint, 'the next rent comes out of the shared account'
);
select is((select status from public.household_bill_occurrences where bill_id = current_setting('test.rent')::uuid),
  'open', 'and is waiting for its date');

-- This week Ethan covered rent from his own account instead.
select lives_ok(format('select public.change_occurrence_payment(o.id, %L, %L) from public.household_bill_occurrences o where o.bill_id = %L',
  'one_person', '00000000-0000-4000-8000-00000000000a', current_setting('test.rent')),
  'one week, someone can cover it themselves');
select is((select count(*)::int from public.shared_account_entries where kind = 'bill' and voided_at is null), 0,
  'then it doesn''t come out of the shared account');
select is(pg_temp.tab(current_setting('test.home')::uuid, 'a', 'b'), 30000::bigint, 'and Hana owes Ethan half');

-- Power changes each month; Hana pays it, split 50/50.
select set_config('test.power', public.create_bill(current_setting('test.home')::uuid, 'Power', 'power', 'varies', null,
  'monthly', pg_temp.d(1), 'one_person', '00000000-0000-4000-8000-00000000000b')::text, true);
select set_config('test.power_due', (select id::text from public.household_bill_occurrences
  where bill_id = current_setting('test.power')::uuid), true);
select is((select status from public.household_bill_occurrences where id = current_setting('test.power_due')::uuid),
  'needs_amount', 'a changing bill waits for its amount');
reset role;
select private.run_household_jobs();
set local role authenticated;
select pg_temp.as_user('b');
select is((select count(*)::int from public.notifications where kind = 'household_bill_amount'), 1,
  'the person who pays it is asked what it was');
select lives_ok(format('select public.enter_bill_amount(%L, 18640)', current_setting('test.power_due')),
  'Hana enters $186.40');
select is(pg_temp.tab(current_setting('test.home')::uuid, 'a', 'b'), 30000::bigint - 9320, 'Ethan''s half comes off what Hana owes him');
select lives_ok(format('select public.enter_bill_amount(%L, 20000)', current_setting('test.power_due')),
  'a wrong amount can be corrected');
select is(pg_temp.tab(current_setting('test.home')::uuid, 'a', 'b'), 20000::bigint, 'and the tab follows');

-- Settle up: Hana pays Ethan the $200 she owes.
select throws_ok(format('select public.settle_up(%L, %L, 0)', current_setting('test.home'), '00000000-0000-4000-8000-00000000000a'),
  'P0001', 'invalid_amount', 'settling needs an amount');
select lives_ok(format('select public.settle_up(%L, %L, 20000)', current_setting('test.home'), '00000000-0000-4000-8000-00000000000a'),
  'Hana settles up');
select is(pg_temp.tab(current_setting('test.home')::uuid, 'a', 'b'), 0::bigint, 'and they''re even');

-- A missed top-up and a balance check.
select lives_ok(format('select public.void_shared_entry(id) from public.shared_account_entries where kind = %L and member_id = %L',
  'topup', '00000000-0000-4000-8000-00000000000b'), 'Hana marks her top-up as missed');
select pg_temp.as_user('a');
select lives_ok(format('select public.check_shared_balance(%L, 84000)', current_setting('test.home')),
  'Ethan checks the balance against the bank');
select is(pg_temp.balance(current_setting('test.home')::uuid), 84000::bigint, 'and it matches what he entered');

-- =============================================================================
-- Mum's house: no shared account, everyone pays their own rent share
-- =============================================================================
select pg_temp.as_user('c');
select set_config('test.mum', public.create_household('Mum''s', false)::text, true);
select throws_ok(format('select public.create_bill(%L, %L, %L, %L, 100, %L, %L, %L)',
  current_setting('test.mum'), 'Rent', 'rent', 'fixed', 'weekly', pg_temp.d(0), 'shared_account'),
  'P0001', 'no_shared_account', 'no shared account, so bills can''t come from one');
select throws_ok(format('select public.create_topup(%L, 100, %L, %L)', current_setting('test.mum'), 'weekly', pg_temp.d(0)),
  'P0001', 'no_shared_account', 'or top-ups');
select set_config('test.mum_token', public.create_household_invite(current_setting('test.mum')::uuid), true);
select pg_temp.as_user('a');
select public.accept_household_invite(current_setting('test.mum_token'));
select is((select count(*)::int from public.households), 2, 'Ethan can be in more than one household');

select pg_temp.as_user('c');
select throws_ok(format($$select public.set_household_shares(%L, '[{"user_id": "00000000-0000-4000-8000-00000000000c", "share_bp": 7000}, {"user_id": "00000000-0000-4000-8000-00000000000a", "share_bp": 2000}]')$$,
  current_setting('test.mum')), 'P0001', 'split_must_total_100', 'a split must add up to 100%');
select lives_ok(format($$select public.set_household_shares(%L, '[{"user_id": "00000000-0000-4000-8000-00000000000c", "share_bp": 7000}, {"user_id": "00000000-0000-4000-8000-00000000000a", "share_bp": 3000}]')$$,
  current_setting('test.mum')), 'the household can split 70/30 by default');
select set_config('test.mum_rent', public.create_bill(current_setting('test.mum')::uuid, 'Rent', 'rent', 'fixed', 50000,
  'weekly', pg_temp.d(0), 'each_own')::text, true);
select is(
  (select array_agg(s.amount_cents order by s.amount_cents) from public.household_bill_shares s
   join public.household_bill_occurrences o on o.id = s.occurrence_id where o.bill_id = current_setting('test.mum_rent')::uuid and o.due_on = pg_temp.d(0)),
  array[15000, 35000]::bigint[], 'each person''s own share, 70/30'
);
select is(pg_temp.tab(current_setting('test.mum')::uuid, 'c', 'a'), 0::bigint, 'paying your own share puts nothing on the tab');
select pg_temp.as_user('a');
select lives_ok(format('select public.pay_own_share(id) from public.household_bill_occurrences where bill_id = %L and due_on = %L',
  current_setting('test.mum_rent'), pg_temp.d(0)), 'Ethan ticks off his share');
select is((select status from public.household_bill_occurrences where bill_id = current_setting('test.mum_rent')::uuid and due_on = pg_temp.d(0)),
  'open', 'it waits until everyone has paid');
select pg_temp.as_user('c');
select public.pay_own_share(id) from public.household_bill_occurrences where bill_id = current_setting('test.mum_rent')::uuid and due_on = pg_temp.d(0);
select is((select status from public.household_bill_occurrences where bill_id = current_setting('test.mum_rent')::uuid and due_on = pg_temp.d(0)),
  'done', 'then it''s done');

-- Leaving
select pg_temp.as_user('a');
select throws_ok(format('select public.leave_household(%L, %L)', current_setting('test.mum'), '00000000-0000-4000-8000-00000000000c'),
  'P0001', 'owner_only', 'only the owner can remove someone else');
select lives_ok(format('select public.leave_household(%L)', current_setting('test.mum')), 'Ethan can leave');
select is((select count(*)::int from public.households), 1, 'and no longer sees it');
reset role;

select * from finish();
rollback;
