-- =============================================================================
-- Tests for phone notifications (Web Push).
-- Run with:  npx supabase test db
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'lena@example.test', '{"full_name": "Lena Lender"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test',  '{"full_name": "Bob Borrower"}');
update public.profiles set can_lend = true where id = '00000000-0000-4000-8000-00000000000a';
insert into public.lending_relationships (id, lender_id, borrower_id) values (
  '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select throws_ok(
  $$ select public.save_push_subscription('http://evil.example/push', repeat('k', 87), repeat('a', 22)) $$,
  '23514', null, 'push addresses must be https'
);
select lives_ok(
  $$ select public.save_push_subscription('https://web.push.apple.com/abc', repeat('k', 87), repeat('a', 22), 'iPhone') $$,
  'a device can turn notifications on'
);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select is((select count(*)::int from public.push_subscriptions), 0, 'nobody sees anyone else''s devices');
select throws_ok(
  $$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
     values ('00000000-0000-4000-8000-00000000000b', 'https://x.example', repeat('k', 87), repeat('a', 22)) $$,
  '42501', null, 'devices can only be added through the function'
);
select throws_ok('select * from public.claim_notification_pushes()', '42501', null, 'users can''t touch the push outbox');

-- Bob asks to borrow: Lena (who has a device) gets a push; Bob doesn't need one.
select public.create_loan('00000000-0000-4000-8000-0000000000e1', 10000, 0,
  jsonb_build_array(jsonb_build_object('due_on', ((now() at time zone 'Pacific/Auckland')::date + 7)::text, 'amount_cents', 10000)));
reset role;

set local role service_role;
select set_config('test.claimed', (select jsonb_agg(to_jsonb(c))::text from public.claim_notification_pushes() c), true);
reset role;
select is(jsonb_array_length(current_setting('test.claimed')::jsonb), 1, 'the new alert is ready to push');
select is(
  current_setting('test.claimed')::jsonb -> 0 -> 'subscriptions' -> 0 ->> 'endpoint',
  'https://web.push.apple.com/abc', 'to Lena''s device'
);
select is((current_setting('test.claimed')::jsonb -> 0 ->> 'unread')::int, 1, 'with her unread count for the app badge');

set local role service_role;
select public.finish_notification_push((current_setting('test.claimed')::jsonb -> 0 ->> 'id')::uuid, true, array['https://web.push.apple.com/abc']);
reset role;
select is(
  (select push_status from public.notifications where id = (current_setting('test.claimed')::jsonb -> 0 ->> 'id')::uuid),
  'sent', 'it''s marked sent'
);
select is((select count(*)::int from public.push_subscriptions), 0, 'devices the push service has forgotten are removed');

select * from finish();
rollback;
