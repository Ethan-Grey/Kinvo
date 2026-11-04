-- =============================================================================
-- Tests for accounts, invites and lending relationships (M2).
--
-- Run with:  npx supabase test db
--
-- Everything runs inside a transaction that is rolled back, so tests leave no
-- data behind. "Acting as" a user means switching to the `authenticated` role
-- and setting the JWT claims Supabase would normally set from a real session.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

-- -----------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'lena@example.test',  '{"full_name": "Lena Lender"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test',   '{"name": "Bob Borrower"}'),
  ('00000000-0000-4000-8000-00000000000c', 'casey@example.test', '{}');

update public.profiles set can_lend = true where id = '00000000-0000-4000-8000-00000000000a';

-- An invite that has already expired, with a known token.
insert into public.lender_invites (lender_id, token_hash, expires_at) values (
  '00000000-0000-4000-8000-00000000000a',
  encode(extensions.digest('expired-token', 'sha256'), 'hex'),
  now() - interval '1 day'
);


-- -----------------------------------------------------------------------------
-- Profile creation on sign-up
-- -----------------------------------------------------------------------------
select is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-00000000000a'),
  'Lena Lender',
  'profile takes display name from full_name'
);
select is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-00000000000b'),
  'Bob Borrower',
  'profile falls back to name'
);
select is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-00000000000c'),
  'casey',
  'profile falls back to the email prefix'
);
select is(
  (select can_lend from public.profiles where id = '00000000-0000-4000-8000-00000000000b'),
  true,
  'anyone can be owed, from the start (ADR-0019)'
);


-- -----------------------------------------------------------------------------
-- Anonymous visitors can do nothing
-- -----------------------------------------------------------------------------
set local role anon;

select throws_ok(
  'select public.create_invite()',
  '42501', null,
  'anonymous users cannot call create_invite'
);
select throws_ok(
  'select count(*) from public.profiles',
  '42501', null,
  'anonymous users cannot read profiles'
);

reset role;


-- -----------------------------------------------------------------------------
-- Anyone can create invites (ADR-0019)
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);

select lives_ok(
  'select public.create_invite()',
  'anyone can create an invite'
);


-- -----------------------------------------------------------------------------
-- Lena creates an invite for Bob
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);

select lives_ok(
  $$ select set_config('test.bob_token', (select token from public.create_invite('For Bob')), true) $$,
  'a lender can create an invite'
);
select is(
  char_length(current_setting('test.bob_token')),
  64,
  'invite token is 256 bits, hex-encoded'
);
select is(
  (select count(*)::int from public.lender_invites where note = 'For Bob'),
  1,
  'lender can see their invite'
);
select is(
  (select count(*)::int from public.lender_invites where token_hash = current_setting('test.bob_token')),
  0,
  'the raw token is not stored'
);
select is(
  (select status from public.preview_invite(current_setting('test.bob_token'))),
  'own_invite',
  'preview tells a lender the invite is their own'
);
select throws_ok(
  format('select public.accept_invite(%L)', current_setting('test.bob_token')),
  'P0001', 'invite_own',
  'a lender cannot accept their own invite'
);


-- -----------------------------------------------------------------------------
-- Bob previews and accepts
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);

select is(
  (select count(*)::int from public.lender_invites where lender_id <> '00000000-0000-4000-8000-00000000000b'),
  0,
  'people only see their own invites'
);
select is(
  (select count(*)::int from public.profiles),
  1,
  'before accepting, Bob can only see his own profile'
);
select is(
  (select lender_name || ' / ' || status from public.preview_invite(current_setting('test.bob_token'))),
  'Lena Lender / valid',
  'preview shows the lender name and a valid status'
);
select is(
  (select status from public.preview_invite('not-a-real-token')),
  'not_found',
  'preview reports unknown tokens'
);
select lives_ok(
  format('select public.accept_invite(%L)', current_setting('test.bob_token')),
  'Bob can accept the invite'
);
select is(
  (select count(*)::int from public.lending_relationships
   where lender_id = '00000000-0000-4000-8000-00000000000a'
     and borrower_id = '00000000-0000-4000-8000-00000000000b'
     and ended_at is null),
  1,
  'accepting creates an active relationship'
);
select is(
  (select count(*)::int from public.profiles),
  2,
  'after accepting, Bob can see Lena''s profile'
);


