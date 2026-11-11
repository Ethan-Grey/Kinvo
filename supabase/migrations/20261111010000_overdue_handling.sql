-- =============================================================================
-- Overdue handling (ADR-0027)
--
-- 1. Late reminders can stop: reminder_settings.late_until_days. After this
--    many days late, no more "overdue" reminders go to either person.
-- 2. Late payments can move: after move_after_days days late, the unpaid
--    payment is moved to move_by_days after its due date (a week by default,
--    or further on if that has already passed). With move_whole_plan, every
--    later payment moves by the same number of days. Otherwise only the missed
--    amount moves, joining any payment already on that date.
--    The loan remembers it's running late (late_since, moved_to) until the
--    moved payment is paid, and counts how many times payments have moved.
--
-- A move is saved as a new terms version, like a lender reschedule, so the
-- old schedule stays in the history. Both people are told.
-- =============================================================================

alter table public.reminder_settings
  add column late_until_days smallint check (late_until_days is null or late_until_days between 1 and 120),
  add column move_after_days smallint check (move_after_days is null or move_after_days between 1 and 60),
  add column move_by_days    smallint not null default 7 check (move_by_days between 1 and 60),
  add column move_whole_plan boolean not null default true;

alter table public.loans
  add column late_since  date,
  add column moved_to    date,
  add column times_moved int not null default 0;


-- -----------------------------------------------------------------------------
-- Saving settings, now with the overdue options
-- -----------------------------------------------------------------------------
drop function public.save_reminder_settings(uuid, jsonb, int, int);

create function public.save_reminder_settings(
  p_relationship_id uuid,
  p_rules           jsonb,
  p_late_every_days int default null,
  p_late_hour       int default 9,
  p_late_until_days int default null,
  p_move_after_days int default null,
  p_move_by_days    int default 7,
  p_move_whole_plan boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_item    jsonb;
  v_days    int;
  v_hour    int;
begin
  perform private.lock_relationship_as_lender(p_relationship_id, v_user_id);

  if jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules) > 10
     or (p_late_every_days is not null and p_late_every_days not between 1 and 30)
     or p_late_hour is null or p_late_hour not between 0 and 23
     or (p_late_until_days is not null and p_late_until_days not between 1 and 120)
     or (p_move_after_days is not null and p_move_after_days not between 1 and 60)
     or p_move_by_days is null or p_move_by_days not between 1 and 60
     or p_move_whole_plan is null then
    raise exception 'invalid_setting';
  end if;

  delete from public.reminder_rules where relationship_id = p_relationship_id;
  for v_item in select value from jsonb_array_elements(p_rules) loop
    begin
      v_days := (v_item ->> 'days_from_due')::int;
      v_hour := (v_item ->> 'send_hour')::int;
    exception when others then
      raise exception 'invalid_setting';
    end;
    if v_days is null or v_days not between -14 and 60 or v_hour is null or v_hour not between 0 and 23 then
      raise exception 'invalid_setting';
    end if;
    insert into public.reminder_rules (relationship_id, days_from_due, send_hour)
    values (p_relationship_id, v_days, v_hour)
    on conflict on constraint reminder_rules_unique do nothing;
  end loop;

  insert into public.reminder_settings as s (
    relationship_id, late_every_days, late_hour, late_until_days, move_after_days, move_by_days, move_whole_plan
  )
  values (
    p_relationship_id, p_late_every_days, p_late_hour, p_late_until_days, p_move_after_days, p_move_by_days,
    p_move_whole_plan
  )
  on conflict (relationship_id) do update set
    late_every_days = excluded.late_every_days,
    late_hour = excluded.late_hour,
    late_until_days = excluded.late_until_days,
    move_after_days = excluded.move_after_days,
    move_by_days = excluded.move_by_days,
    move_whole_plan = excluded.move_whole_plan,
    updated_at = now();
end;
$$;

revoke all on function public.save_reminder_settings(uuid, jsonb, int, int, int, int, int, boolean) from public, anon;
grant execute on function public.save_reminder_settings(uuid, jsonb, int, int, int, int, int, boolean) to authenticated;


