-- =============================================================================
-- Households (ADR-0022)
--
-- People who live together share costs in different ways, so each household
-- sets itself up:
--   * an optional shared account (top-ups in, bills out, an estimated balance
--     that anyone can correct from their banking app);
--   * bills (rent, power, ...) that are fixed or change each time, and are paid
--     from the shared account, by one person (others owe them their share), by
--     everyone paying their own share directly, or covered by one person;
--   * a household tab: what members owe each other, cleared with Settle up.
--
-- Loans (everything else in Kinvo) are separate and unchanged.
-- Every change goes through a function; members can read their household's
-- rows and nothing else.
-- =============================================================================


-- =============================================================================
-- Tables
-- =============================================================================
create table public.households (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(name) between 1 and 60),
  has_shared_account  boolean not null default false,
  shared_account_name text check (shared_account_name is null or char_length(shared_account_name) <= 60),
  created_by          uuid not null references public.profiles (id) on delete cascade,
  created_at          timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  -- Default share of bills in basis points (5000 = 50%). Null for everyone = equal.
  share_bp     int check (share_bp is null or share_bp between 0 and 10000),
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

create table public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by   uuid not null references public.profiles (id) on delete cascade,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  accepted_by  uuid references public.profiles (id) on delete set null,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint household_invites_accepted check (accepted_by is null or accepted_at is not null)
);
create index household_invites_household_idx on public.household_invites (household_id);

-- Regular top-ups into the shared account, assumed to happen on schedule.
create table public.household_topups (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  member_id     uuid not null references public.profiles (id) on delete cascade,
  amount_cents  bigint not null check (amount_cents between 1 and 10000000),
  frequency     text not null check (frequency in ('weekly', 'fortnightly', 'monthly')),
  first_on      date not null,
  created_count int not null default 0,   -- index of the next one
  next_on       date,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index household_topups_household_idx on public.household_topups (household_id);

create table public.household_bills (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 60),
  category       text not null default 'bills'
                 check (category in ('rent', 'power', 'internet', 'water', 'phone', 'insurance', 'subscriptions', 'bills', 'other')),
  amount_type    text not null check (amount_type in ('fixed', 'varies')),
  -- The amount (fixed) or a rough guess (varies, used for the balance forecast).
  amount_cents   bigint check (amount_cents is null or amount_cents between 1 and 10000000),
  frequency      text not null check (frequency in ('weekly', 'fortnightly', 'monthly')),
  first_due_on   date not null,
  created_count  int not null default 0,  -- index of the next one
  next_due_on    date,
  method         text not null check (method in ('shared_account', 'one_person', 'each_own', 'covered')),
  payer_id       uuid references public.profiles (id) on delete set null,
  -- [{ "user_id": uuid, "share_bp": int }] summing to 10000, or null for the household default.
  split          jsonb,
  active         boolean not null default true,
  created_by     uuid not null references public.profiles (id) on delete cascade,
  created_at     timestamptz not null default now(),
  constraint household_bills_fixed_amount check (amount_type = 'varies' or amount_cents is not null),
  constraint household_bills_payer check (method not in ('one_person', 'covered') or payer_id is not null)
);
create index household_bills_household_idx on public.household_bills (household_id);

-- One bill, one due date.
create table public.household_bill_occurrences (
  id           uuid primary key default gen_random_uuid(),
  bill_id      uuid not null references public.household_bills (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  sequence     int not null,
  due_on       date not null,
  method       text not null,
  payer_id     uuid references public.profiles (id) on delete set null,
  amount_cents bigint check (amount_cents is null or amount_cents between 1 and 10000000),
  status       text not null check (status in ('needs_amount', 'open', 'done', 'skipped')),
  receipt_path text,
  entered_by   uuid references public.profiles (id) on delete set null,
  entered_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint household_bill_occurrences_once unique (bill_id, sequence)
);
create index household_bill_occurrences_household_idx on public.household_bill_occurrences (household_id, due_on);

-- Each person's part of one occurrence (for "everyone pays their own share").
create table public.household_bill_shares (
  occurrence_id uuid not null references public.household_bill_occurrences (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  amount_cents  bigint not null check (amount_cents >= 0),
  paid_at       timestamptz,
  primary key (occurrence_id, user_id)
);

-- Money in and out of the shared account. Balance = sum of entries that haven't been voided.
create table public.shared_account_entries (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  kind          text not null check (kind in ('opening', 'topup', 'bill', 'expense', 'withdrawal', 'adjustment')),
  amount_cents  bigint not null,   -- in is positive, out is negative
  member_id     uuid references public.profiles (id) on delete set null,
  topup_id      uuid references public.household_topups (id) on delete set null,
  occurrence_id uuid references public.household_bill_occurrences (id) on delete cascade,
  note          text check (note is null or char_length(note) <= 200),
  occurred_on   date not null,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  voided_at     timestamptz,
  voided_by     uuid references public.profiles (id) on delete set null
);
create index shared_account_entries_household_idx on public.shared_account_entries (household_id, occurred_on);

-- The household tab: owed_by owes owed_to this amount. Settling up is an entry the other way.
create table public.household_tab_entries (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  owed_to       uuid not null references public.profiles (id) on delete cascade,
  owed_by       uuid not null references public.profiles (id) on delete cascade,
  amount_cents  bigint not null check (amount_cents > 0),
  source        text not null check (source in ('bill', 'settle')),
  occurrence_id uuid references public.household_bill_occurrences (id) on delete cascade,
  note          text check (note is null or char_length(note) <= 200),
  receipt_path  text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  voided_at     timestamptz,
  constraint household_tab_entries_two_people check (owed_to <> owed_by)
);
create index household_tab_entries_household_idx on public.household_tab_entries (household_id);


-- =============================================================================
-- Access: members read their household; nothing is written directly
-- =============================================================================
create function private.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = (select auth.uid()) and m.left_at is null
  );
$$;

create function private.shares_household_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members a
    join public.household_members b on b.household_id = a.household_id
    where a.user_id = (select auth.uid()) and b.user_id = p_other and a.left_at is null and b.left_at is null
  );
