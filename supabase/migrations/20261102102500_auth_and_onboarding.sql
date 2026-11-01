-- =============================================================================
-- M2: Accounts, lender invites and lending relationships
--
-- Security model (ADR-0003):
--   * Clients may SELECT rows they are party to, enforced by Row Level Security.
--   * Clients may never INSERT, UPDATE or DELETE these tables directly.
--   * Every change goes through a SECURITY DEFINER function below, which checks
--     permissions, validates input, makes the change and writes an audit event.
--
-- Functions raise exceptions whose MESSAGE is a stable machine-readable key
-- (e.g. 'invite_expired'). The web app maps these keys to friendly text.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema for internal helpers. Not exposed through the Supabase API.
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- profiles: one row per signed-in user
-- -----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  email        text not null,
  -- Lender access is granted manually (ADR-0008). Everyone can be a borrower.
  can_lend     boolean not null default false,
  created_at   timestamptz not null default now()
);

comment on table public.profiles is 'Public profile for each auth user.';
comment on column public.profiles.can_lend is 'Granted manually by an administrator; allows creating invites and loans.';


-- -----------------------------------------------------------------------------
-- lender_invites: single-use links a lender sends to a prospective borrower
-- -----------------------------------------------------------------------------
create table public.lender_invites (
  id          uuid primary key default gen_random_uuid(),
  lender_id   uuid not null references public.profiles (id) on delete cascade,
  -- SHA-256 of the secret token in the link. The raw token is never stored, so
  -- a database leak doesn't expose usable invite links.
  token_hash  text not null unique,
  -- Optional label so the lender knows who an invite was for, e.g. "Aunty".
  note        text check (note is null or char_length(note) <= 80),
  expires_at  timestamptz not null,
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),

  constraint lender_invites_accepted_pair
    check ((accepted_by is null) = (accepted_at is null)),
  constraint lender_invites_not_both_accepted_and_revoked
    check (accepted_at is null or revoked_at is null)
);

create index lender_invites_lender_id_idx on public.lender_invites (lender_id);

comment on table public.lender_invites is 'Single-use, expiring invite links (ADR-0006, ADR-0008).';


-- -----------------------------------------------------------------------------
-- lending_relationships: one lender linked to one borrower
-- -----------------------------------------------------------------------------
create table public.lending_relationships (
  id          uuid primary key default gen_random_uuid(),
  lender_id   uuid not null references public.profiles (id) on delete restrict,
  borrower_id uuid not null references public.profiles (id) on delete restrict,
  invite_id   uuid references public.lender_invites (id) on delete set null,
  created_at  timestamptz not null default now(),
  ended_at    timestamptz,

  constraint lending_relationships_not_self check (lender_id <> borrower_id),
  constraint lending_relationships_pair_unique unique (lender_id, borrower_id)
);

create index lending_relationships_borrower_id_idx on public.lending_relationships (borrower_id);

comment on table public.lending_relationships is 'Links a lender and a borrower. Loans belong to a relationship (ADR-0006).';


-- -----------------------------------------------------------------------------
-- audit_events: append-only log of every state change (NF-03)
-- -----------------------------------------------------------------------------
create table public.audit_events (
  id              bigint generated always as identity primary key,
  actor_id        uuid references public.profiles (id) on delete set null,
  relationship_id uuid references public.lending_relationships (id) on delete restrict,
  event_type      text not null,
  payload         jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now()
);

create index audit_events_relationship_id_idx on public.audit_events (relationship_id);
create index audit_events_actor_id_idx on public.audit_events (actor_id);

comment on table public.audit_events is 'Append-only audit trail. No client role can update or delete rows.';


-- -----------------------------------------------------------------------------
-- Table privileges: read-only for signed-in users, nothing for anonymous users.
-- Supabase grants broad defaults on new tables, so we reset them explicitly.
-- -----------------------------------------------------------------------------
revoke all on public.profiles, public.lender_invites, public.lending_relationships, public.audit_events
  from anon, authenticated;

grant select on public.profiles, public.lender_invites, public.lending_relationships, public.audit_events
  to authenticated;