-- -----------------------------------------------------------------------------
-- Moving late payments
-- -----------------------------------------------------------------------------
create function private.move_overdue_payments(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today   date := (p_now at time zone 'Pacific/Auckland')::date;
  r         record;
  m         record;
  v_new     date;
  v_shift   int;
  v_left    bigint;
  v_terms   public.loan_terms;
  v_plan    jsonb;
  v_note    text;
  v_moved   int;
begin
  -- Loans that were running late but have since caught up.
  update public.loans l set late_since = null, moved_to = null
  where l.late_since is not null
    and (l.status <> 'active' or not exists (
      select 1 from private.instalment_progress(l.id) p
      where p.paid_cents < p.amount_cents and p.due_on <= l.moved_to));

  for r in
    select l.id, l.lender_id, l.borrower_id, l.current_terms_id, l.times_moved,
           s.move_after_days, s.move_by_days, s.move_whole_plan,
           le.display_name as lender_name, bo.display_name as borrower_name
    from public.loans l
    join public.reminder_settings s on s.relationship_id = l.relationship_id
    join public.profiles le on le.id = l.lender_id
    join public.profiles bo on bo.id = l.borrower_id
    where l.status = 'active' and s.move_after_days is not null
    for update of l skip locked
  loop
    -- The earliest payment not fully paid.
    select * into m from private.instalment_progress(r.id) p
    where p.paid_cents < p.amount_cents order by p.sequence limit 1;
    continue when not found or v_today - m.due_on < r.move_after_days;

    v_new := m.due_on + r.move_by_days;
    while v_new <= v_today loop
      v_new := v_new + r.move_by_days;
    end loop;
    v_shift := v_new - m.due_on;
    v_left := m.amount_cents - m.paid_cents;

    -- The new plan. Payments that land on the same date are combined.
    with progress as (
      select * from private.instalment_progress(r.id)
    ), parts(due_on, amount_cents) as (
      select p.due_on, p.amount_cents from progress p where p.sequence < m.sequence
      union all
      select p.due_on + v_shift, p.amount_cents from progress p
      where r.move_whole_plan and p.sequence >= m.sequence
      union all
      -- Only the missed amount moves; anything already paid of it stays put.
      select m.due_on, m.paid_cents where not r.move_whole_plan and m.paid_cents > 0
      union all
      select v_new, v_left where not r.move_whole_plan
      union all
      select p.due_on, p.amount_cents from progress p where not r.move_whole_plan and p.sequence > m.sequence
    )
    select jsonb_agg(jsonb_build_object('due_on', g.due_on, 'amount_cents', g.total) order by g.due_on)
    into v_plan
    from (select x.due_on, sum(x.amount_cents)::bigint as total from parts x group by x.due_on) g;

    select * into v_terms from public.loan_terms t where t.id = r.current_terms_id;
    v_moved := r.times_moved + 1;
    v_note := format('Moved by Kinvo: the payment due %s was %s days late.',
      private.short_date(m.due_on), v_today - m.due_on);

    perform private.insert_terms(
      r.id, r.lender_id, v_terms.principal_cents, v_terms.charge_cents, v_plan,
      v_terms.late_terms, v_terms.conditions, v_note, true
    );

    update public.loans
    set late_since = coalesce(late_since, m.due_on), moved_to = v_new, times_moved = v_moved
    where id = r.id;

    perform private.log_loan_event(
      r.id, 'payment_moved',
      jsonb_build_object('from', m.due_on, 'to', v_new, 'amount_cents', v_left, 'whole_plan', r.move_whole_plan)
    );

    perform private.notify(r.borrower_id, 'payment_moved', r.id,
      format('%s to %s is overdue, now due %s', private.money(v_left), r.lender_name, private.short_date(v_new)),
      format('It was due %s.%s', private.short_date(m.due_on),
        case when r.move_whole_plan then ' Your later payments moved too.' else '' end),
      'moved:' || r.id || ':' || v_moved || ':' || r.borrower_id);
    perform private.notify(r.lender_id, 'payment_moved', r.id,
      format('%s''s overdue payment moved to %s', r.borrower_name, private.short_date(v_new)),
      format('%s was due %s. Moved %s time%s so far.', private.money(v_left), private.short_date(m.due_on),
        v_moved, case when v_moved = 1 then '' else 's' end),
      'moved:' || r.id || ':' || v_moved || ':' || r.lender_id);
  end loop;
end;
$$;

revoke all on function private.move_overdue_payments(timestamptz) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Reminders: move first, and stop late reminders after late_until_days
-- -----------------------------------------------------------------------------
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
  q         record;
  t         record;
  c         record;
  v_days    int;
  v_last    int;
  v_n       int;
  v_next    timestamptz;
begin
  -- Move payments that are late enough first, so reminders use the new dates.
  perform private.move_overdue_payments(p_now);

  for r in
    select l.id as loan_id, l.lender_id, l.borrower_id, l.relationship_id,
           le.display_name as lender_name, bo.display_name as borrower_name,
           p.instalment_id, p.due_on, p.amount_cents - p.paid_cents as remaining,
           s.relationship_id is not null as customised,
           case when s.relationship_id is null then 7 else s.late_every_days end as late_every_days,
           coalesce(s.late_hour, 9) as late_hour,
           s.late_until_days
    from public.loans l
    join public.profiles le on le.id = l.lender_id
    join public.profiles bo on bo.id = l.borrower_id
    left join public.reminder_settings s on s.relationship_id = l.relationship_id
    cross join lateral private.instalment_progress(l.id) p
    where l.status = 'active' and p.paid_cents < p.amount_cents
  loop
    v_days := v_today - r.due_on;

    -- The borrower's reminders at their times.
    for q in
      select x.days_from_due, x.send_hour from public.reminder_rules x
      where r.customised and x.relationship_id = r.relationship_id
      union all
      select d, 9 from (values (-1), (0), (1)) v(d) where not r.customised
    loop
      continue when q.days_from_due <> v_days or v_hour < q.send_hour;
      select * into t from private.reminder_text(v_days, r.remaining, r.lender_name, r.due_on);
      perform private.notify(r.borrower_id, t.kind, r.loan_id, t.title, t.body,
        'rule:' || r.instalment_id || ':' || v_days || ':' || q.send_hour);
    end loop;

    -- Keep reminding while late, every N days after the last reminder.
    if r.late_every_days is not null and v_days >= 1 and v_hour >= r.late_hour
       and (r.late_until_days is null or v_days <= r.late_until_days) then
      select coalesce(max(x.days_from_due), 0) into v_last
      from public.reminder_rules x where r.customised and x.relationship_id = r.relationship_id;
      if not r.customised then v_last := 1; end if;
      v_last := greatest(v_last, 0);
      if v_days > v_last and (v_days - v_last) % r.late_every_days = 0 then
        select * into t from private.reminder_text(v_days, r.remaining, r.lender_name, r.due_on);
        perform private.notify(r.borrower_id, t.kind, r.loan_id, t.title, t.body,
          'late:' || r.instalment_id || ':' || v_days);
      end if;
    end if;

    -- The person owed hears the day after a missed payment, then weekly, at 9am.
    if v_days >= 1 and (v_days - 1) % 7 = 0 and v_hour >= 9
       and (r.late_until_days is null or v_days <= r.late_until_days) then
      perform private.notify(r.lender_id, 'borrower_overdue', r.loan_id,
        format('%s''s payment of %s is overdue', r.borrower_name, private.money(r.remaining)),
        format('It was due %s (%s day%s ago).', private.short_date(r.due_on), v_days, case when v_days = 1 then '' else 's' end),
        'overdue:' || r.instalment_id || ':' || v_days || ':' || r.lender_id);
    end if;
  end loop;

  -- Custom reminders that are due (unchanged from ADR-0018).
  for c in
    select cr.*, rel.borrower_id, rel.ended_at, le.display_name as lender_name, l.status as loan_status
    from public.custom_reminders cr
    join public.lending_relationships rel on rel.id = cr.relationship_id
    join public.profiles le on le.id = rel.lender_id
    left join public.loans l on l.id = cr.loan_id
    where cr.next_at is not null and cr.next_at <= p_now
    for update of cr skip locked
  loop
    if c.ended_at is not null or (c.loan_id is not null and c.loan_status is distinct from 'active') then
      update public.custom_reminders set next_at = null, cancelled_at = p_now where id = c.id;
      continue;
    end if;

    perform private.notify(c.borrower_id, 'custom_reminder', c.loan_id,
      format('Reminder from %s', c.lender_name), c.message,
      'custom:' || c.id || ':' || c.sent_count);

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
