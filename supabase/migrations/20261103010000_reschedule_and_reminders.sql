-- =============================================================================
-- Lender controls on a running loan (ADR-0018)
--
-- 1. reschedule_loan: the lender changes the repayment dates and amounts of
--    an active loan. It takes effect straight away and the borrower is told.
--    The total owed doesn't change. It's saved as a new terms version, so the
--    old schedule stays in the history.
-- 2. reminder_settings: per borrower, the hour automatic reminders go out and
--    which ones are sent (day before, on the day, overdue and how often).
-- 3. custom_reminders: the lender's own message to a borrower at a date and
--    hour they pick, once or repeating.
--
-- queue_reminders still runs hourly (pg_cron at :05). Each reminder goes out
-- on the first run at or after its hour, and dedupe keys stop repeats.
-- =============================================================================


-- =============================================================================
-- 1. Changing the schedule
-- =============================================================================
create function public.reschedule_loan(
  p_loan_id           uuid,
  p_expected_terms_id uuid,
  p_instalments       jsonb,
  p_note              text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_loan    public.loans := private.lock_loan_for_party(p_loan_id, v_user_id);
  v_terms   public.loan_terms;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_new_id  uuid;
  v_lender  text;
begin
  if v_loan.lender_id <> v_user_id then
    raise exception 'lender_only';
  elsif v_loan.status <> 'active' then
    raise exception 'loan_not_active';
  elsif v_loan.current_terms_id is distinct from p_expected_terms_id then
    raise exception 'terms_changed';
  elsif char_length(coalesce(v_note, '')) > 500 then
    raise exception 'reason_too_long';
  end if;

  select * into v_terms from public.loan_terms t where t.id = v_loan.current_terms_id;

  -- Same amount and charge; only the schedule changes. Past dates are allowed
  -- because instalments already paid keep their original dates.
  v_new_id := private.insert_terms(
    p_loan_id, v_user_id, v_terms.principal_cents, v_terms.charge_cents, p_instalments,
    v_terms.late_terms, v_terms.conditions, v_note, true
  );

  perform private.log_loan_event(
    p_loan_id, 'loan_rescheduled',
    jsonb_build_object('from_terms_id', v_terms.id, 'to_terms_id', v_new_id, 'note', v_note)
  );

  select display_name into v_lender from public.profiles where id = v_loan.lender_id;
  perform private.notify(
    v_loan.borrower_id, 'loan_rescheduled', p_loan_id,
    format('%s changed your repayment dates', v_lender),
    coalesce('Their note: ' || v_note || ' ', '') || 'Open Kinvo to see the new schedule.',
    'rescheduled:' || v_new_id
  );

  return v_new_id;
end;
$$;

revoke all on function public.reschedule_loan(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.reschedule_loan(uuid, uuid, jsonb, text) to authenticated;


-- =============================================================================
-- 2. Reminder settings, one row per borrower (missing row = the defaults)
-- =============================================================================
create table public.reminder_settings (
  relationship_id    uuid primary key references public.lending_relationships (id) on delete cascade,
  send_hour          smallint not null default 9 check (send_hour between 0 and 23),
  day_before         boolean not null default true,
  on_the_day         boolean not null default true,
  when_overdue       boolean not null default true,
  overdue_every_days smallint not null default 7 check (overdue_every_days between 1 and 30),
  updated_at         timestamptz not null default now()
);

revoke all on public.reminder_settings from anon, authenticated;
grant select on public.reminder_settings to authenticated;
alter table public.reminder_settings enable row level security;

-- Both people can see when reminders go out; only the lender changes them.
create policy "Both people see the reminder settings"
  on public.reminder_settings for select to authenticated
  using (private.is_party_to(relationship_id));

-- The relationship, locked, if the caller is its lender.
create function private.lock_relationship_as_lender(p_relationship_id uuid, p_user_id uuid)
returns public.lending_relationships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rel public.lending_relationships;
begin
  select * into v_rel from public.lending_relationships r where r.id = p_relationship_id for update;
  if not found or p_user_id not in (v_rel.lender_id, v_rel.borrower_id) then
    raise exception 'relationship_not_found';
  elsif v_rel.lender_id <> p_user_id then
    raise exception 'lender_only';
  elsif v_rel.ended_at is not null then
    raise exception 'relationship_ended';
  end if;
  return v_rel;
end;
$$;
revoke all on function private.lock_relationship_as_lender(uuid, uuid) from public, anon, authenticated;

create function public.save_reminder_settings(
  p_relationship_id    uuid,
  p_send_hour          int,
  p_day_before         boolean,
  p_on_the_day         boolean,
  p_when_overdue       boolean,
  p_overdue_every_days int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
begin
  perform private.lock_relationship_as_lender(p_relationship_id, v_user_id);
  if p_send_hour is null or p_send_hour not between 0 and 23
     or p_overdue_every_days is null or p_overdue_every_days not between 1 and 30
     or p_day_before is null or p_on_the_day is null or p_when_overdue is null then
    raise exception 'invalid_setting';
  end if;

  insert into public.reminder_settings as s (
    relationship_id, send_hour, day_before, on_the_day, when_overdue, overdue_every_days
  )
  values (p_relationship_id, p_send_hour, p_day_before, p_on_the_day, p_when_overdue, p_overdue_every_days)
  on conflict (relationship_id) do update set
    send_hour = excluded.send_hour,
    day_before = excluded.day_before,
    on_the_day = excluded.on_the_day,
    when_overdue = excluded.when_overdue,
    overdue_every_days = excluded.overdue_every_days,
    updated_at = now();
end;
$$;

revoke all on function public.save_reminder_settings(uuid, int, boolean, boolean, boolean, int) from public, anon;
grant execute on function public.save_reminder_settings(uuid, int, boolean, boolean, boolean, int) to authenticated;


-- =============================================================================
-- 3. Custom reminders
-- =============================================================================
create type public.reminder_repeat as enum ('never', 'daily', 'weekly', 'fortnightly', 'monthly');

create table public.custom_reminders (
  id              uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.lending_relationships (id) on delete cascade,
  loan_id         uuid references public.loans (id) on delete cascade,
  created_by      uuid not null references public.profiles (id) on delete cascade,
  message         text not null check (char_length(message) between 1 and 200),
  first_on        date not null,
  send_hour       smallint not null check (send_hour between 0 and 23),
  repeat          public.reminder_repeat not null default 'never',
  -- How many have gone out. The next one is worked out from first_on, so
  -- monthly reminders on the 31st don't drift.
  sent_count      int not null default 0,
  -- When the next one is due; null once it's finished or cancelled.
  next_at         timestamptz,
  last_sent_at    timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index custom_reminders_relationship_idx on public.custom_reminders (relationship_id);
create index custom_reminders_due_idx on public.custom_reminders (next_at) where next_at is not null;

revoke all on public.custom_reminders from anon, authenticated;
grant select on public.custom_reminders to authenticated;
alter table public.custom_reminders enable row level security;

-- Only the lender who set them sees the list; the borrower just gets them.
create policy "Lenders see their own custom reminders"
  on public.custom_reminders for select to authenticated
  using (created_by = (select auth.uid()));

-- The n-th occurrence (0 = the first), as a moment in time.
create function private.reminder_occurrence(
  p_first_on date, p_send_hour int, p_repeat public.reminder_repeat, p_n int
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (
    (case p_repeat
       when 'daily'       then p_first_on + p_n
       when 'weekly'      then p_first_on + 7 * p_n
       when 'fortnightly' then p_first_on + 14 * p_n
       when 'monthly'     then (p_first_on + make_interval(months => p_n))::date
       else p_first_on
     end + make_time(p_send_hour, 0, 0)) at time zone 'Pacific/Auckland'
  );
$$;

create function public.create_custom_reminder(
  p_relationship_id uuid,
  p_message         text,
  p_first_on        date,
  p_send_hour       int,
  p_repeat          public.reminder_repeat default 'never',
  p_loan_id         uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_message text := btrim(coalesce(p_message, ''));
  v_next    timestamptz;
  v_id      uuid;
begin
  perform private.lock_relationship_as_lender(p_relationship_id, v_user_id);

  if char_length(v_message) not between 1 and 200 then
    raise exception 'invalid_reminder_message';
  elsif p_first_on is null or p_send_hour is null or p_send_hour not between 0 and 23 or p_repeat is null then
    raise exception 'invalid_setting';
  end if;

  if p_loan_id is not null and not exists (
    select 1 from public.loans l
    where l.id = p_loan_id and l.relationship_id = p_relationship_id and l.status = 'active'
  ) then
    raise exception 'loan_not_active';
  end if;

  v_next := private.reminder_occurrence(p_first_on, p_send_hour, p_repeat, 0);
  if v_next <= now() then
    raise exception 'reminder_in_past';
  end if;

  if (select count(*) from public.custom_reminders c
      where c.relationship_id = p_relationship_id and c.next_at is not null) >= 20 then
    raise exception 'too_many_reminders';
  end if;

  insert into public.custom_reminders (
    relationship_id, loan_id, created_by, message, first_on, send_hour, repeat, next_at
  )
  values (p_relationship_id, p_loan_id, v_user_id, v_message, p_first_on, p_send_hour, p_repeat, v_next)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.cancel_custom_reminder(p_reminder_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
begin
  update public.custom_reminders
  set cancelled_at = now(), next_at = null
  where id = p_reminder_id and created_by = v_user_id and cancelled_at is null;
  if not found then
    raise exception 'reminder_not_found';
  end if;
end;
$$;

revoke all on function public.create_custom_reminder(uuid, text, date, int, public.reminder_repeat, uuid) from public, anon;
grant execute on function public.create_custom_reminder(uuid, text, date, int, public.reminder_repeat, uuid) to authenticated;
revoke all on function public.cancel_custom_reminder(uuid) from public, anon;
grant execute on function public.cancel_custom_reminder(uuid) to authenticated;
revoke all on function private.reminder_occurrence(date, int, public.reminder_repeat, int) from public, anon, authenticated;


-- =============================================================================
-- 4. The hourly reminder run, now following each borrower's settings
-- =============================================================================
create or replace function private.queue_reminders(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local   timestamp := p_now at time zone 'Pacific/Auckland';
  v_today   date := v_local::date;
  v_hour    int := extract(hour from v_local)::int;
  r         record;
  c         record;
  v_days    int;
  v_n       int;
  v_next    timestamptz;
begin
  -- Due and overdue reminders, at each borrower's chosen hour (default 9am).
  for r in
    select l.id as loan_id, l.lender_id, l.borrower_id,
           le.display_name as lender_name, bo.display_name as borrower_name,
           p.instalment_id, p.due_on, p.amount_cents - p.paid_cents as remaining,
           coalesce(s.send_hour, 9) as send_hour,
           coalesce(s.day_before, true) as day_before,
           coalesce(s.on_the_day, true) as on_the_day,
           coalesce(s.when_overdue, true) as when_overdue,
           coalesce(s.overdue_every_days, 7) as overdue_every_days
    from public.loans l
    join public.profiles le on le.id = l.lender_id
    join public.profiles bo on bo.id = l.borrower_id
    left join public.reminder_settings s on s.relationship_id = l.relationship_id
    cross join lateral private.instalment_progress(l.id) p
    where l.status = 'active' and p.paid_cents < p.amount_cents
  loop
    continue when v_hour < r.send_hour;
    v_days := v_today - r.due_on;

    if v_days = -1 and r.day_before then
      perform private.notify(r.borrower_id, 'due_tomorrow', r.loan_id,
        format('%s due to %s tomorrow', private.money(r.remaining), r.lender_name),
        format('Due %s. Tap "I''ve paid" in Kinvo once you''ve paid.', private.short_date(r.due_on)),
        'due_tomorrow:' || r.instalment_id);
    elsif v_days = 0 and r.on_the_day then
      perform private.notify(r.borrower_id, 'due_today', r.loan_id,
        format('%s due to %s today', private.money(r.remaining), r.lender_name),
        'Tap "I''ve paid" in Kinvo once you''ve paid.',
        'due_today:' || r.instalment_id);
    elsif v_days >= 1 and (v_days - 1) % r.overdue_every_days = 0 then
      if r.when_overdue then
        perform private.notify(r.borrower_id, 'overdue', r.loan_id,
          format('%s to %s is overdue', private.money(r.remaining), r.lender_name),
          format('It was due %s. Pay what you can and let them know in Kinvo.', private.short_date(r.due_on)),
          'overdue:' || r.instalment_id || ':' || v_days || ':' || r.borrower_id);
      end if;
      -- The lender always hears about missed payments.
      perform private.notify(r.lender_id, 'borrower_overdue', r.loan_id,
        format('%s''s payment of %s is overdue', r.borrower_name, private.money(r.remaining)),
        format('It was due %s (%s day%s ago).', private.short_date(r.due_on), v_days, case when v_days = 1 then '' else 's' end),
        'overdue:' || r.instalment_id || ':' || v_days || ':' || r.lender_id);
    end if;
  end loop;

  -- Custom reminders that are due.
  for c in
    select cr.*, rel.borrower_id, rel.ended_at, le.display_name as lender_name, l.status as loan_status
    from public.custom_reminders cr
    join public.lending_relationships rel on rel.id = cr.relationship_id
    join public.profiles le on le.id = rel.lender_id
    left join public.loans l on l.id = cr.loan_id
    where cr.next_at is not null and cr.next_at <= p_now
    for update of cr skip locked
  loop
    -- The connection ended or the loan is finished: stop quietly.
    if c.ended_at is not null or (c.loan_id is not null and c.loan_status is distinct from 'active') then
      update public.custom_reminders set next_at = null, cancelled_at = p_now where id = c.id;
      continue;
    end if;

    perform private.notify(c.borrower_id, 'custom_reminder', c.loan_id,
      format('Reminder from %s', c.lender_name), c.message,
      'custom:' || c.id || ':' || c.sent_count);

    -- Next occurrence after now (skips any missed while the server was down).
    v_n := c.sent_count + 1;
    v_next := null;
    if c.repeat <> 'never' then
      loop
        v_next := private.reminder_occurrence(c.first_on, c.send_hour, c.repeat, v_n);
        exit when v_next > p_now;
        v_n := v_n + 1;
      end loop;
    end if;

    update public.custom_reminders
    set sent_count = c.sent_count + 1, last_sent_at = p_now, next_at = v_next
    where id = c.id;
  end loop;
end;
$$;
