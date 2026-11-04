-- =============================================================================
-- Household spending (ADR-0023): groceries, takeaways and the like.
--
-- Whoever paid adds it. Paid from the shared account: it comes off the
-- balance and nobody owes anybody. Paid by a person: everyone else's share
-- (household split unless changed) goes on the household tab.
-- =============================================================================

create table public.household_expenses (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  description  text check (description is null or char_length(description) <= 100),
  category     text not null check (category in ('groceries', 'takeaways', 'household', 'transport', 'fun', 'other')),
  amount_cents bigint not null check (amount_cents between 1 and 10000000),
  spent_on     date not null,
  -- Null when it came out of the shared account.
  paid_by      uuid references public.profiles (id) on delete set null,
  from_shared  boolean not null default false,
  -- [{user_id, share_bp}] summing to 10000, or null for the household split.
  split        jsonb,
  receipt_path text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  constraint household_expenses_payer check (from_shared = (paid_by is null))
);
create index household_expenses_household_idx on public.household_expenses (household_id, spent_on desc);

revoke all on public.household_expenses from anon, authenticated;
grant select on public.household_expenses to authenticated;
alter table public.household_expenses enable row level security;
create policy "Members see spending" on public.household_expenses for select to authenticated
  using (private.is_household_member(household_id));

alter table public.household_tab_entries drop constraint household_tab_entries_source_check;
alter table public.household_tab_entries add constraint household_tab_entries_source_check
  check (source in ('bill', 'settle', 'expense'));
alter table public.household_tab_entries
  add column expense_id uuid references public.household_expenses (id) on delete cascade;
alter table public.shared_account_entries
  add column expense_id uuid references public.household_expenses (id) on delete cascade;


create function public.add_household_expense(
  p_household_id uuid,
  p_category     text,
  p_amount_cents bigint,
  p_paid_by      uuid,            -- null = from the shared account
  p_description  text default null,
  p_spent_on     date default null,
  p_split        jsonb default null,
  p_receipt_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id   uuid := private.require_user();
  v_household public.households := private.require_household_member(p_household_id, v_user_id);
  v_on        date := coalesce(p_spent_on, private.nz_today());
  v_desc      text := nullif(btrim(coalesce(p_description, '')), '');
  v_id        uuid;
  v_share     record;
  v_name      text;
  v_label     text;
begin
  if p_category not in ('groceries', 'takeaways', 'household', 'transport', 'fun', 'other') then
    raise exception 'invalid_setting';
  elsif p_amount_cents is null or p_amount_cents not between 1 and 10000000 then
    raise exception 'invalid_amount';
  elsif v_on > private.nz_today() or v_on < private.nz_today() - 366 then
    raise exception 'invalid_received_date';
  elsif char_length(coalesce(v_desc, '')) > 100 then
    raise exception 'invalid_notes';
  elsif p_paid_by is null and not v_household.has_shared_account then
    raise exception 'no_shared_account';
  elsif p_paid_by is not null and not private.is_active_member(p_household_id, p_paid_by) then
    raise exception 'invalid_payer';
  end if;
  perform private.validate_split(p_household_id, p_split);

  insert into public.household_expenses (
    household_id, description, category, amount_cents, spent_on, paid_by, from_shared, split, receipt_path, created_by
  )
  values (
    p_household_id, v_desc, p_category, p_amount_cents, v_on, p_paid_by, p_paid_by is null, p_split,
    private.household_receipt(p_household_id, p_receipt_path), v_user_id
  )
  returning id into v_id;

  v_label := coalesce(v_desc, initcap(p_category));
  if p_paid_by is null then
    insert into public.shared_account_entries (household_id, kind, amount_cents, expense_id, occurred_on, created_by, note)
    values (p_household_id, 'expense', -p_amount_cents, v_id, v_on, v_user_id, v_label);
  else
    select display_name into v_name from public.profiles where id = p_paid_by;
    for v_share in select * from private.split_cents(p_amount_cents, private.household_shares(p_household_id, p_split)) loop
      if v_share.user_id <> p_paid_by and v_share.cents > 0 then
        insert into public.household_tab_entries (
          household_id, owed_to, owed_by, amount_cents, source, expense_id, note, receipt_path, created_by
        )
        values (p_household_id, p_paid_by, v_share.user_id, v_share.cents, 'expense', v_id, v_label,
                private.household_receipt(p_household_id, p_receipt_path), v_user_id);
        -- Tell them, unless they added it themselves.
        if v_share.user_id <> v_user_id then
          perform private.notify_link(v_share.user_id, 'household_expense',
            format('%s: your share is %s', v_label, private.money(v_share.cents)),
            format('%s paid %s in %s.', v_name, private.money(p_amount_cents), v_household.name),
            'household_expense:' || v_id || ':' || v_share.user_id, '/households/' || p_household_id);
        end if;
      end if;
    end loop;
  end if;
  return v_id;
end;
$$;

-- Undo spending added by mistake. Whoever added it or paid it can.
create function public.remove_household_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  e         public.household_expenses;
begin
  select * into e from public.household_expenses where id = p_expense_id for update;
  if not found or not private.is_active_member(e.household_id, v_user_id) or e.voided_at is not null then
    raise exception 'entry_not_found';
  elsif v_user_id not in (coalesce(e.created_by, v_user_id), coalesce(e.paid_by, e.created_by)) then
    raise exception 'cannot_undo_entry';
  end if;
  update public.household_expenses set voided_at = now() where id = e.id;
  update public.household_tab_entries set voided_at = now() where expense_id = e.id and voided_at is null;
  update public.shared_account_entries set voided_at = now(), voided_by = v_user_id
  where expense_id = e.id and voided_at is null;
end;
$$;

revoke all on function public.add_household_expense(uuid, text, bigint, uuid, text, date, jsonb, text) from public, anon;
grant execute on function public.add_household_expense(uuid, text, bigint, uuid, text, date, jsonb, text) to authenticated;
revoke all on function public.remove_household_expense(uuid) from public, anon;
grant execute on function public.remove_household_expense(uuid) to authenticated;
