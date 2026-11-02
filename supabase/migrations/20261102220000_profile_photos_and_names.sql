-- =============================================================================
-- Real names and profile photos (ADR-0016)
--
-- * Everyone confirms their real name once. People who signed in with an
--   email code start with the first part of their email address as a name,
--   which isn't what family members should see.
-- * Optional profile photos, in a private bucket. Only you and the people
--   you lend to or borrow from can see yours. The app re-encodes photos to a
--   small JPEG before upload (see data/images.ts), the bucket only accepts
--   JPEG or WebP up to 2 MB, and the database only accepts a file in your own
--   folder that really exists.
-- =============================================================================

alter table public.profiles
  add column name_confirmed boolean not null default false,
  add column avatar_path text;

comment on column public.profiles.name_confirmed is 'True once the user has confirmed their real name. The app asks until then.';
comment on column public.profiles.avatar_path is 'Path of the profile photo in the avatars bucket, if any.';

-- A name that isn't just the start of the email address was chosen on
-- purpose (e.g. from Google), so it counts as confirmed.
update public.profiles
set name_confirmed = display_name <> split_part(email, '@', 1);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_given text := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), '')
  );
begin
  insert into public.profiles (id, email, display_name, name_confirmed)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(v_given, nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'New user'), 80),
    v_given is not null
  );
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- Setting your name now also confirms it, and refuses email addresses.
-- -----------------------------------------------------------------------------
create or replace function public.set_display_name(p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_name text := regexp_replace(btrim(coalesce(p_display_name, '')), '\s+', ' ', 'g');
begin
  if char_length(v_name) not between 2 and 80 or v_name ~ '@' then
    raise exception 'invalid_display_name';
  end if;

  update public.profiles set display_name = v_name, name_confirmed = true where id = v_user_id;
  perform private.log_event('profile_renamed', null, jsonb_build_object('display_name', v_name));
end;
$$;


-- -----------------------------------------------------------------------------
-- Profile photos
-- -----------------------------------------------------------------------------

-- Whose folder a photo is in ("<user id>/<random id>.jpg"), or null.
create function private.avatar_owner(p_path text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|webp)$'
    then split_part(p_path, '/', 1)::uuid
  end;
$$;

-- Whether the signed-in user may see this person's photo: their own, or
-- someone they lend to or borrow from.
create function private.can_see_avatar(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner = (select auth.uid()) or private.shares_relationship_with(p_owner);
$$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/webp'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    execute $p$
      create policy "Connected people view profile photos" on storage.objects for select to authenticated
      using (bucket_id = 'avatars' and private.can_see_avatar(private.avatar_owner(name)))
    $p$;
    execute $p$
      create policy "People upload their own profile photo" on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and private.avatar_owner(name) = (select auth.uid()))
    $p$;
  end if;
end
$$;

-- Use an uploaded photo, or remove it with null.
create function public.set_avatar(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_exists boolean := true;
begin
  if p_path is not null then
    if private.avatar_owner(p_path) is distinct from v_user_id then
      raise exception 'invalid_photo';
    end if;
    if to_regclass('storage.objects') is not null then
      execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)'
        into v_exists using 'avatars', p_path;
    end if;
    if not v_exists then
      raise exception 'photo_not_uploaded';
    end if;
  end if;

  update public.profiles set avatar_path = p_path where id = v_user_id;
  perform private.log_event('profile_photo_changed', null, jsonb_build_object('removed', p_path is null));
end;
$$;


-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function private.avatar_owner(text), private.can_see_avatar(uuid) from public, anon;
grant execute on function private.avatar_owner(text), private.can_see_avatar(uuid) to authenticated;
revoke execute on function public.set_avatar(text) from public, anon;
grant execute on function public.set_avatar(text) to authenticated;
