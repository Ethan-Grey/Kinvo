-- =============================================================================
-- Tests for notifications: who hears about what, reminders, and the outbox.
-- Run with:  npx supabase test db
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

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
  ('00000000-0000-4000-8000-00000000000a', 'lena@example.test',  '{"full_name": "Lena Lender"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test',   '{"full_name": "Bob Borrower"}'),
  ('00000000-0000-4000-8000-00000000000c', 'casey@example.test', '{"full_name": "Casey Outsider"}');
update public.profiles set can_lend = true where id = '00000000-0000-4000-8000-00000000000a';
insert into public.lending_relationships (id, lender_id, borrower_id) values (
  '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');

select set_config('test.today', ((now() at time zone 'Pacific/Auckland')::date)::text, true);

-- Helpers: a time on today's NZ date, and counting notifications by kind.
create function pg_temp.nz_at(hhmm text) returns timestamptz language sql as $$
  select (current_setting('test.today')::date + hhmm::time) at time zone 'Pacific/Auckland';
$$;
create function pg_temp.count_kind(p_kind text) returns int language sql as $$
  select count(*)::int from public.notifications where kind = p_kind;
$$;
create function pg_temp.title_for(p_user uuid, p_kind text) returns text language sql as $$
  select title from public.notifications where recipient_id = p_user and kind = p_kind order by created_at desc limit 1;
$$;
create function pg_temp.set_due(p_seq int, p_offset int) returns void language sql as $$
  update public.instalments i set due_on = current_setting('test.today')::date + p_offset
  from public.loans l where l.id = current_setting('test.loan')::uuid and i.terms_id = l.current_terms_id and i.sequence = p_seq;
$$;
grant execute on all functions in schema pg_temp to authenticated;


-- =============================================================================
-- Event notifications through a loan's life
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select set_config('test.loan', public.create_loan('00000000-0000-4000-8000-0000000000e1', 20000, 0,
  jsonb_build_array(
    jsonb_build_object('due_on', (current_setting('test.today')::date + 7)::text, 'amount_cents', 10000),
    jsonb_build_object('due_on', (current_setting('test.today')::date + 14)::text, 'amount_cents', 10000)))::text, true);
reset role;

select is(
  pg_temp.title_for('00000000-0000-4000-8000-00000000000a', 'loan_requested'),
  'Bob Borrower asked you for $200.00', 'the lender hears about a new request'
);
select is(
  (select count(*)::int from public.notifications where recipient_id = '00000000-0000-4000-8000-00000000000b'),
  0, 'nobody is notified about their own action'
);
select is(
  (select link_path from public.notifications where kind = 'loan_requested'),
  '/loans/' || current_setting('test.loan'), 'notifications link to the loan'
);

-- Lena counters with a $20 charge; Bob accepts; Lena sends the money.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select public.counter_offer(l.id, l.current_terms_id, 20000, 2000,
  jsonb_build_array(
    jsonb_build_object('due_on', (current_setting('test.today')::date + 7)::text, 'amount_cents', 11000),
    jsonb_build_object('due_on', (current_setting('test.today')::date + 14)::text, 'amount_cents', 11000)))
from public.loans l where l.id = current_setting('test.loan')::uuid;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select public.accept_terms(l.id, t.id, t.terms_hash)
from public.loans l join public.loan_terms t on t.id = l.current_terms_id where l.id = current_setting('test.loan')::uuid;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select pg_temp.confirm_funds_sent(current_setting('test.loan')::uuid, current_setting('test.today')::date, 'bank_transfer');
reset role;

select is(
  pg_temp.title_for('00000000-0000-4000-8000-00000000000b', 'counter_offer'),
  'Lena Lender suggested different terms', 'the borrower hears about a counter-offer'
);
select is(
  (select body from public.notifications where kind = 'counter_offer'),
  'New proposal: $200.00, paid back as $220.00 in total. Open Kinvo to reply.', 'the counter-offer shows the new figures'
);
select is(
  pg_temp.title_for('00000000-0000-4000-8000-00000000000a', 'terms_accepted'),
  'Bob Borrower accepted', 'the lender hears the loan was accepted'
);
select ok(
  (select body like 'Once you''ve sent $200.00 or paid for it%' from public.notifications where kind = 'terms_accepted'),
  'and is told to send the money'
);
select is(
  pg_temp.title_for('00000000-0000-4000-8000-00000000000b', 'funds_sent'),
  'Lena Lender paid out $200.00 for you', 'the borrower hears the money was sent'
);
select ok(
  (select body like 'Paying back has started. First payment: $110.00 due %' from public.notifications where kind = 'funds_sent'),
  'with the first payment amount and date'
);

-- Payments
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select set_config('test.claim', pg_temp.record_repayment(current_setting('test.loan')::uuid, 5000,
  current_setting('test.today')::date, 'bank_transfer', 'ONE')::text, true);
select set_config('test.claim2', pg_temp.record_repayment(current_setting('test.loan')::uuid, 1000,
  current_setting('test.today')::date, 'cash', 'TWO')::text, true);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select public.confirm_repayment(current_setting('test.claim')::uuid);
