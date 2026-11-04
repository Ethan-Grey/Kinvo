-- =============================================================================
-- Tests for household spending (ADR-0023).
-- Run with:  npx supabase test db
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'ethan@example.test', '{"full_name": "Ethan Grey"}'),
  ('00000000-0000-4000-8000-00000000000b', 'hana@example.test',  '{"full_name": "Hana Grey"}'),
  ('00000000-0000-4000-8000-00000000000d', 'casey@example.test', '{"full_name": "Casey Outsider"}');

create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-00000000000' || p)::text, true);
$$;
create function pg_temp.owes(p_household uuid) returns bigint language sql security definer as $$
  -- What Hana owes Ethan overall.
  select coalesce(sum(case when owed_to = '00000000-0000-4000-8000-00000000000a' then amount_cents else -amount_cents end), 0)::bigint
  from public.household_tab_entries where household_id = p_household and voided_at is null;
$$;
create function pg_temp.balance(p_household uuid) returns bigint language sql security definer as $$
  select coalesce(sum(amount_cents), 0)::bigint from public.shared_account_entries
  where household_id = p_household and voided_at is null;
$$;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated;
select pg_temp.as_user('a');
select set_config('test.h', public.create_household('Our place', true, null, 50000)::text, true);
select set_config('test.tok', public.create_household_invite(current_setting('test.h')::uuid), true);
select pg_temp.as_user('b');
select public.accept_household_invite(current_setting('test.tok'));

-- Ethan pays $120 of groceries: Hana owes half.
select pg_temp.as_user('a');
select set_config('test.g', public.add_household_expense(current_setting('test.h')::uuid, 'groceries', 12000,
  '00000000-0000-4000-8000-00000000000a', 'Pak''nSave')::text, true);
select is(pg_temp.owes(current_setting('test.h')::uuid), 6000::bigint, 'paid by a person: the others owe their share');
select is(pg_temp.balance(current_setting('test.h')::uuid), 50000::bigint, 'and the shared account isn''t touched');
select pg_temp.as_user('b');
select is((select title from public.notifications where kind = 'household_expense'), 'Pak''nSave: your share is $60.00',
  'Hana is told her share');

-- Hana adds takeaways Ethan paid for, just for her.
select lives_ok(format($$select public.add_household_expense(%L, 'takeaways', 3000, '00000000-0000-4000-8000-00000000000a',
  'Her sushi', null, '[{"user_id": "00000000-0000-4000-8000-00000000000a", "share_bp": 0}, {"user_id": "00000000-0000-4000-8000-00000000000b", "share_bp": 10000}]')$$,
  current_setting('test.h')), 'anyone can add spending someone else paid, with any split');
select is(pg_temp.owes(current_setting('test.h')::uuid), 9000::bigint, 'all of it on her side');

-- From the shared account: nobody owes anybody.
select lives_ok(format('select public.add_household_expense(%L, %L, 8000, null)', current_setting('test.h'), 'groceries'),
  'spending from the shared account');
select is(pg_temp.balance(current_setting('test.h')::uuid), 42000::bigint, 'comes off the balance');
select is(pg_temp.owes(current_setting('test.h')::uuid), 9000::bigint, 'and doesn''t change the tab');

select throws_ok(format('select public.add_household_expense(%L, %L, 0, null)', current_setting('test.h'), 'groceries'),
  'P0001', 'invalid_amount', 'needs an amount');
select throws_ok(format('select public.add_household_expense(%L, %L, 100, %L, null, %L)', current_setting('test.h'), 'groceries',
  '00000000-0000-4000-8000-00000000000b', (now() at time zone 'Pacific/Auckland')::date + 1),
  'P0001', 'invalid_received_date', 'can''t be in the future');

-- Undo: only whoever added it or paid it.
select pg_temp.as_user('b');
select throws_ok(format('select public.remove_household_expense(%L)', current_setting('test.g')),
  'P0001', 'cannot_undo_entry', 'someone else can''t undo it');
select pg_temp.as_user('a');
select lives_ok(format('select public.remove_household_expense(%L)', current_setting('test.g')),
  'it can be undone');
select is(pg_temp.owes(current_setting('test.h')::uuid), 3000::bigint, 'and its shares come off the tab');

select pg_temp.as_user('d');
select is((select count(*)::int from public.household_expenses), 0, 'outsiders see none of it');
reset role;

select * from finish();
rollback;
