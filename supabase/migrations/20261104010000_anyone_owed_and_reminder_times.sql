-- =============================================================================
-- ADR-0019
-- 1. Anyone can be owed: every account can invite people and set up what
--    they owe, with no approval. (Partners and flatmates cover each other's
--    shopping both ways.) can_lend stays as a column, always true.
-- 2. Neutral wording in notifications: not only loans, also paying someone
--    back for something they bought.
-- 3. Reminder times: any number of reminders, each a day relative to the due
--    date (before, on, after) and an hour. Plus an optional "keep reminding
--    while late" repeat. Replaces the on/off switches from ADR-0018.
-- =============================================================================

-- 1. Anyone can be owed
alter table public.profiles alter column can_lend set default true;
update public.profiles set can_lend = true where not can_lend;
comment on column public.profiles.can_lend is 'Always true since ADR-0019: anyone can invite people who owe them.';


-- 2. Neutral wording
create or replace function private.notify_from_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan        public.loans;
  v_lender      text;
  v_borrower    text;
  v_principal   bigint;
  v_total       bigint;
  v_amount      bigint;
  v_reason      text;
  v_other_of    uuid;   -- the party who is NOT the actor
  v_key         text := 'event:' || new.id || ':';
  v_first_due   record;
begin
  if new.loan_id is null then
    return new;
  end if;

  select * into v_loan from public.loans l where l.id = new.loan_id;
  select display_name into v_lender from public.profiles where id = v_loan.lender_id;
  select display_name into v_borrower from public.profiles where id = v_loan.borrower_id;
  select t.principal_cents, t.principal_cents + t.charge_cents into v_principal, v_total
  from public.loan_terms t where t.id = v_loan.current_terms_id;

  v_other_of := case when new.actor_id = v_loan.lender_id then v_loan.borrower_id else v_loan.lender_id end;

  -- Amount and reason for payment events.
  v_amount := (new.payload ->> 'amount_cents')::bigint;
  v_reason := new.payload ->> 'reason';
  if v_amount is null and new.payload ? 'repayment_id' then
    select r.amount_cents into v_amount from public.repayments r where r.id = (new.payload ->> 'repayment_id')::uuid;
  end if;

  case new.event_type
    when 'loan_requested' then
      perform private.notify(v_loan.lender_id, 'loan_requested', v_loan.id,
        format('%s asked you for %s', v_borrower, private.money(v_principal)),
        'Open Kinvo to accept, suggest changes, or decline.', v_key || v_loan.lender_id);

    when 'loan_offered' then
      perform private.notify(v_loan.borrower_id, 'loan_offered', v_loan.id,
        format('%s sent you a proposal for %s', v_lender, private.money(v_principal)),
        format('You''d pay back %s in total. Open Kinvo to accept, suggest changes, or decline.', private.money(v_total)),
        v_key || v_loan.borrower_id);

    when 'terms_proposed' then
      perform private.notify(v_other_of, 'counter_offer', v_loan.id,
        format('%s suggested different terms',
          case when v_other_of = v_loan.lender_id then v_borrower else v_lender end),
        format('New proposal: %s, paid back as %s in total. Open Kinvo to reply.', private.money(v_principal), private.money(v_total)),
        v_key || v_other_of);

    when 'terms_accepted' then
      if v_other_of = v_loan.lender_id then
        perform private.notify(v_loan.lender_id, 'terms_accepted', v_loan.id,
          format('%s accepted', v_borrower),
          format('Once you''ve sent %s or paid for it, tap "Confirm paid out" in Kinvo.', private.money(v_principal)),
          v_key || v_loan.lender_id);
      else
        perform private.notify(v_loan.borrower_id, 'terms_accepted', v_loan.id,
          format('%s accepted your request', v_lender),
          format('Paying back starts once they confirm they''ve paid out %s.', private.money(v_principal)),
          v_key || v_loan.borrower_id);
      end if;

    when 'existing_debt_confirmed' then
      perform private.notify(v_loan.lender_id, 'existing_debt_confirmed', v_loan.id,
        format('%s confirmed what they owe', v_borrower),
        format('%s is now being tracked in Kinvo.', private.money(v_total)), v_key || v_loan.lender_id);

    when 'loan_rejected' then
      perform private.notify(v_other_of, 'loan_declined', v_loan.id,
        format('%s declined the proposal',
          case when v_other_of = v_loan.lender_id then v_borrower else v_lender end),
        coalesce('Their note: ' || (new.payload ->> 'note'), ''), v_key || v_other_of);

    when 'loan_withdrawn' then
      perform private.notify(v_other_of, 'loan_cancelled', v_loan.id,
        format('%s cancelled the proposal',
          case when v_other_of = v_loan.lender_id then v_borrower else v_lender end),
        coalesce('Their note: ' || (new.payload ->> 'note'), 'No money was sent.'), v_key || v_other_of);

    when 'funds_confirmed' then
      select i.due_on, i.amount_cents into v_first_due
      from public.instalments i where i.terms_id = v_loan.current_terms_id order by i.sequence limit 1;
      perform private.notify(v_loan.borrower_id, 'funds_sent', v_loan.id,
        format('%s paid out %s for you', v_lender, private.money(v_principal)),
        format('Paying back has started. First payment: %s due %s.',
          private.money(v_first_due.amount_cents), private.short_date(v_first_due.due_on)),
        v_key || v_loan.borrower_id);

    when 'repayment_claimed' then
      perform private.notify(v_loan.lender_id, 'payment_claimed', v_loan.id,
        format('%s says they paid you %s', v_borrower, private.money(v_amount)),
        'Confirm it in Kinvo once it reaches your account.', v_key || v_loan.lender_id);

    when 'repayment_confirmed' then
      perform private.notify(v_loan.borrower_id, 'payment_confirmed', v_loan.id,
        format('%s confirmed your payment of %s', v_lender, private.money(v_amount)), '', v_key || v_loan.borrower_id);

    when 'repayment_recorded' then
      perform private.notify(v_loan.borrower_id, 'payment_recorded', v_loan.id,
        format('%s recorded your payment of %s', v_lender, private.money(v_amount)), '', v_key || v_loan.borrower_id);

    when 'repayment_disputed' then
      perform private.notify(v_loan.borrower_id, 'payment_disputed', v_loan.id,
        format('%s hasn''t received your payment of %s', v_lender, private.money(v_amount)),
        coalesce('Their note: ' || v_reason, ''), v_key || v_loan.borrower_id);

    when 'repayment_reversed' then
      perform private.notify(v_loan.borrower_id, 'payment_reversed', v_loan.id,
        format('%s undid a payment of %s', v_lender, private.money(v_amount)),
        coalesce('Reason: ' || v_reason, ''), v_key || v_loan.borrower_id);

    when 'loan_completed' then
      perform private.notify(v_loan.borrower_id, 'loan_completed', v_loan.id,
        'All paid back', format('You''ve paid %s back in full. Nice work.', v_lender), v_key || v_loan.borrower_id);
      perform private.notify(v_loan.lender_id, 'loan_completed', v_loan.id,
        'All paid back', format('%s has paid you back in full.', v_borrower), v_key || v_loan.lender_id);

    when 'loan_written_off' then
      perform private.notify(v_loan.borrower_id, 'loan_forgiven', v_loan.id,
        format('%s forgave the rest of what you owe', v_lender),
        format('%s was written off. Nothing more is owed.', private.money(v_amount)),
        v_key || v_loan.borrower_id);

    else
      null; -- other events (e.g. existing_debt_proposed, loan_reopened) don't notify
  end case;

  return new;