-- -----------------------------------------------------------------------------
-- Helper: is the current user party to a relationship with `other_user`?
-- SECURITY DEFINER so it can be used inside RLS policies without recursion.
-- -----------------------------------------------------------------------------
create function private.shares_relationship_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lending_relationships r
    where (r.lender_id = (select auth.uid()) and r.borrower_id = other_user)
       or (r.borrower_id = (select auth.uid()) and r.lender_id = other_user)
  );
$$;

create function private.is_party_to(relationship uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lending_relationships r
    where r.id = relationship
      and (select auth.uid()) in (r.lender_id, r.borrower_id)
  );
$$;

-- RLS policies run as the querying user, so they need to call these helpers.
grant usage on schema private to authenticated;


-- -----------------------------------------------------------------------------
-- Row Level Security
-- `(select auth.uid())` is wrapped in a sub-select so Postgres evaluates it once
-- per query instead of once per row.
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.lender_invites enable row level security;
alter table public.lending_relationships enable row level security;
alter table public.audit_events enable row level security;

create policy "Users see themselves and people they lend to or borrow from"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_relationship_with(id));

create policy "Lenders see their own invites"
  on public.lender_invites for select to authenticated
  using (lender_id = (select auth.uid()));

create policy "Parties see their relationships"
  on public.lending_relationships for select to authenticated
  using ((select auth.uid()) in (lender_id, borrower_id));

create policy "Users see their own events and their relationships' events"
  on public.audit_events for select to authenticated
  using (
    actor_id = (select auth.uid())
    or (relationship_id is not null and private.is_party_to(relationship_id))
  );


-- -----------------------------------------------------------------------------
-- Internal: write an audit event
-- -----------------------------------------------------------------------------
create function private.log_event(
  p_event_type      text,
  p_relationship_id uuid default null,
  p_payload         jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (actor_id, relationship_id, event_type, payload)
  values ((select auth.uid()), p_relationship_id, p_event_type, p_payload);
$$;


-- -----------------------------------------------------------------------------
-- Internal: the signed-in user's id, or an error if nobody is signed in
-- -----------------------------------------------------------------------------
create function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;
  return v_user_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- Trigger: create a profile when someone signs up
-- -----------------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'New user'
      ),
      80
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();


-- =============================================================================
-- Public functions (callable from the app via supabase.rpc)
-- =============================================================================

