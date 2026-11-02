-- =============================================================================
-- Tests for confirming your real name, and profile photos.
-- Run with:  npx supabase test db
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'lena@example.test',   '{"full_name": "Lena Lender"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bobby99@example.test', '{}');

-- Names
select is((select name_confirmed from public.profiles where id = '00000000-0000-4000-8000-00000000000a'), true,
  'a name from Google counts as confirmed');
select is(
  (select display_name || ' / ' || name_confirmed from public.profiles where id = '00000000-0000-4000-8000-00000000000b'),
  'bobby99 / false', 'an email sign-in starts with the email name, unconfirmed'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select throws_ok($$ select public.set_display_name('bob@example.test') $$, 'P0001', 'invalid_display_name',
  'an email address isn''t a name');
select throws_ok($$ select public.set_display_name('B') $$, 'P0001', 'invalid_display_name', 'nor is one letter');
select lives_ok($$ select public.set_display_name('  Bob   Borrower ') $$, 'a real name is accepted');
reset role;
select is(
  (select display_name || ' / ' || name_confirmed from public.profiles where id = '00000000-0000-4000-8000-00000000000b'),
  'Bob Borrower / true', 'tidied and confirmed'
);

-- Photos
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select throws_ok(
  format('select public.set_avatar(%L)', '00000000-0000-4000-8000-00000000000a/' || gen_random_uuid() || '.jpg'),
  'P0001', 'invalid_photo', 'you can''t use a photo from someone else''s folder'
);
select throws_ok(
  format('select public.set_avatar(%L)', '00000000-0000-4000-8000-00000000000b/photo.svg'),
  'P0001', 'invalid_photo', 'only plain JPEG or WebP names are accepted'
);
reset role;
select set_config('test.photo', '00000000-0000-4000-8000-00000000000b/' || gen_random_uuid() || '.jpg', true);
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'insert into storage.objects (bucket_id, name) values ($1, $2)' using 'avatars', current_setting('test.photo');
  end if;
end
$$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select lives_ok(format('select public.set_avatar(%L)', current_setting('test.photo')), 'your own uploaded photo is accepted');
select lives_ok('select public.set_avatar(null)', 'and can be removed');
reset role;
select is((select avatar_path from public.profiles where id = '00000000-0000-4000-8000-00000000000b'), null,
  'removing clears it');

select * from finish();
rollback;
