-- =============================================================================
-- Tests for the lender changing a running loan's schedule, reminder settings
-- and custom reminders (ADR-0018).
-- Run with:  npx supabase test db
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

create function pg_temp.receipt(p_loan uuid) returns text language plpgsql security definer as $h$
declare v_path text := p_loan || '/' || gen_random_uuid() || '.jpg';
begin
  if to_regclass('storage.objects') is not null then
    execute 'insert into storage.objects (bucket_id, name) values ($1, $2)' using 'receipts', v_path;
  end if;
  return v_path;
end
$h$;
grant execute on all functions in schema pg_temp to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'lena@example.test',  '{"full_name": "Lena Lender"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test',   '{"full_name": "Bob Borrower"}'),
  ('00000000-0000-4000-8000-00000000000c', 'casey@example.test', '{"full_name": "Casey Outsider"}');
update public.profiles set can_lend = true where id = '00000000-0000-4000-8000-00000000000a';
insert into public.lending_relationships (id, lender_id, borrower_id) values (
  '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');

select set_config('test.today', ((now() at time zone 'Pacific/Auckland')::date)::text, true);
create function pg_temp.d(p_offset int) returns text language sql as $$
  select (current_setting('test.today')::date + p_offset)::text;
$$;
create function pg_temp.nz(p_offset int, hhmm text) returns timestamptz language sql as $$
  select (current_setting('test.today')::date + p_offset + hhmm::time) at time zone 'Pacific/Auckland';
$$;
create function pg_temp.plan2(a int, a_amt bigint, b int, b_amt bigint) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('due_on', pg_temp.d(a), 'amount_cents', a_amt),
    jsonb_build_object('due_on', pg_temp.d(b), 'amount_cents', b_amt));
$$;
create function pg_temp.terms_id() returns uuid language sql as $$
  select current_terms_id from public.loans where id = current_setting('test.loan')::uuid;
$$;
create function pg_temp.count_kind(p_kind text) returns int language sql security definer as $$
  select count(*)::int from public.notifications where kind = p_kind;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- A $200 loan in two $100 payments, due in 10 and 40 days.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select set_config('test.loan',
  public.create_loan('00000000-0000-4000-8000-0000000000e1', 20000, 0, pg_temp.plan2(10, 10000, 40, 10000), 'Test reason')::text, true);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select public.accept_terms(current_setting('test.loan')::uuid, pg_temp.terms_id(),
  (select terms_hash from public.loan_terms where id = pg_temp.terms_id()));
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select public.confirm_funds_sent(current_setting('test.loan')::uuid, pg_temp.d(0)::date, 'cash', null, pg_temp.receipt(current_setting('test.loan')::uuid));