-- Change your own display name.
create function public.set_display_name(p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  if char_length(v_name) not between 1 and 80 then
    raise exception 'invalid_display_name';
  end if;

  update public.profiles set display_name = v_name where id = v_user_id;
  perform private.log_event('profile_renamed', null, jsonb_build_object('display_name', v_name));
end;
$$;


-- Create a single-use invite link. Returns the raw token exactly once.
create function public.create_invite(p_note text default null)
returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_token text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_open_count int;
begin
  if not exists (select 1 from public.profiles p where p.id = v_user_id and p.can_lend) then
    raise exception 'lender_access_required';
  end if;

  if v_note is not null and char_length(v_note) > 80 then
    raise exception 'invalid_note';
  end if;

  -- Cap outstanding invites so a compromised account can't mint thousands of links.
  select count(*) into v_open_count
  from public.lender_invites i
  where i.lender_id = v_user_id
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now();

  if v_open_count >= 10 then
    raise exception 'too_many_open_invites';
  end if;

  -- 32 random bytes = 256 bits of entropy, hex-encoded for URL safety.
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.lender_invites (lender_id, token_hash, note, expires_at)
  values (
    v_user_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_note,
    now() + interval '7 days'
  )
  returning lender_invites.id, lender_invites.expires_at into invite_id, expires_at;

  token := v_token;
  perform private.log_event('invite_created', null, jsonb_build_object('invite_id', invite_id));
  return next;
end;
$$;


-- Look up an invite before accepting it, so the page can say who sent it.
-- Reveals only the lender's display name, and only to someone holding the token.
create function public.preview_invite(p_token text)
returns table (lender_name text, expires_at timestamptz, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_invite public.lender_invites;
begin
  select * into v_invite
  from public.lender_invites i
  where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');

  if not found then
    status := 'not_found';
    return next;
    return;
  end if;

  select p.display_name into lender_name from public.profiles p where p.id = v_invite.lender_id;
  expires_at := v_invite.expires_at;
  status := case
    when v_invite.revoked_at is not null then 'revoked'
    when v_invite.accepted_at is not null then 'used'
    when v_invite.expires_at <= now() then 'expired'
    when v_invite.lender_id = v_user_id then 'own_invite'
    else 'valid'
  end;
  return next;
end;
$$;


-- Accept an invite and become the lender's borrower.
create function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_invite public.lender_invites;
  v_relationship_id uuid;
begin
  -- FOR UPDATE locks the row, so two people opening the same link at the
  -- same moment can't both use it.
  select * into v_invite
  from public.lender_invites i
  where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  for update;

  if not found then
    raise exception 'invite_not_found';
  elsif v_invite.revoked_at is not null then
    raise exception 'invite_revoked';
  elsif v_invite.accepted_at is not null then
    raise exception 'invite_used';
  elsif v_invite.expires_at <= now() then
    raise exception 'invite_expired';
  elsif v_invite.lender_id = v_user_id then
    raise exception 'invite_own';
  end if;

  -- Re-inviting someone whose relationship was ended reopens the same record,
  -- keeping their history in one place.
  insert into public.lending_relationships (lender_id, borrower_id, invite_id)
  values (v_invite.lender_id, v_user_id, v_invite.id)
  on conflict on constraint lending_relationships_pair_unique
  do update set ended_at = null, invite_id = excluded.invite_id
  returning id into v_relationship_id;

  update public.lender_invites
  set accepted_by = v_user_id, accepted_at = now()
  where id = v_invite.id;

  perform private.log_event(
    'invite_accepted',
    v_relationship_id,
    jsonb_build_object('invite_id', v_invite.id)
  );
  return v_relationship_id;
end;
$$;


-- Cancel an invite that hasn't been used yet.
create function public.revoke_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_invite public.lender_invites;
begin
  select * into v_invite from public.lender_invites i where i.id = p_invite_id for update;

  -- Someone else's invite looks the same as a missing one, to avoid leaking ids.
  if not found or v_invite.lender_id <> v_user_id then
    raise exception 'invite_not_found';
  elsif v_invite.accepted_at is not null then
    raise exception 'invite_used';
  elsif v_invite.revoked_at is not null then
    return; -- already revoked: nothing to do
  end if;

  update public.lender_invites set revoked_at = now() where id = p_invite_id;
  perform private.log_event('invite_revoked', null, jsonb_build_object('invite_id', p_invite_id));
end;
$$;


-- End a lending relationship (AC-05). History is kept; only the link is closed.
create function public.end_relationship(p_relationship_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_relationship public.lending_relationships;
begin
  select * into v_relationship
  from public.lending_relationships r
  where r.id = p_relationship_id
  for update;

  if not found or v_relationship.lender_id <> v_user_id then
    raise exception 'relationship_not_found';
  elsif v_relationship.ended_at is not null then
    return;
  end if;

  -- TODO(M3): refuse while the borrower has an active loan in this relationship.

  update public.lending_relationships set ended_at = now() where id = p_relationship_id;
  perform private.log_event('relationship_ended', p_relationship_id);
end;
$$;


-- -----------------------------------------------------------------------------
-- Function privileges
-- Postgres lets everyone execute new functions by default, so lock it down.
-- -----------------------------------------------------------------------------

-- Internal helpers: only the two used inside RLS policies are callable by users.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.shares_relationship_with(uuid),
  private.is_party_to(uuid)
to authenticated;

-- Public API: signed-in users only.
revoke execute on function
  public.set_display_name(text),
  public.create_invite(text),
  public.preview_invite(text),
  public.accept_invite(text),
  public.revoke_invite(uuid),
  public.end_relationship(uuid)
from public, anon;

grant execute on function
  public.set_display_name(text),
  public.create_invite(text),
  public.preview_invite(text),
  public.accept_invite(text),
  public.revoke_invite(uuid),
  public.end_relationship(uuid)
to authenticated;