$$;

do $$
declare
  t text;
begin
  foreach t in array array['households', 'household_members', 'household_invites', 'household_topups',
    'household_bills', 'household_bill_occurrences', 'household_bill_shares', 'shared_account_entries',
    'household_tab_entries']
  loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy "Members see their household" on public.households for select to authenticated
  using (private.is_household_member(id));
create policy "Members see each other" on public.household_members for select to authenticated
  using (private.is_household_member(household_id));
create policy "Members see invites" on public.household_invites for select to authenticated
  using (private.is_household_member(household_id));
create policy "Members see top-ups" on public.household_topups for select to authenticated
  using (private.is_household_member(household_id));
create policy "Members see bills" on public.household_bills for select to authenticated
  using (private.is_household_member(household_id));
create policy "Members see bill dates" on public.household_bill_occurrences for select to authenticated
  using (private.is_household_member(household_id));
create policy "Members see bill shares" on public.household_bill_shares for select to authenticated
  using (exists (select 1 from public.household_bill_occurrences o
                 where o.id = occurrence_id and private.is_household_member(o.household_id)));
create policy "Members see the shared account" on public.shared_account_entries for select to authenticated
  using (private.is_household_member(household_id));
create policy "Members see the tab" on public.household_tab_entries for select to authenticated
  using (private.is_household_member(household_id));

-- Household members can see each other's name and photo.
create policy "Household members see each other's profile" on public.profiles for select to authenticated
  using (private.shares_household_with(id));