-- -----------------------------------------------------------------------------
-- Direct writes are blocked, even for parties to the data
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.lending_relationships (lender_id, borrower_id)
     values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c') $$,
  '42501', null,
  'users cannot insert relationships directly'
);
select throws_ok(
  $$ update public.profiles set can_lend = true $$,
  '42501', null,
  'users cannot grant themselves lender access'
);
select throws_ok(
  $$ delete from public.audit_events $$,
  '42501', null,
  'users cannot delete audit events'
);


-- -----------------------------------------------------------------------------
-- Casey (an outsider) is isolated
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c"}', true);

select throws_ok(
  format('select public.accept_invite(%L)', current_setting('test.bob_token')),
  'P0001', 'invite_used',
  'a used invite cannot be accepted again'
);
select throws_ok(
  $$ select public.accept_invite('expired-token') $$,
  'P0001', 'invite_expired',
  'an expired invite cannot be accepted'
);
select throws_ok(
  $$ select public.accept_invite('not-a-real-token') $$,
  'P0001', 'invite_not_found',
  'an unknown token is rejected'
);
select is(
  (select count(*)::int from public.lending_relationships),
  0,
  'outsiders see no relationships'
);
select is(
  (select count(*)::int from public.audit_events),
  0,
  'outsiders see no audit events'
);


-- -----------------------------------------------------------------------------
-- Revoking invites
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select set_config('test.casey_token', (select token from public.create_invite('For Casey')), true);
select set_config('test.casey_invite', (select id::text from public.lender_invites where note = 'For Casey'), true);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select throws_ok(
  format('select public.revoke_invite(%L)', current_setting('test.casey_invite')),
  'P0001', 'invite_not_found',
  'only the lender can revoke their invite'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select lives_ok(
  format('select public.revoke_invite(%L)', current_setting('test.casey_invite')),
  'the lender can revoke an unused invite'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c"}', true);
select throws_ok(
  format('select public.accept_invite(%L)', current_setting('test.casey_token')),
  'P0001', 'invite_revoked',
  'a revoked invite cannot be accepted'
);


-- -----------------------------------------------------------------------------
-- Ending and reopening a relationship
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select set_config('test.relationship',
  (select id::text from public.lending_relationships limit 1), true);
select throws_ok(
  format('select public.end_relationship(%L)', current_setting('test.relationship')),
  'P0001', 'relationship_not_found',
  'a borrower cannot end the relationship'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select lives_ok(
  format('select public.end_relationship(%L)', current_setting('test.relationship')),
  'the lender can end the relationship'
);
select set_config('test.bob_token_2', (select token from public.create_invite('Bob again')), true);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select is(
  (select public.accept_invite(current_setting('test.bob_token_2'))::text),
  current_setting('test.relationship'),
  're-inviting reopens the same relationship, keeping its history'
);


-- -----------------------------------------------------------------------------
-- Limits and validation
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);

-- Fill up to the limit of 10 open invites, then one more must fail.
do $$
begin
  while (select count(*) from public.lender_invites
         where accepted_at is null and revoked_at is null and expires_at > now()) < 10 loop
    perform public.create_invite();
  end loop;
end
$$;
select throws_ok(
  'select public.create_invite()',
  'P0001', 'too_many_open_invites',
  'lenders are capped at 10 open invites'
);
select throws_ok(
  $$ select public.set_display_name('   ') $$,
  'P0001', 'invalid_display_name',
  'blank display names are rejected'
);


-- -----------------------------------------------------------------------------
-- A signed-in role with no user id is rejected
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  'select public.create_invite()',
  'P0001', 'not_authenticated',
  'functions require a user id'
);

-- -----------------------------------------------------------------------------
-- Deleting someone who used an invite keeps the invite marked as used
-- -----------------------------------------------------------------------------
reset role;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000d', 'dana@example.test');
insert into public.lender_invites (id, lender_id, token_hash, expires_at, accepted_by, accepted_at) values (
  '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
  encode(extensions.digest('dana-token', 'sha256'), 'hex'), now() + interval '1 day',
  '00000000-0000-4000-8000-00000000000d', now());
delete from auth.users where id = '00000000-0000-4000-8000-00000000000d';
select ok(
  (select accepted_by is null and accepted_at is not null from public.lender_invites
   where id = '00000000-0000-4000-8000-0000000000f1'),
  'deleting a user who accepted an invite works, and the invite stays used'
);

select * from finish();
rollback;
