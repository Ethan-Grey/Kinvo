-- =============================================================================
-- Tests for account settings: the email switch and "Download my data".
-- Run with:  npx supabase test db
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'lena@example.test',  '{"full_name": "Lena Lender"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test',   '{"full_name": "Bob Borrower"}'),
  ('00000000-0000-4000-8000-00000000000c', 'casey@example.test', '{"full_name": "Casey Outsider"}');
update public.profiles set can_lend = true where id = '00000000-0000-4000-8000-00000000000a';
insert into public.lending_relationships (id, lender_id, borrower_id) values (
  '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');


-- =============================================================================
-- Email switch
-- =============================================================================
select is(
  (select email_notifications from public.profiles where id = '00000000-0000-4000-8000-00000000000b'),
  true, 'emails are on by default'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
-- Bob asks to borrow, which notifies Lena.
select set_config('test.loan', public.create_loan('00000000-0000-4000-8000-0000000000e1', 10000, 0,
  jsonb_build_array(jsonb_build_object(
    'due_on', ((now() at time zone 'Pacific/Auckland')::date + 7)::text, 'amount_cents', 10000)), 'Test reason')::text, true);

-- Lena switches emails off.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select lives_ok('select public.set_email_notifications(false)', 'a user can switch emails off');
select is(
  (select email_notifications from public.profiles where id = '00000000-0000-4000-8000-00000000000a'),
  false, 'the setting is saved'
);
select throws_ok('select public.set_email_notifications(null)', 'P0001', 'invalid_setting', 'the setting must be on or off');
select throws_ok(
  $$ update public.profiles set email_notifications = true where id = '00000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'profiles cannot be edited directly'
);
-- Lena withdraws nothing; Bob's request is still pending. Lena counters, notifying Bob.
select public.counter_offer(l.id, l.current_terms_id, 10000, 500,
  jsonb_build_array(jsonb_build_object(
    'due_on', ((now() at time zone 'Pacific/Auckland')::date + 7)::text, 'amount_cents', 10500)))
from public.loans l where l.id = current_setting('test.loan')::uuid;
reset role;

set local role service_role;
select set_config('test.claimed', (select string_agg(email, ',') from public.claim_notification_emails(100)), true);
reset role;

select is(current_setting('test.claimed'), 'bob@example.test', 'only people with emails on are emailed');
select is(
  (select email_status from public.notifications where kind = 'loan_requested'),
  'skipped', 'Lena''s queued email is skipped, not sent later'
);
select is(
  (select count(*)::int from public.notifications where recipient_id = '00000000-0000-4000-8000-00000000000a'),
  1, 'Lena still sees the notification in the app'
);
select is(
  (select count(*)::int from public.audit_events where event_type = 'email_notifications_changed'),
  1, 'changing the setting is logged'
);


-- =============================================================================
-- Download my data
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select set_config('test.export', public.export_my_data()::text, true);
reset role;

select is(current_setting('test.export')::jsonb #>> '{profile,email}', 'bob@example.test', 'the export has your profile');
select is(
  current_setting('test.export')::jsonb #>> '{people,0,other_person}', 'Lena Lender',
  'and the people you''re connected with'
);
select is(jsonb_array_length(current_setting('test.export')::jsonb -> 'loans'), 1, 'and your loans');
select is(jsonb_array_length(current_setting('test.export')::jsonb -> 'loan_terms'), 2, 'with every version of the terms');
select ok(
  not (current_setting('test.export')::jsonb ? 'token_hash')
    and current_setting('test.export') not like '%token_hash%',
  'invite token hashes are never exported'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c"}', true);
select is(
  jsonb_array_length(public.export_my_data() -> 'loans'), 0,
  'someone else''s loans never appear in your export'
);
select set_config('request.jwt.claims', '', true);
select throws_ok('select public.export_my_data()', 'P0001', 'not_authenticated', 'signed-out users get nothing');
reset role;

select * from finish();
rollback;