create or replace function private.can_see_avatar(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner = (select auth.uid()) or private.shares_relationship_with(p_owner)
         or private.shares_household_with(p_owner);
$$;


-- =============================================================================
-- Receipts for household bills and settling up: <household id>/<file>.jpg
-- =============================================================================
create function private.household_receipt_id(p_path text)
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

-- Null stays null (receipts are optional here); otherwise it must be an uploaded file in this household's folder.
create function private.household_receipt(p_household_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
begin
  if p_path is null or btrim(p_path) = '' then
    return null;
  elsif private.household_receipt_id(p_path) is distinct from p_household_id then
    raise exception 'invalid_receipt';
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)'
      into v_exists using 'household-receipts', p_path;
    if not v_exists then
      raise exception 'receipt_not_uploaded';
    end if;
  end if;
  return p_path;
end;
$$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('household-receipts', 'household-receipts', false, 5242880, array['image/jpeg', 'image/webp'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute $p$
      create policy "Household members view receipts" on storage.objects for select to authenticated
      using (bucket_id = 'household-receipts' and private.is_household_member(private.household_receipt_id(name)))
    $p$;
    execute $p$
      create policy "Household members upload receipts" on storage.objects for insert to authenticated
      with check (bucket_id = 'household-receipts' and private.is_household_member(private.household_receipt_id(name)))
    $p$;
  end if;
end $$;


-- =============================================================================
-- Helpers
-- =============================================================================
create function private.require_household_member(p_household_id uuid, p_user_id uuid)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household public.households;
begin
  select h.* into v_household from public.households h
  join public.household_members m on m.household_id = h.id
  where h.id = p_household_id and m.user_id = p_user_id and m.left_at is null;
  if not found then
    raise exception 'household_not_found';
  end if;
  return v_household;
end;
$$;

create function private.is_active_member(p_household_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.household_members m
                 where m.household_id = p_household_id and m.user_id = p_user_id and m.left_at is null);
$$;

-- Shares as [{user_id, share_bp}] for a bill: its own split, else the household
-- default (if every member has one), else equal.
create function private.household_shares(p_household_id uuid, p_split jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n     int;
  v_total int;
begin
  if p_split is not null then
    return p_split;
  end if;
  select count(*), sum(share_bp) into v_n, v_total
  from public.household_members where household_id = p_household_id and left_at is null;
  if v_n = 0 then
    return '[]'::jsonb;
  end if;
  if v_total = 10000 and not exists (select 1 from public.household_members
       where household_id = p_household_id and left_at is null and share_bp is null) then
    return (select jsonb_agg(jsonb_build_object('user_id', user_id, 'share_bp', share_bp) order by joined_at)
            from public.household_members where household_id = p_household_id and left_at is null);
  end if;
  return (select jsonb_agg(jsonb_build_object('user_id', user_id,
            'share_bp', 10000 / v_n + case when rn = 1 then 10000 % v_n else 0 end) order by rn)
          from (select user_id, row_number() over (order by joined_at) as rn
                from public.household_members where household_id = p_household_id and left_at is null) x);
end;
$$;

-- Splits an amount by shares, in whole cents; the first share takes any leftover.
create function private.split_cents(p_amount bigint, p_shares jsonb)
returns table (user_id uuid, cents bigint)
language sql
immutable
set search_path = ''
as $$
  with s as (
    select (e ->> 'user_id')::uuid as user_id, (e ->> 'share_bp')::bigint as bp, ord
    from jsonb_array_elements(p_shares) with ordinality as t(e, ord)
  ), f as (
    select user_id, ord, (p_amount * bp) / 10000 as base from s
  )
  select user_id,
         base + case when ord = 1 then p_amount - (select sum(base) from f) else 0 end
  from f order by ord;
$$;

create function private.validate_split(p_household_id uuid, p_split jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_sum  int := 0;
  v_seen uuid[] := '{}';
  v_user uuid;
  v_bp   int;
begin
  if p_split is null then
    return;
  elsif jsonb_typeof(p_split) <> 'array' or jsonb_array_length(p_split) < 1 then
    raise exception 'invalid_split';
  end if;
  for v_item in select value from jsonb_array_elements(p_split) loop
    begin
      v_user := (v_item ->> 'user_id')::uuid;
      v_bp := (v_item ->> 'share_bp')::int;
    exception when others then
      raise exception 'invalid_split';
    end;
    if v_user is null or v_bp is null or v_bp < 0 or v_user = any(v_seen)
       or not private.is_active_member(p_household_id, v_user) then
      raise exception 'invalid_split';
    end if;
    v_seen := v_seen || v_user;
    v_sum := v_sum + v_bp;
  end loop;
  if v_sum <> 10000 then
    raise exception 'split_must_total_100';
  end if;
end;
$$;


-- =============================================================================
-- Households, members and invites
-- =============================================================================
create function public.create_household(
  p_name                 text,
  p_has_shared_account   boolean default false,
  p_shared_account_name  text default null,
  p_opening_balance_cents bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_id      uuid;
begin
  if v_name is null or char_length(v_name) > 60 then
    raise exception 'invalid_household_name';
  elsif (select count(*) from public.household_members where user_id = v_user_id and left_at is null) >= 10 then
    raise exception 'too_many_households';
  end if;

  insert into public.households (name, has_shared_account, shared_account_name, created_by)
  values (v_name, coalesce(p_has_shared_account, false),
          case when p_has_shared_account then nullif(btrim(coalesce(p_shared_account_name, '')), '') end, v_user_id)
  returning id into v_id;
  insert into public.household_members (household_id, user_id, role) values (v_id, v_user_id, 'owner');

  if p_has_shared_account and p_opening_balance_cents is not null then
    insert into public.shared_account_entries (household_id, kind, amount_cents, occurred_on, created_by, note)
    values (v_id, 'opening', p_opening_balance_cents, private.nz_today(), v_user_id, 'Starting balance');
  end if;
  return v_id;
end;
$$;

create function public.update_household(
  p_household_id uuid, p_name text, p_has_shared_account boolean, p_shared_account_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
begin
  perform private.require_household_member(p_household_id, v_user_id);
  if v_name is null or char_length(v_name) > 60 then
    raise exception 'invalid_household_name';
  end if;
  update public.households
  set name = v_name, has_shared_account = coalesce(p_has_shared_account, false),
      shared_account_name = case when p_has_shared_account then nullif(btrim(coalesce(p_shared_account_name, '')), '') end
  where id = p_household_id;
end;
$$;

create function public.create_household_invite(p_household_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_token   text;
begin
  perform private.require_household_member(p_household_id, v_user_id);
  if (select count(*) from public.household_invites
      where household_id = p_household_id and accepted_at is null and revoked_at is null and expires_at > now()) >= 10 then
    raise exception 'too_many_open_invites';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.household_invites (household_id, created_by, token_hash, expires_at)
  values (p_household_id, v_user_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '7 days');
  return v_token;
end;
$$;

create function public.preview_household_invite(p_token text)
returns table (status text, household_name text, invited_by text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_invite  public.household_invites;
begin
  select * into v_invite from public.household_invites
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then
    return query select 'not_found'::text, null::text, null::text;
    return;
  end if;
  return query
  select case
           when v_invite.revoked_at is not null then 'revoked'
           when private.is_active_member(v_invite.household_id, v_user_id) then 'already_member'
           when v_invite.accepted_at is not null then 'used'
           when v_invite.expires_at <= now() then 'expired'
           else 'valid' end,
         h.name, p.display_name
  from public.households h join public.profiles p on p.id = v_invite.created_by
  where h.id = v_invite.household_id;
end;
$$;

create function public.accept_household_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_invite  public.household_invites;
  v_name    text;
begin
  select * into v_invite from public.household_invites
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  for update;
  if not found then
    raise exception 'invite_not_found';
  elsif private.is_active_member(v_invite.household_id, v_user_id) then
    return v_invite.household_id;
  elsif v_invite.revoked_at is not null then
    raise exception 'invite_revoked';
  elsif v_invite.accepted_at is not null then
    raise exception 'invite_used';
  elsif v_invite.expires_at <= now() then
    raise exception 'invite_expired';
  end if;

  insert into public.household_members (household_id, user_id)
  values (v_invite.household_id, v_user_id)
  on conflict (household_id, user_id) do update set left_at = null, joined_at = now();
  update public.household_invites set accepted_by = v_user_id, accepted_at = now() where id = v_invite.id;

  select display_name into v_name from public.profiles where id = v_user_id;
  perform private.notify_link(m.user_id, 'household_joined',
      format('%s joined %s', v_name, h.name), '', 'household_joined:' || v_invite.id || ':' || m.user_id,
      '/households/' || h.id)
  from public.household_members m join public.households h on h.id = m.household_id
  where m.household_id = v_invite.household_id and m.user_id <> v_user_id and m.left_at is null;
  return v_invite.household_id;
end;
$$;

create function public.leave_household(p_household_id uuid, p_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_target  uuid := coalesce(p_user_id, v_user_id);
begin
  perform private.require_household_member(p_household_id, v_user_id);
  if v_target <> v_user_id and not exists (select 1 from public.household_members
      where household_id = p_household_id and user_id = v_user_id and role = 'owner') then
    raise exception 'owner_only';
  end if;
  update public.household_members set left_at = now(), role = 'member'
  where household_id = p_household_id and user_id = v_target and left_at is null;
  -- Keep someone in charge.
  if not exists (select 1 from public.household_members
                 where household_id = p_household_id and role = 'owner' and left_at is null) then
    update public.household_members set role = 'owner'
    where (household_id, user_id) = (select household_id, user_id from public.household_members
      where household_id = p_household_id and left_at is null order by joined_at limit 1);
  end if;
  -- Their regular top-ups stop.
  update public.household_topups set active = false, next_on = null
  where household_id = p_household_id and member_id = v_target;
end;
$$;

-- The household's default split, in percent basis points ([] or null = equal).
create function public.set_household_shares(p_household_id uuid, p_shares jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
begin
  perform private.require_household_member(p_household_id, v_user_id);
  if p_shares is null or jsonb_array_length(p_shares) = 0 then
    update public.household_members set share_bp = null where household_id = p_household_id;
    return;
  end if;
  perform private.validate_split(p_household_id, p_shares);
  if (select count(*) from jsonb_array_elements(p_shares))
     <> (select count(*) from public.household_members where household_id = p_household_id and left_at is null) then
    raise exception 'invalid_split';
  end if;
  update public.household_members m set share_bp = (s ->> 'share_bp')::int
  from jsonb_array_elements(p_shares) s
  where m.household_id = p_household_id and m.user_id = (s ->> 'user_id')::uuid;
end;
$$;


-- =============================================================================
-- Shared account
-- =============================================================================
create function private.require_shared_account(p_household_id uuid, p_user_id uuid)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household public.households := private.require_household_member(p_household_id, p_user_id);
begin
  if not v_household.has_shared_account then
    raise exception 'no_shared_account';
  end if;
  return v_household;
end;
$$;

create function private.shared_balance(p_household_id uuid, p_on date)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount_cents), 0)::bigint from public.shared_account_entries
  where household_id = p_household_id and voided_at is null and occurred_on <= p_on;
$$;

-- "Check balance": record what the banking app says; the difference becomes an adjustment.
create function public.check_shared_balance(p_household_id uuid, p_actual_cents bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_diff    bigint;
begin
  perform private.require_shared_account(p_household_id, v_user_id);
  if p_actual_cents is null or abs(p_actual_cents) > 100000000 then
    raise exception 'invalid_amount';
  end if;
  v_diff := p_actual_cents - private.shared_balance(p_household_id, private.nz_today());
  if v_diff <> 0 then
    insert into public.shared_account_entries (household_id, kind, amount_cents, occurred_on, created_by, note)
    values (p_household_id, 'adjustment', v_diff, private.nz_today(), v_user_id, 'Balance checked');
  end if;
end;
$$;

-- A one-off top-up by you, or money taken out.
create function public.add_shared_entry(
  p_household_id uuid, p_kind text, p_amount_cents bigint, p_on date default null, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_id      uuid;
begin
  perform private.require_shared_account(p_household_id, v_user_id);
  if p_kind not in ('topup', 'withdrawal') then
    raise exception 'invalid_setting';
  elsif p_amount_cents is null or p_amount_cents not between 1 and 10000000 then
    raise exception 'invalid_amount';
  elsif coalesce(p_on, private.nz_today()) > private.nz_today() then
    raise exception 'invalid_received_date';
  elsif char_length(coalesce(p_note, '')) > 200 then
    raise exception 'invalid_notes';
  end if;
  insert into public.shared_account_entries (household_id, kind, amount_cents, member_id, occurred_on, created_by, note)
  values (p_household_id, p_kind, case when p_kind = 'topup' then p_amount_cents else -p_amount_cents end,
          case when p_kind = 'topup' then v_user_id end, coalesce(p_on, private.nz_today()), v_user_id,
          nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- "Missed": a top-up that didn't go in. Only the person it was from, or whoever added it.
create function public.void_shared_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_entry   public.shared_account_entries;
begin
  select * into v_entry from public.shared_account_entries where id = p_entry_id for update;
  if not found or not private.is_active_member(v_entry.household_id, v_user_id) then
    raise exception 'entry_not_found';
  elsif v_entry.voided_at is not null then
    raise exception 'entry_not_found';
  elsif v_entry.kind not in ('topup', 'withdrawal')
     or v_user_id not in (coalesce(v_entry.member_id, v_entry.created_by), coalesce(v_entry.created_by, v_entry.member_id)) then
    raise exception 'cannot_undo_entry';
  end if;
  update public.shared_account_entries set voided_at = now(), voided_by = v_user_id where id = p_entry_id;
end;
$$;

create function public.create_topup(p_household_id uuid, p_amount_cents bigint, p_frequency text, p_first_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_id      uuid;
  v_n       int;
begin
  perform private.require_shared_account(p_household_id, v_user_id);
  if p_amount_cents is null or p_amount_cents not between 1 and 10000000 then
    raise exception 'invalid_amount';
  elsif p_frequency not in ('weekly', 'fortnightly', 'monthly') or p_first_on is null then
    raise exception 'invalid_setting';
  end if;
  -- Top-ups already made before today aren't added; check the balance for those.
  v_n := private.series_index_from(p_first_on, p_frequency, private.nz_today());
  insert into public.household_topups (household_id, member_id, amount_cents, frequency, first_on, created_count, next_on)
  values (p_household_id, v_user_id, p_amount_cents, p_frequency, p_first_on, v_n,
          private.series_date(p_first_on, p_frequency, v_n))
  returning id into v_id;
  perform private.run_household_jobs();
  return v_id;
end;
$$;

create function public.stop_topup(p_topup_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
begin
  update public.household_topups set active = false, next_on = null
  where id = p_topup_id and member_id = v_user_id and active;
  if not found then
    raise exception 'topup_not_found';
  end if;
end;
$$;


-- =============================================================================
-- Bills
-- =============================================================================
create function private.validate_bill(
  p_household_id uuid, p_name text, p_category text, p_amount_type text, p_amount_cents bigint,
  p_method text, p_payer_id uuid, p_split jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household public.households;
begin
  select * into v_household from public.households where id = p_household_id;
  if nullif(btrim(coalesce(p_name, '')), '') is null or char_length(p_name) > 60 then
    raise exception 'invalid_bill_name';
  elsif p_category not in ('rent', 'power', 'internet', 'water', 'phone', 'insurance', 'subscriptions', 'bills', 'other') then
    raise exception 'invalid_setting';
  elsif p_amount_type not in ('fixed', 'varies') then
    raise exception 'invalid_setting';
  elsif (p_amount_type = 'fixed' and p_amount_cents is null)
     or (p_amount_cents is not null and p_amount_cents not between 1 and 10000000) then
    raise exception 'invalid_amount';
  elsif p_method not in ('shared_account', 'one_person', 'each_own', 'covered') then
    raise exception 'invalid_setting';
  elsif p_method = 'shared_account' and not v_household.has_shared_account then
    raise exception 'no_shared_account';
  elsif p_method in ('one_person', 'covered')
     and (p_payer_id is null or not private.is_active_member(p_household_id, p_payer_id)) then
    raise exception 'invalid_payer';
  end if;
  perform private.validate_split(p_household_id, p_split);
end;
$$;

create function public.create_bill(
  p_household_id uuid,
  p_name         text,
  p_category     text,
  p_amount_type  text,
  p_amount_cents bigint,
  p_frequency    text,
  p_first_due_on date,
  p_method       text,
  p_payer_id     uuid default null,
  p_split        jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_id      uuid;
  v_n       int;
begin
  perform private.require_household_member(p_household_id, v_user_id);
  perform private.validate_bill(p_household_id, p_name, p_category, p_amount_type, p_amount_cents,
    p_method, p_payer_id, p_split);
  if p_frequency not in ('weekly', 'fortnightly', 'monthly') or p_first_due_on is null then
    raise exception 'invalid_setting';
  elsif (select count(*) from public.household_bills where household_id = p_household_id and active) >= 40 then
    raise exception 'too_many_bills';
  end if;

  -- Start from the next due date that hasn't passed.
  v_n := private.series_index_from(p_first_due_on, p_frequency, private.nz_today());
  insert into public.household_bills (
    household_id, name, category, amount_type, amount_cents, frequency, first_due_on, created_count, next_due_on,
    method, payer_id, split, created_by
  )
  values (
    p_household_id, btrim(p_name), p_category, p_amount_type, p_amount_cents, p_frequency, p_first_due_on, v_n,
    private.series_date(p_first_due_on, p_frequency, v_n),
    p_method, case when p_method in ('one_person', 'covered') then p_payer_id end, p_split, v_user_id
  )
  returning id into v_id;
  perform private.run_household_jobs();
  return v_id;
end;
$$;

-- Changes apply to bills not yet created; ones already on the list stay as they were.
create function public.change_bill(
  p_bill_id      uuid,
  p_name         text,
  p_category     text,
  p_amount_type  text,
  p_amount_cents bigint,
  p_method       text,
  p_payer_id     uuid default null,
  p_split        jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_bill    public.household_bills;
begin
  select * into v_bill from public.household_bills where id = p_bill_id for update;
  if not found or not private.is_active_member(v_bill.household_id, v_user_id) then
    raise exception 'bill_not_found';
  end if;
  perform private.validate_bill(v_bill.household_id, p_name, p_category, p_amount_type, p_amount_cents,
    p_method, p_payer_id, p_split);
  update public.household_bills
  set name = btrim(p_name), category = p_category, amount_type = p_amount_type, amount_cents = p_amount_cents,
      method = p_method, payer_id = case when p_method in ('one_person', 'covered') then p_payer_id end, split = p_split
  where id = p_bill_id;
end;
$$;

create function public.stop_bill(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_bill    public.household_bills;
begin
  select * into v_bill from public.household_bills where id = p_bill_id for update;
  if not found or not private.is_active_member(v_bill.household_id, v_user_id) then
    raise exception 'bill_not_found';
  end if;
  update public.household_bills set active = false, next_due_on = null where id = p_bill_id;
  -- Upcoming ones that haven't happened yet go too.
  update public.household_bill_occurrences set status = 'skipped'
  where bill_id = p_bill_id and status in ('needs_amount', 'open') and due_on > private.nz_today();
  update public.shared_account_entries e set voided_at = now(), voided_by = v_user_id
  from public.household_bill_occurrences o
  where e.occurrence_id = o.id and o.bill_id = p_bill_id and o.status = 'skipped' and e.voided_at is null;
  update public.household_tab_entries t set voided_at = now()
  from public.household_bill_occurrences o
  where t.occurrence_id = o.id and o.bill_id = p_bill_id and o.status = 'skipped' and t.voided_at is null;
end;
$$;

-- What a bill does once its amount is known.
create function private.apply_occurrence(p_occurrence_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o       public.household_bill_occurrences;
  b       public.household_bills;
  v_share record;
begin
  select * into o from public.household_bill_occurrences where id = p_occurrence_id;
  select * into b from public.household_bills where id = o.bill_id;

  if o.method = 'shared_account' then
    insert into public.shared_account_entries (household_id, kind, amount_cents, occurrence_id, occurred_on, note)
    values (o.household_id, 'bill', -o.amount_cents, o.id, o.due_on, b.name);
  elsif o.method = 'one_person' then
    for v_share in select * from private.split_cents(o.amount_cents, private.household_shares(o.household_id, b.split)) loop
      if v_share.user_id <> o.payer_id and v_share.cents > 0 then
        insert into public.household_tab_entries (household_id, owed_to, owed_by, amount_cents, source, occurrence_id, note, receipt_path)
        values (o.household_id, o.payer_id, v_share.user_id, v_share.cents, 'bill', o.id, b.name, o.receipt_path);
      end if;
    end loop;
  elsif o.method = 'each_own' then
    insert into public.household_bill_shares (occurrence_id, user_id, amount_cents)
    select o.id, s.user_id, s.cents from private.split_cents(o.amount_cents, private.household_shares(o.household_id, b.split)) s
    on conflict do nothing;
  end if;
  -- 'covered': just recorded.
  update public.household_bill_occurrences set status = 'open' where id = o.id and status = 'needs_amount';
end;
$$;

-- Enter (or correct) the amount of a bill that changes each time.
create function public.enter_bill_amount(p_occurrence_id uuid, p_amount_cents bigint, p_receipt_path text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  o         public.household_bill_occurrences;
begin
  select * into o from public.household_bill_occurrences where id = p_occurrence_id for update;
  if not found or not private.is_active_member(o.household_id, v_user_id) then
    raise exception 'bill_not_found';
  elsif o.status = 'skipped' then
    raise exception 'bill_skipped';
  elsif p_amount_cents is null or p_amount_cents not between 1 and 10000000 then
    raise exception 'invalid_amount';
  elsif exists (select 1 from public.household_bill_shares where occurrence_id = o.id and paid_at is not null) then
    raise exception 'bill_already_paid';
  end if;

  -- Correcting: undo what the old amount did.
  update public.shared_account_entries set voided_at = now(), voided_by = v_user_id
  where occurrence_id = o.id and voided_at is null;
  update public.household_tab_entries set voided_at = now() where occurrence_id = o.id and voided_at is null;
  delete from public.household_bill_shares where occurrence_id = o.id;

  update public.household_bill_occurrences
  set amount_cents = p_amount_cents, entered_by = v_user_id, entered_at = now(),
      receipt_path = coalesce(private.household_receipt(o.household_id, p_receipt_path), receipt_path),
      status = case when status = 'done' then 'done' else 'needs_amount' end
  where id = o.id;
  perform private.apply_occurrence(o.id);
  update public.household_bill_occurrences set status = 'done'
  where id = o.id and due_on <= private.nz_today() and method <> 'each_own';
end;
$$;

-- "Everyone pays their own share": tick off your part.
create function public.pay_own_share(p_occurrence_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
begin
  update public.household_bill_shares set paid_at = now()
  where occurrence_id = p_occurrence_id and user_id = v_user_id and paid_at is null;
  if not found then
    raise exception 'share_not_found';
  end if;
  update public.household_bill_occurrences set status = 'done'
  where id = p_occurrence_id
    and not exists (select 1 from public.household_bill_shares where occurrence_id = p_occurrence_id and paid_at is null);
end;
$$;

-- Skip one date (e.g. a rent-free week), undoing anything it added.
create function public.skip_bill_occurrence(p_occurrence_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  o         public.household_bill_occurrences;
begin
  select * into o from public.household_bill_occurrences where id = p_occurrence_id for update;
  if not found or not private.is_active_member(o.household_id, v_user_id) then
    raise exception 'bill_not_found';
  end if;
  update public.household_bill_occurrences set status = 'skipped' where id = o.id;
  update public.shared_account_entries set voided_at = now(), voided_by = v_user_id
  where occurrence_id = o.id and voided_at is null;
  update public.household_tab_entries set voided_at = now() where occurrence_id = o.id and voided_at is null;
end;
$$;

-- "This time it was paid differently": e.g. you covered the rent from your own account.
create function public.change_occurrence_payment(p_occurrence_id uuid, p_method text, p_payer_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  o         public.household_bill_occurrences;
  h         public.households;
begin
  select * into o from public.household_bill_occurrences where id = p_occurrence_id for update;
  if not found or not private.is_active_member(o.household_id, v_user_id) then
    raise exception 'bill_not_found';
  elsif o.status = 'skipped' then
    raise exception 'bill_skipped';
  end if;
  select * into h from public.households where id = o.household_id;
  if p_method not in ('shared_account', 'one_person', 'each_own', 'covered') then
    raise exception 'invalid_setting';
  elsif p_method = 'shared_account' and not h.has_shared_account then
    raise exception 'no_shared_account';
  elsif p_method in ('one_person', 'covered')
     and (p_payer_id is null or not private.is_active_member(o.household_id, p_payer_id)) then
    raise exception 'invalid_payer';
  end if;

  update public.shared_account_entries set voided_at = now(), voided_by = v_user_id
  where occurrence_id = o.id and voided_at is null;
  update public.household_tab_entries set voided_at = now() where occurrence_id = o.id and voided_at is null;
  delete from public.household_bill_shares where occurrence_id = o.id;
  update public.household_bill_occurrences
  set method = p_method, payer_id = case when p_method in ('one_person', 'covered') then p_payer_id end,
      status = case when amount_cents is null then 'needs_amount' else 'needs_amount' end
  where id = o.id;
  if o.amount_cents is not null then
    perform private.apply_occurrence(o.id);
    update public.household_bill_occurrences set status = 'done'
    where id = o.id and due_on <= private.nz_today() and method <> 'each_own';
  end if;
end;
$$;


-- =============================================================================
-- Settling up
-- =============================================================================
-- You paid p_to_user: what you owe them goes down by that much.
create function public.settle_up(
  p_household_id uuid, p_to_user uuid, p_amount_cents bigint, p_note text default null, p_receipt_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_id      uuid;
  v_name    text;
begin
  perform private.require_household_member(p_household_id, v_user_id);
  if p_to_user = v_user_id or not private.is_active_member(p_household_id, p_to_user) then
    raise exception 'invalid_payer';
  elsif p_amount_cents is null or p_amount_cents not between 1 and 10000000 then
    raise exception 'invalid_amount';
  elsif char_length(coalesce(p_note, '')) > 200 then
    raise exception 'invalid_notes';
  end if;
  insert into public.household_tab_entries (household_id, owed_to, owed_by, amount_cents, source, note, receipt_path, created_by)
  values (p_household_id, v_user_id, p_to_user, p_amount_cents, 'settle', nullif(btrim(coalesce(p_note, '')), ''),
          private.household_receipt(p_household_id, p_receipt_path), v_user_id)
  returning id into v_id;

  select display_name into v_name from public.profiles where id = v_user_id;
  perform private.notify_link(p_to_user, 'household_settled',
    format('%s paid you %s', v_name, private.money(p_amount_cents)),
    (select format('Settled up in %s.', name) from public.households where id = p_household_id),
    'household_settled:' || v_id, '/households/' || p_household_id);
  return v_id;
end;
$$;

-- Undo a settle-up you recorded by mistake.
create function public.void_settlement(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
begin
  update public.household_tab_entries set voided_at = now()
  where id = p_entry_id and source = 'settle' and created_by = v_user_id and voided_at is null;
  if not found then
    raise exception 'entry_not_found';
  end if;
end;
$$;


-- =============================================================================
-- The hourly job: top-ups, upcoming bills, nudges and short-balance warnings
-- =============================================================================
create function private.run_household_jobs(p_today date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, private.nz_today());
  t       record;
  b       record;
  o       record;
  v_occ   uuid;
  v_n     int;
  v_bal   bigint;
begin
  -- Top-ups due by today, assumed to have gone in.
  for t in
    select * from public.household_topups where active and next_on is not null and next_on <= v_today
    for update skip locked
  loop
    v_n := t.created_count;
    while private.series_date(t.first_on, t.frequency, v_n) <= v_today loop
      insert into public.shared_account_entries (household_id, kind, amount_cents, member_id, topup_id, occurred_on)
      values (t.household_id, 'topup', t.amount_cents, t.member_id, t.id, private.series_date(t.first_on, t.frequency, v_n));
      v_n := v_n + 1;
    end loop;
    update public.household_topups set created_count = v_n, next_on = private.series_date(first_on, frequency, v_n)
    where id = t.id;
  end loop;

  -- Bills due within the next week are added, so changing amounts can be entered in time.
  for b in
    select * from public.household_bills where active and next_due_on is not null and next_due_on <= v_today + 7
    for update skip locked
  loop
    v_n := b.created_count;
    while private.series_date(b.first_due_on, b.frequency, v_n) <= v_today + 7 loop
      insert into public.household_bill_occurrences (
        bill_id, household_id, sequence, due_on, method, payer_id, amount_cents, status
      )
      values (
        b.id, b.household_id, v_n, private.series_date(b.first_due_on, b.frequency, v_n), b.method, b.payer_id,
        case when b.amount_type = 'fixed' then b.amount_cents end, 'needs_amount'
      )
      on conflict (bill_id, sequence) do nothing
      returning id into v_occ;
      if v_occ is not null and b.amount_type = 'fixed' then
        perform private.apply_occurrence(v_occ);
      end if;
      v_n := v_n + 1;
    end loop;
    update public.household_bills set created_count = v_n, next_due_on = private.series_date(first_due_on, frequency, v_n)
    where id = b.id;
  end loop;

  -- Past their date: done (except "each pays their own", which waits for everyone).
  update public.household_bill_occurrences set status = 'done'
  where status = 'open' and due_on <= v_today and method <> 'each_own';

  -- Ask for changing amounts from 3 days before. Shared-account bills ask everyone; others ask the payer.
  for o in
    select oc.*, bl.name as bill_name, h.name as household_name
    from public.household_bill_occurrences oc
    join public.household_bills bl on bl.id = oc.bill_id
    join public.households h on h.id = oc.household_id
    where oc.status = 'needs_amount' and oc.due_on <= v_today + 3
  loop
    perform private.notify_link(m.user_id, 'household_bill_amount',
      format('%s due %s: what was it?', o.bill_name, private.short_date(o.due_on)),
      'Enter the amount so everyone''s share is right.',
      'household_bill_amount:' || o.id || ':' || m.user_id, '/households/' || o.household_id || '/bills/due/' || o.id)
    from public.household_members m
    where m.household_id = o.household_id and m.left_at is null
      and (o.method in ('shared_account', 'each_own') or m.user_id = o.payer_id);
  end loop;

  -- "Each pays their own": remind on the day.
  for o in
    select oc.*, bl.name as bill_name, s.user_id, s.amount_cents as share_cents
    from public.household_bill_occurrences oc
    join public.household_bills bl on bl.id = oc.bill_id
    join public.household_bill_shares s on s.occurrence_id = oc.id
    where oc.status = 'open' and oc.method = 'each_own' and oc.due_on <= v_today and s.paid_at is null
  loop
    perform private.notify_link(o.user_id, 'household_share_due',
      format('Your %s share of %s is due', private.money(o.share_cents), o.bill_name),
      'Tick it off in Kinvo once you''ve paid.',
      'household_share_due:' || o.id || ':' || o.user_id, '/households/' || o.household_id);
  end loop;

  -- Shared account might not cover a bill in the next 3 days.
  for o in
    select oc.*, bl.name as bill_name, h.shared_account_name
    from public.household_bill_occurrences oc
    join public.household_bills bl on bl.id = oc.bill_id
    join public.households h on h.id = oc.household_id
    where oc.method = 'shared_account' and oc.status = 'open' and oc.due_on between v_today and v_today + 3
      and h.has_shared_account
  loop
    v_bal := private.shared_balance(o.household_id, o.due_on);
    if v_bal < 0 then
      perform private.notify_link(m.user_id, 'shared_account_short',
        format('%s may be %s short for %s', coalesce(o.shared_account_name, 'The shared account'),
          private.money(-v_bal), o.bill_name),
        format('It''s due %s. Top it up, or check the balance in Kinvo.', private.short_date(o.due_on)),
        'shared_account_short:' || o.id || ':' || m.user_id, '/households/' || o.household_id)
      from public.household_members m where m.household_id = o.household_id and m.left_at is null;
    end if;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('kinvo-households', '3 * * * *', 'select private.run_household_jobs()');
  end if;
end $$;


-- =============================================================================
-- Privileges
-- =============================================================================
revoke all on function
  private.is_household_member(uuid), private.shares_household_with(uuid), private.household_receipt_id(text),
  private.household_receipt(uuid, text), private.require_household_member(uuid, uuid),
  private.is_active_member(uuid, uuid), private.household_shares(uuid, jsonb), private.split_cents(bigint, jsonb),
  private.validate_split(uuid, jsonb), private.require_shared_account(uuid, uuid), private.shared_balance(uuid, date),
  private.validate_bill(uuid, text, text, text, bigint, text, uuid, jsonb), private.apply_occurrence(uuid),
  private.run_household_jobs(date)
from public, anon, authenticated;
-- RLS policies need these two.
grant execute on function private.is_household_member(uuid), private.shares_household_with(uuid),
  private.household_receipt_id(text) to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'create_household(text, boolean, text, bigint)', 'update_household(uuid, text, boolean, text)',
    'create_household_invite(uuid)', 'preview_household_invite(text)', 'accept_household_invite(text)',
    'leave_household(uuid, uuid)', 'set_household_shares(uuid, jsonb)', 'check_shared_balance(uuid, bigint)',
    'add_shared_entry(uuid, text, bigint, date, text)', 'void_shared_entry(uuid)',
    'create_topup(uuid, bigint, text, date)', 'stop_topup(uuid)',
    'create_bill(uuid, text, text, text, bigint, text, date, text, uuid, jsonb)',
    'change_bill(uuid, text, text, text, bigint, text, uuid, jsonb)', 'stop_bill(uuid)',
    'enter_bill_amount(uuid, bigint, text)', 'pay_own_share(uuid)', 'skip_bill_occurrence(uuid)',
    'change_occurrence_payment(uuid, text, uuid)', 'settle_up(uuid, uuid, bigint, text, text)', 'void_settlement(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