end;
$$;


-- 3. Reminder times
create table public.reminder_rules (
  id              uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.lending_relationships (id) on delete cascade,
  -- Days from the due date: -1 = the day before, 0 = on the day, 2 = two days late.
  days_from_due   smallint not null check (days_from_due between -14 and 60),
  send_hour       smallint not null check (send_hour between 0 and 23),
  constraint reminder_rules_unique unique (relationship_id, days_from_due, send_hour)
);

create index reminder_rules_relationship_idx on public.reminder_rules (relationship_id);

revoke all on public.reminder_rules from anon, authenticated;
grant select on public.reminder_rules to authenticated;
alter table public.reminder_rules enable row level security;
create policy "Both people see the reminder times"
  on public.reminder_rules for select to authenticated
  using (private.is_party_to(relationship_id));

-- Keep reminding while late: every N days at this hour, after the last rule.
-- Null = don't repeat.
alter table public.reminder_settings add column late_every_days smallint
  check (late_every_days is null or late_every_days between 1 and 30);
alter table public.reminder_settings add column late_hour smallint not null default 9
  check (late_hour between 0 and 23);

-- Carry over what people set under ADR-0018.
insert into public.reminder_rules (relationship_id, days_from_due, send_hour)
select relationship_id, d, send_hour
from public.reminder_settings s
cross join lateral (values (-1, s.day_before), (0, s.on_the_day), (1, s.when_overdue)) v(d, enabled)
where v.enabled;
update public.reminder_settings
set late_every_days = case when when_overdue then overdue_every_days end,
    late_hour = send_hour;