select public.dispute_repayment(current_setting('test.claim2')::uuid, 'Not in my account');
reset role;

select is(
  (select string_agg(title, ' | ' order by title) from public.notifications where kind = 'payment_claimed'),
  'Bob Borrower says they paid you $10.00 | Bob Borrower says they paid you $50.00', 'the lender hears about each claim'
);
select is(
  pg_temp.title_for('00000000-0000-4000-8000-00000000000b', 'payment_confirmed'),
  'Lena Lender confirmed your payment of $50.00', 'the borrower hears a payment was confirmed'
);
select is(
  (select title || ' / ' || body from public.notifications where kind = 'payment_disputed'),
  'Lena Lender hasn''t received your payment of $10.00 / Their note: Not in my account',
  'the borrower hears about a dispute, with the reason'
);


-- =============================================================================
-- Access
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select is(
  (select count(*)::int from public.notifications where recipient_id <> '00000000-0000-4000-8000-00000000000b'),
  0, 'users only see their own notifications'
);
select ok((select count(*) > 0 from public.notifications where read_at is null), 'new notifications are unread');
select lives_ok('select public.mark_notifications_read()', 'a user can mark their notifications read');
select is((select count(*)::int from public.notifications where read_at is null), 0, 'all of Bob''s are now read');
select throws_ok('select * from public.claim_notification_emails()', '42501', null, 'users cannot touch the email outbox');
select throws_ok($$ update public.notifications set read_at = null $$, '42501', null, 'notifications cannot be edited directly');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c"}', true);
select is((select count(*)::int from public.notifications), 0, 'outsiders see nothing');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select ok((select count(*) > 0 from public.notifications where read_at is null), 'marking read only affects your own');
reset role;


-- =============================================================================
-- Reminders (9am NZ). Instalment 1 has $60 left after Bob's $50.
-- =============================================================================
select pg_temp.set_due(1, 1);
select pg_temp.set_due(2, 30);

select private.queue_reminders(pg_temp.nz_at('08:30'));
select is(pg_temp.count_kind('due_tomorrow'), 0, 'nothing is queued before 9am NZ');

select private.queue_reminders(pg_temp.nz_at('10:00'));
select is(
  pg_temp.title_for('00000000-0000-4000-8000-00000000000b', 'due_tomorrow'),
  '$60.00 due to Lena Lender tomorrow', 'the borrower is reminded the day before, for what''s left'
);
select private.queue_reminders(pg_temp.nz_at('11:00'));
select is(pg_temp.count_kind('due_tomorrow'), 1, 'running again the same day doesn''t duplicate');
select is(
  (select count(*)::int from public.notifications where kind = 'due_tomorrow' and recipient_id = '00000000-0000-4000-8000-00000000000a'),
  0, 'the lender isn''t told about routine due dates'
);

select pg_temp.set_due(1, 0);
select private.queue_reminders(pg_temp.nz_at('09:05'));
select is(pg_temp.count_kind('due_today'), 1, 'the borrower is reminded on the due date');

select pg_temp.set_due(1, -1);
select private.queue_reminders(pg_temp.nz_at('09:05'));
select is(pg_temp.count_kind('overdue'), 1, 'the borrower is told the day after a missed payment');
select is(
  pg_temp.title_for('00000000-0000-4000-8000-00000000000a', 'borrower_overdue'),
  'Bob Borrower''s payment of $60.00 is overdue', 'and so is the lender'
);

delete from public.notifications where kind in ('overdue', 'borrower_overdue');
select pg_temp.set_due(1, -3);
select private.queue_reminders(pg_temp.nz_at('09:05'));
select is(pg_temp.count_kind('overdue') + pg_temp.count_kind('borrower_overdue'), 0, 'no nudge between weekly reminders');

select pg_temp.set_due(1, -8);
select private.queue_reminders(pg_temp.nz_at('09:05'));
select is(pg_temp.count_kind('overdue') + pg_temp.count_kind('borrower_overdue'), 2, 'a weekly nudge a week later');


-- =============================================================================
-- Email outbox (as the server-side sender)
-- =============================================================================
set local role service_role;
select set_config('test.batch', (select count(*)::text from public.claim_notification_emails(100)), true);
select ok(current_setting('test.batch')::int > 0, 'the sender can claim pending emails');
select is((select count(*)::int from public.claim_notification_emails(100)), 0, 'claimed emails aren''t handed out twice');
reset role;
select set_config('test.n1', (select id::text from public.notifications where kind = 'loan_requested'), true);
select set_config('test.n2', (select id::text from public.notifications where kind = 'funds_sent'), true);
set local role service_role;
select public.finish_notification_email(current_setting('test.n1')::uuid, true);
select public.finish_notification_email(current_setting('test.n2')::uuid, false, 'SMTP timeout');
reset role;
select is(
  (select email_status from public.notifications where id = current_setting('test.n1')::uuid)
    || ' / ' || (select email_status || ':' || email_attempts from public.notifications where id = current_setting('test.n2')::uuid),
  'sent / pending:1', 'sent emails are marked; failed ones go back in the queue'
);

select * from finish();
rollback;