-- =============================================================================
-- Changing the schedule
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select throws_ok(
  format('select public.reschedule_loan(%L, %L, %L)', current_setting('test.loan'), pg_temp.terms_id(), pg_temp.plan2(20, 10000, 50, 10000)),
  'P0001', 'lender_only', 'the borrower can''t change the schedule'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select throws_ok(
  format('select public.reschedule_loan(%L, %L, %L)', current_setting('test.loan'), gen_random_uuid(), pg_temp.plan2(20, 10000, 50, 10000)),
  'P0001', 'terms_changed', 'it must be based on the latest schedule'
);
select throws_ok(
  format('select public.reschedule_loan(%L, %L, %L)', current_setting('test.loan'), pg_temp.terms_id(), pg_temp.plan2(20, 10000, 50, 5000)),
  'P0001', 'schedule_total_mismatch', 'the total owed can''t change'
);
select set_config('test.old_terms', pg_temp.terms_id()::text, true);
select lives_ok(
  format('select public.reschedule_loan(%L, %L, %L, %L)', current_setting('test.loan'), pg_temp.terms_id(),
    pg_temp.plan2(20, 5000, 50, 15000), 'Pay day moved'),
  'the lender can change the dates and amounts'
);
select is(
  (select array_agg(due_on::text || '=' || amount_cents order by sequence) from public.instalments where terms_id = pg_temp.terms_id()),
  array[pg_temp.d(20) || '=5000', pg_temp.d(50) || '=15000'],
  'the new schedule is in place'
);
select is((select status::text from public.loans where id = current_setting('test.loan')::uuid), 'active',
  'it takes effect straight away');
select is((select count(*)::int from public.instalments where terms_id = current_setting('test.old_terms')::uuid), 2,
  'the old schedule is kept in the history');
select is((select total_cents from public.list_loan_balances() where loan_id = current_setting('test.loan')::uuid), 20000::bigint,
  'the amount owed is unchanged');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select is(
  (select title || ' / ' || body from public.notifications where kind = 'loan_rescheduled'),
  'Lena Lender changed your repayment dates / Their note: Pay day moved Open Kinvo to see the new schedule.',
  'the borrower is told'
);

-- Payments follow the new schedule. Bob pays $60: the first ($50) is paid, $10 goes to the second.
select public.record_repayment(current_setting('test.loan')::uuid, 6000, pg_temp.d(0)::date, 'cash', null, null, pg_temp.receipt(current_setting('test.loan')::uuid));
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select public.confirm_repayment((select id from public.repayments where loan_id = current_setting('test.loan')::uuid));
select is(
  (select array_agg(paid_cents order by sequence) from public.get_instalment_progress(current_setting('test.loan')::uuid)),
  array[5000, 1000]::bigint[], 'payments fill the new schedule oldest first'
);
-- Already-paid instalments can keep a date in the past.
select lives_ok(
  format('select public.reschedule_loan(%L, %L, %L)', current_setting('test.loan'), pg_temp.terms_id(),
    pg_temp.plan2(-5, 5000, 14, 15000)),
  'a paid instalment can keep an earlier date'
);
reset role;
select is((select count(*)::int from public.audit_events where event_type = 'loan_rescheduled'), 2,
  'each change is in the audit log');


-- =============================================================================
-- Reminder times (ADR-0019)
-- =============================================================================
create function pg_temp.due(p_offset int) returns void language sql security definer as $$
  update public.instalments set due_on = current_setting('test.today')::date + p_offset
  where terms_id = pg_temp.terms_id() and sequence = 2;
$$;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select throws_ok(
  $$ select public.save_reminder_settings('00000000-0000-4000-8000-0000000000e1', '[]', null, 9) $$,
  'P0001', 'lender_only', 'the borrower can''t change reminder times'
);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c"}', true);
select throws_ok(
  $$ select public.save_reminder_settings('00000000-0000-4000-8000-0000000000e1', '[]', null, 9) $$,
  'P0001', 'relationship_not_found', 'nor can an outsider'
);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select throws_ok(
  $$ select public.save_reminder_settings('00000000-0000-4000-8000-0000000000e1', '[{"days_from_due": 0, "send_hour": 24}]', null, 9) $$,
  'P0001', 'invalid_setting', 'the hour must be 0-23'
);
select lives_ok(
  $$ select public.save_reminder_settings('00000000-0000-4000-8000-0000000000e1',
       '[{"days_from_due": 0, "send_hour": 9}, {"days_from_due": 0, "send_hour": 18}, {"days_from_due": 1, "send_hour": 12}]',
       3, 18) $$,
  'the lender can set 9am and 6pm on the day, noon the day after, then every 3 days at 6pm'
);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select is((select count(*)::int from public.reminder_rules), 3, 'the borrower can see their reminder times');
reset role;

select pg_temp.due(1);
select private.queue_reminders(pg_temp.nz(0, '19:05'));
select is(pg_temp.count_kind('due_tomorrow'), 0, 'no day-before reminder unless one is set');

select pg_temp.due(0);
select private.queue_reminders(pg_temp.nz(0, '09:05'));
select is(pg_temp.count_kind('due_today'), 1, 'the first on-the-day reminder comes at 9am');
select private.queue_reminders(pg_temp.nz(0, '12:05'));
select is(pg_temp.count_kind('due_today'), 1, 'nothing in between');
select private.queue_reminders(pg_temp.nz(0, '18:05'));
select is(pg_temp.count_kind('due_today'), 2, 'and a second one at 6pm');

select pg_temp.due(-1);
select private.queue_reminders(pg_temp.nz(0, '11:05'));
select is(pg_temp.count_kind('overdue'), 0, 'the day after, nothing before noon');
select private.queue_reminders(pg_temp.nz(0, '12:05'));
select is(pg_temp.count_kind('overdue'), 1, 'then the day-after reminder');
select is(pg_temp.count_kind('borrower_overdue'), 1, 'and the person owed is told');

select pg_temp.due(-4);
select private.queue_reminders(pg_temp.nz(0, '17:05'));
select is(pg_temp.count_kind('overdue'), 1, 'late reminders wait for their hour');
select private.queue_reminders(pg_temp.nz(0, '18:05'));
select is(pg_temp.count_kind('overdue'), 2, 'then repeat every 3 days after the last reminder');

update public.reminder_settings set late_every_days = null;
select pg_temp.due(-7);
select private.queue_reminders(pg_temp.nz(0, '18:05'));
select is(pg_temp.count_kind('overdue'), 2, 'repeating late reminders can be turned off');
select pg_temp.due(-8);
select private.queue_reminders(pg_temp.nz(0, '09:05'));
select is(pg_temp.count_kind('borrower_overdue'), 2, 'but the person owed still hears weekly');


-- =============================================================================
-- Custom reminders
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select throws_ok(
  format('select public.create_custom_reminder(%L, %L, %L, 9)', '00000000-0000-4000-8000-0000000000e1', 'Hi', pg_temp.d(1)),
  'P0001', 'lender_only', 'only the lender can set reminders'
);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select throws_ok(
  format('select public.create_custom_reminder(%L, %L, %L, 9)', '00000000-0000-4000-8000-0000000000e1', 'Hi', pg_temp.d(-1)),
  'P0001', 'reminder_in_past', 'a reminder must be in the future'
);
select throws_ok(
  format('select public.create_custom_reminder(%L, %L, %L, 9)', '00000000-0000-4000-8000-0000000000e1', '   ', pg_temp.d(1)),
  'P0001', 'invalid_reminder_message', 'it needs a message'
);
select set_config('test.once', public.create_custom_reminder(
  '00000000-0000-4000-8000-0000000000e1', 'Rent week, pay what you can', pg_temp.d(1)::date, 17)::text, true);
select set_config('test.weekly', public.create_custom_reminder(
  '00000000-0000-4000-8000-0000000000e1', 'Weekly check-in', pg_temp.d(1)::date, 8, 'weekly',
  current_setting('test.loan')::uuid)::text, true);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select is((select count(*)::int from public.custom_reminders), 0, 'the borrower doesn''t see the list');
reset role;

select private.queue_reminders(pg_temp.nz(1, '08:05'));
select is(
  (select title || ' / ' || body from public.notifications where kind = 'custom_reminder'),
  'Reminder from Lena Lender / Weekly check-in', 'a custom reminder arrives at its hour'
);
select private.queue_reminders(pg_temp.nz(1, '17:05'));
select private.queue_reminders(pg_temp.nz(1, '18:05'));
select is(pg_temp.count_kind('custom_reminder'), 2, 'each goes out once');
select is(
  (select next_at from public.custom_reminders where id = current_setting('test.weekly')::uuid),
  pg_temp.nz(8, '08:00'), 'a weekly one is set for a week later'
);
select is(
  (select next_at from public.custom_reminders where id = current_setting('test.once')::uuid), null,
  'a one-off is finished'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select public.cancel_custom_reminder(current_setting('test.weekly')::uuid);
reset role;
select private.queue_reminders(pg_temp.nz(8, '09:05'));
select is(pg_temp.count_kind('custom_reminder'), 2, 'a cancelled reminder stops');

select * from finish();
rollback;