alter table public.reminder_settings
  drop column send_hour, drop column day_before, drop column on_the_day,
  drop column when_overdue, drop column overdue_every_days;

drop function public.save_reminder_settings(uuid, int, boolean, boolean, boolean, int);

-- A row in reminder_settings means the lender has chosen; with none, the
-- defaults apply: 9am the day before, on the day and the day after, then
-- weekly while late.
create function public.save_reminder_settings(
  p_relationship_id uuid,
  p_rules           jsonb,
  p_late_every_days int default null,
  p_late_hour       int default 9
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
     or p_late_hour is null or p_late_hour not between 0 and 23 then
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

  insert into public.reminder_settings as s (relationship_id, late_every_days, late_hour)
  values (p_relationship_id, p_late_every_days, p_late_hour)
  on conflict (relationship_id) do update set
    late_every_days = excluded.late_every_days,
    late_hour = excluded.late_hour,
    updated_at = now();
end;
$$;

revoke all on function public.save_reminder_settings(uuid, jsonb, int, int) from public, anon;
grant execute on function public.save_reminder_settings(uuid, jsonb, int, int) to authenticated;


-- Reminder wording for one instalment, by how many days from its due date.
create function private.reminder_text(p_days int, p_remaining bigint, p_lender text, p_due date)
returns table (kind text, title text, body text)
language sql
immutable
set search_path = ''
as $$
  select
    case when p_days < -1 then 'due_soon' when p_days = -1 then 'due_tomorrow'
         when p_days = 0 then 'due_today' else 'overdue' end,
    case when p_days < -1 then format('%s due to %s in %s days', private.money(p_remaining), p_lender, -p_days)
         when p_days = -1 then format('%s due to %s tomorrow', private.money(p_remaining), p_lender)
         when p_days = 0 then format('%s due to %s today', private.money(p_remaining), p_lender)
         else format('%s to %s is overdue', private.money(p_remaining), p_lender) end,
    case when p_days < 0 then format('Due %s. Tap "I''ve paid" in Kinvo once you''ve paid.', private.short_date(p_due))
         when p_days = 0 then 'Tap "I''ve paid" in Kinvo once you''ve paid.'
         else format('It was due %s. Pay what you can and let them know in Kinvo.', private.short_date(p_due)) end;
$$;
revoke all on function private.reminder_text(int, bigint, text, date) from public, anon, authenticated;

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
  for r in
    select l.id as loan_id, l.lender_id, l.borrower_id, l.relationship_id,
           le.display_name as lender_name, bo.display_name as borrower_name,
           p.instalment_id, p.due_on, p.amount_cents - p.paid_cents as remaining,
           s.relationship_id is not null as customised,
           case when s.relationship_id is null then 7 else s.late_every_days end as late_every_days,
           coalesce(s.late_hour, 9) as late_hour
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
    if r.late_every_days is not null and v_days >= 1 and v_hour >= r.late_hour then
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
    if v_days >= 1 and (v_days - 1) % 7 = 0 and v_hour >= 9 then
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
