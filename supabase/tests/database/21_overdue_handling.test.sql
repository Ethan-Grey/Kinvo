-- =============================================================================
-- Overdue handling: late reminders that stop, and late payments that move
-- (ADR-0027).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

create function pg_temp.receipt(p_loan uuid) returns text language plpgsql security definer as $h$
declare v_path text := p_loan || '/' || gen_random_uuid() || '.jpg';
begin
  if to_regclass('storage.objects') is not null then
    execute 'insert into storage.objects (bucket_id, name) values ($1, $2)' using 'receipts', v_path;
  end if;
  return v_path;
end
$h$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'lena@example.test', '{"full_name": "Lena Lender"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test',  '{"full_name": "Bob Borrower"}');
insert into public.lending_relationships (id, lender_id, borrower_id) values (
  '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');

select set_config('test.today', ((now() at time zone 'Pacific/Auckland')::date)::text, true);
create function pg_temp.d(p_offset int) returns date language sql as $$
  select current_setting('test.today')::date + p_offset;
$$;
create function pg_temp.nz(p_offset int) returns timestamptz language sql as $$
  select (current_setting('test.today')::date + p_offset + time '10:05') at time zone 'Pacific/Auckland';
$$;
create function pg_temp.plan(variadic p int[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('due_on', pg_temp.d(p[i]), 'amount_cents', p[i + 1]) order by i)
  from generate_series(1, array_length(p, 1), 2) i;
$$;
create function pg_temp.dues(p_loan uuid) returns text language sql security definer as $$
  select string_agg((i.due_on - current_setting('test.today')::date) || ':' || i.amount_cents, ' ' order by i.sequence)
  from public.instalments i join public.loans l on l.current_terms_id = i.terms_id where l.id = p_loan;
$$;
create function pg_temp.count_kind(p_kind text) returns int language sql security definer as $$
  select count(*)::int from public.notifications where kind = p_kind;
$$;
create function pg_temp.start(p_plan jsonb, p_total bigint) returns uuid language plpgsql as $$
declare v_loan uuid; v_terms uuid;
begin
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
  v_loan := public.create_loan('00000000-0000-4000-8000-0000000000e1', p_total, 0, p_plan);
  select current_terms_id into v_terms from public.loans where id = v_loan;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
  perform public.accept_terms(v_loan, v_terms, (select terms_hash from public.loan_terms where id = v_terms));
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
  perform public.confirm_funds_sent(v_loan, pg_temp.d(0), 'cash', null, pg_temp.receipt(v_loan));
  return v_loan;
end
$$;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated;
-- $200 in two payments: day 10 and day 40.
select set_config('test.loan', pg_temp.start(pg_temp.plan(10, 10000, 40, 10000), 20000)::text, true);

-- =============================================================================
-- Late reminders stop after a set number of days
-- =============================================================================
select throws_ok(
  format('select public.save_reminder_settings(%L, %L, 1, 9, 200)', '00000000-0000-4000-8000-0000000000e1', '[]'),
  'P0001', 'invalid_setting', 'the stop day has limits'
);
select lives_ok(
  format('select public.save_reminder_settings(%L, %L, 1, 9, 2)', '00000000-0000-4000-8000-0000000000e1', '[]'),
  'remind daily while late, for 2 days'
);
reset role;
select private.queue_reminders(pg_temp.nz(11));
select private.queue_reminders(pg_temp.nz(12));
select is(pg_temp.count_kind('overdue'), 2, 'reminded on each late day up to the limit');
select private.queue_reminders(pg_temp.nz(13));
select private.queue_reminders(pg_temp.nz(14));
select is(pg_temp.count_kind('overdue'), 2, 'then they stop');
select private.queue_reminders(pg_temp.nz(18));
select is(pg_temp.count_kind('borrower_overdue'), 1, 'the person owed stops hearing about it too');
select is(pg_temp.dues(current_setting('test.loan')::uuid), '10:10000 40:10000', 'nothing moves unless asked');

-- =============================================================================
-- Moving the whole plan, a week from the missed date, after 20 days late
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select throws_ok(
  format('select public.save_reminder_settings(%L, %L, null, 9, null, 3)', '00000000-0000-4000-8000-0000000000e1', '[]'),
  'P0001', 'lender_only', 'only the person owed sets it'
);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select public.save_reminder_settings('00000000-0000-4000-8000-0000000000e1', '[]', null, 9, null, 20, 7, true);
reset role;

select private.move_overdue_payments(pg_temp.nz(29));
select is(pg_temp.dues(current_setting('test.loan')::uuid), '10:10000 40:10000', 'not before the set number of days');
select private.move_overdue_payments(pg_temp.nz(30));
-- Day 17 has passed, so it goes a further week: day 31. The rest moves by the same 21 days.
select is(pg_temp.dues(current_setting('test.loan')::uuid), '31:10000 61:10000', 'the plan moves, to a date still ahead');
select is(
  (select late_since - pg_temp.d(0) || ' ' || (moved_to - pg_temp.d(0)) || ' ' || times_moved from public.loans
   where id = current_setting('test.loan')::uuid),
  '10 31 1', 'the loan remembers it''s late, since when, and how many moves'
);
select is(pg_temp.count_kind('payment_moved'), 2, 'both people are told');
select private.move_overdue_payments(pg_temp.nz(30));
select is((select times_moved from public.loans where id = current_setting('test.loan')::uuid), 1, 'once');

-- Paying the moved payment clears the late flag.
set local role authenticated;
select public.record_repayment(current_setting('test.loan')::uuid, 10000, pg_temp.d(0), 'cash', null, null,
  pg_temp.receipt(current_setting('test.loan')::uuid));
reset role;
select private.move_overdue_payments(pg_temp.nz(31));
select is((select late_since from public.loans where id = current_setting('test.loan')::uuid), null::date,
  'catching up clears it');
select is((select times_moved from public.loans where id = current_setting('test.loan')::uuid), 1, 'the count stays');

-- =============================================================================
-- Moving only the missed payment
-- =============================================================================
set local role authenticated;
select set_config('test.loan2', pg_temp.start(pg_temp.plan(5, 5000, 9, 5000, 30, 5000), 15000)::text, true);
select public.record_repayment(current_setting('test.loan2')::uuid, 2000, pg_temp.d(0), 'cash', null, null,
  pg_temp.receipt(current_setting('test.loan2')::uuid));
select public.save_reminder_settings('00000000-0000-4000-8000-0000000000e1', '[]', null, 9, null, 1, 4, false);
reset role;
-- The first is a day late on day 6. Only the $30 still owed moves, 4 days on to day 9,
-- joining the payment already due then; the $20 paid stays on day 5.
select private.move_overdue_payments(pg_temp.nz(6));
select is(pg_temp.dues(current_setting('test.loan2')::uuid), '5:2000 9:8000 30:5000',
  'only the missed amount moves, and joins a payment on the same day');
select is(
  (select sum(amount_cents)::bigint from public.instalments i join public.loans l on l.current_terms_id = i.terms_id
   where l.id = current_setting('test.loan2')::uuid),
  15000::bigint, 'the total never changes'
);
select is(
  (select count(*)::int from public.loan_terms where loan_id = current_setting('test.loan2')::uuid), 2,
  'each move is kept as a new version of the plan'
);

select * from finish();
rollback;
