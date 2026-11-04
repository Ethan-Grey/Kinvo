-- =============================================================================
-- My money (ADR-0024): your own bills and "safe to spend until pay day".
--
-- Private to you: nobody else can read these rows, not even household members.
-- Kinvo doesn't connect to your bank. You tell it your pay and what's in your
-- account now, and it works out what's left after everything due before your
-- next pay: your own bills, your shared-account top-ups, and loan payments.
-- =============================================================================

create table public.personal_bills (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  category     text not null default 'bills'
               check (category in ('rent', 'power', 'internet', 'water', 'phone', 'insurance', 'subscriptions',
                                   'car', 'health', 'savings', 'bills', 'other')),
  amount_type  text not null check (amount_type in ('fixed', 'varies')),
  -- The amount, or a rough guess when it changes each time.
  amount_cents bigint not null check (amount_cents between 1 and 10000000),
  frequency    text not null check (frequency in ('weekly', 'fortnightly', 'monthly', 'yearly')),
  first_due_on date not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index personal_bills_user_idx on public.personal_bills (user_id);

create table public.my_money (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  pay_amount_cents  bigint check (pay_amount_cents is null or pay_amount_cents between 1 and 100000000),
  pay_frequency     text check (pay_frequency is null or pay_frequency in ('weekly', 'fortnightly', 'monthly')),
  next_pay_on       date,
  balance_cents     bigint check (balance_cents is null or abs(balance_cents) <= 100000000),
  balance_on        date,
  updated_at        timestamptz not null default now()
);

revoke all on public.personal_bills, public.my_money from anon, authenticated;
grant select on public.personal_bills, public.my_money to authenticated;
alter table public.personal_bills enable row level security;
alter table public.my_money enable row level security;
create policy "Only you see your bills" on public.personal_bills for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Only you see your money" on public.my_money for select to authenticated
  using (user_id = (select auth.uid()));

-- Add a bill (p_id null) or change one.
create function public.save_personal_bill(
  p_id           uuid,
  p_name         text,
  p_category     text,
  p_amount_type  text,
  p_amount_cents bigint,
  p_frequency    text,
  p_first_due_on date
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
    raise exception 'invalid_bill_name';
  elsif p_category not in ('rent', 'power', 'internet', 'water', 'phone', 'insurance', 'subscriptions',
                           'car', 'health', 'savings', 'bills', 'other')
     or p_amount_type not in ('fixed', 'varies')
     or p_frequency not in ('weekly', 'fortnightly', 'monthly', 'yearly')
     or p_first_due_on is null then
    raise exception 'invalid_setting';
  elsif p_amount_cents is null or p_amount_cents not between 1 and 10000000 then
    raise exception 'invalid_amount';
  elsif p_id is null and (select count(*) from public.personal_bills where user_id = v_user_id and active) >= 60 then
    raise exception 'too_many_bills';
  end if;

  if p_id is null then
    insert into public.personal_bills (user_id, name, category, amount_type, amount_cents, frequency, first_due_on)
    values (v_user_id, v_name, p_category, p_amount_type, p_amount_cents, p_frequency, p_first_due_on)
    returning id into v_id;
  else
    update public.personal_bills
    set name = v_name, category = p_category, amount_type = p_amount_type, amount_cents = p_amount_cents,
        frequency = p_frequency, first_due_on = p_first_due_on
    where id = p_id and user_id = v_user_id and active
    returning id into v_id;
    if v_id is null then
      raise exception 'bill_not_found';
    end if;
  end if;
  return v_id;
end;
$$;

create function public.stop_personal_bill(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
begin
  update public.personal_bills set active = false where id = p_id and user_id = v_user_id and active;
  if not found then
    raise exception 'bill_not_found';
  end if;
end;
$$;

create function public.save_pay(p_amount_cents bigint, p_frequency text, p_next_pay_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
begin
  if p_amount_cents is null or p_amount_cents not between 1 and 100000000 then
    raise exception 'invalid_amount';
  elsif p_frequency not in ('weekly', 'fortnightly', 'monthly') or p_next_pay_on is null then
    raise exception 'invalid_setting';
  end if;
  insert into public.my_money (user_id, pay_amount_cents, pay_frequency, next_pay_on)
  values (v_user_id, p_amount_cents, p_frequency, p_next_pay_on)
  on conflict (user_id) do update set
    pay_amount_cents = excluded.pay_amount_cents, pay_frequency = excluded.pay_frequency,
    next_pay_on = excluded.next_pay_on, updated_at = now();
end;
$$;

-- What your account has in it now (as of today, NZ time).
create function public.set_my_balance(p_balance_cents bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
begin
  if p_balance_cents is null or abs(p_balance_cents) > 100000000 then
    raise exception 'invalid_amount';
  end if;
  insert into public.my_money (user_id, balance_cents, balance_on)
  values (v_user_id, p_balance_cents, private.nz_today())
  on conflict (user_id) do update set
    balance_cents = excluded.balance_cents, balance_on = excluded.balance_on, updated_at = now();
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'save_personal_bill(uuid, text, text, text, bigint, text, date)', 'stop_personal_bill(uuid)',
    'save_pay(bigint, text, date)', 'set_my_balance(bigint)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
