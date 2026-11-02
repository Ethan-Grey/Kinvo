-- =============================================================================
-- M6: Notifications (ADR-0013)
--
--   audit_events ──trigger──▶ notifications (outbox) ◀── hourly reminders
--                                    │
--                     send-notifications Edge Function (email)
--                     and the in-app bell both read from here
--
-- * Every action already writes an audit event, so one trigger decides who
--   hears about what. No action can forget to notify.
-- * Titles and bodies are written here, once, so email and the app say the
--   same thing.
-- * dedupe_key makes every notification idempotent: re-running the reminder
--   job, or a retry, never creates a second copy.
-- =============================================================================

create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  recipient_id     uuid not null references public.profiles (id) on delete cascade,
  kind             text not null,
  loan_id          uuid references public.loans (id) on delete cascade,
  title            text not null,
  body             text not null default '',
  link_path        text not null default '/',
  dedupe_key       text not null unique,
  created_at       timestamptz not null default now(),
  read_at          timestamptz,
  email_status     text not null default 'pending'
                   check (email_status in ('pending', 'sending', 'sent', 'failed')),
  email_attempts   int not null default 0,
  email_sent_at    timestamptz,
  email_last_error text
);

create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_pending_email_idx on public.notifications (created_at) where email_status in ('pending', 'sending');

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
alter table public.notifications enable row level security;

create policy "Users see their own notifications"
  on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));


-- -----------------------------------------------------------------------------
-- Formatting helpers (NZ style): $1,234.50 and "Mon 9 Nov"
-- -----------------------------------------------------------------------------
create function private.money(p_cents bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select '$' || to_char(p_cents / 100.0, 'FM999,999,990.00');
$$;

create function private.short_date(p_date date)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_date, 'FMDy FMDD Mon');
$$;

create function private.notify(
  p_recipient uuid,
  p_kind      text,
  p_loan_id   uuid,
  p_title     text,
  p_body      text,
  p_dedupe    text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, kind, loan_id, title, body, link_path, dedupe_key)
  values (
    p_recipient, p_kind, p_loan_id, p_title, coalesce(p_body, ''),
    case when p_loan_id is null then '/' else '/loans/' || p_loan_id end,
    p_dedupe
  )
  on conflict (dedupe_key) do nothing;
$$;


-- =============================================================================
-- Event notifications: one trigger on the audit log
-- =============================================================================
create function private.notify_from_event()
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
        format('%s asked to borrow %s', v_borrower, private.money(v_principal)),
        'Open Kinvo to accept, suggest changes, or decline.', v_key || v_loan.lender_id);

    when 'loan_offered' then
      perform private.notify(v_loan.borrower_id, 'loan_offered', v_loan.id,
        format('%s offered to lend you %s', v_lender, private.money(v_principal)),
        format('You''d repay %s in total. Open Kinvo to accept, suggest changes, or decline.', private.money(v_total)),
        v_key || v_loan.borrower_id);

    when 'terms_proposed' then
      perform private.notify(v_other_of, 'counter_offer', v_loan.id,
        format('%s suggested different terms',
          case when v_other_of = v_loan.lender_id then v_borrower else v_lender end),
        format('New proposal: borrow %s, repay %s. Open Kinvo to reply.', private.money(v_principal), private.money(v_total)),
        v_key || v_other_of);

    when 'terms_accepted' then
      if v_other_of = v_loan.lender_id then
        perform private.notify(v_loan.lender_id, 'terms_accepted', v_loan.id,
          format('%s accepted the loan', v_borrower),
          format('Send them %s, then tap "Confirm money sent" in Kinvo to start the loan.', private.money(v_principal)),
          v_key || v_loan.lender_id);
      else
        perform private.notify(v_loan.borrower_id, 'terms_accepted', v_loan.id,
          format('%s accepted your request', v_lender),
          format('They''ll send you %s soon. The loan starts once they confirm it''s sent.', private.money(v_principal)),
          v_key || v_loan.borrower_id);
      end if;

    when 'existing_debt_confirmed' then
      perform private.notify(v_loan.lender_id, 'existing_debt_confirmed', v_loan.id,
        format('%s confirmed their existing debt', v_borrower),
        format('%s is now being tracked in Kinvo.', private.money(v_total)), v_key || v_loan.lender_id);

    when 'loan_rejected' then
      perform private.notify(v_other_of, 'loan_declined', v_loan.id,
        format('%s declined the loan proposal',
          case when v_other_of = v_loan.lender_id then v_borrower else v_lender end),
        coalesce('Their note: ' || (new.payload ->> 'note'), ''), v_key || v_other_of);

    when 'loan_withdrawn' then
      perform private.notify(v_other_of, 'loan_cancelled', v_loan.id,
        format('%s cancelled the loan',
          case when v_other_of = v_loan.lender_id then v_borrower else v_lender end),
        coalesce('Their note: ' || (new.payload ->> 'note'), 'No money was sent.'), v_key || v_other_of);

    when 'funds_confirmed' then
      select i.due_on, i.amount_cents into v_first_due
      from public.instalments i where i.terms_id = v_loan.current_terms_id order by i.sequence limit 1;
      perform private.notify(v_loan.borrower_id, 'funds_sent', v_loan.id,
        format('%s sent you %s', v_lender, private.money(v_principal)),
        format('Your loan has started. First payment: %s due %s.',
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
        'Loan fully repaid', format('You''ve repaid %s in full. Nice work.', v_lender), v_key || v_loan.borrower_id);
      perform private.notify(v_loan.lender_id, 'loan_completed', v_loan.id,
        'Loan fully repaid', format('%s has repaid you in full.', v_borrower), v_key || v_loan.lender_id);

    when 'loan_written_off' then
      perform private.notify(v_loan.borrower_id, 'loan_forgiven', v_loan.id,
        format('%s forgave the rest of your loan', v_lender),
        format('%s was written off. Nothing more is owed on this loan.', private.money(v_amount)),
        v_key || v_loan.borrower_id);

    else
      null; -- other events (e.g. existing_debt_proposed, loan_reopened) don't notify
  end case;

  return new;
end;
$$;

create trigger notify_on_audit_event
  after insert on public.audit_events
  for each row execute function private.notify_from_event();


-- =============================================================================
-- Reminders (ADR-0013)
--
-- Runs hourly; does nothing before 9am NZ, then queues today's reminders.
-- dedupe_key includes the instalment and day, so each goes out once.
--   * borrower: the day before and the day a payment is due
--   * borrower and lender: the day after it's missed, then weekly until paid
-- =============================================================================
create function private.queue_reminders(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local   timestamp := p_now at time zone 'Pacific/Auckland';
  v_today   date := v_local::date;
  r         record;
  v_days    int;
begin
  if extract(hour from v_local) < 9 then
    return;
  end if;

  for r in
    select l.id as loan_id, l.lender_id, l.borrower_id,
           le.display_name as lender_name, bo.display_name as borrower_name,
           p.instalment_id, p.due_on, p.amount_cents - p.paid_cents as remaining
    from public.loans l
    join public.profiles le on le.id = l.lender_id
    join public.profiles bo on bo.id = l.borrower_id
    cross join lateral private.instalment_progress(l.id) p
    where l.status = 'active' and p.paid_cents < p.amount_cents
  loop
    v_days := v_today - r.due_on;

    if v_days = -1 then
      perform private.notify(r.borrower_id, 'due_tomorrow', r.loan_id,
        format('%s due to %s tomorrow', private.money(r.remaining), r.lender_name),
        format('Due %s. Tap "I''ve paid" in Kinvo once you''ve paid.', private.short_date(r.due_on)),
        'due_tomorrow:' || r.instalment_id);
    elsif v_days = 0 then
      perform private.notify(r.borrower_id, 'due_today', r.loan_id,
        format('%s due to %s today', private.money(r.remaining), r.lender_name),
        'Tap "I''ve paid" in Kinvo once you''ve paid.',
        'due_today:' || r.instalment_id);
    elsif v_days >= 1 and (v_days - 1) % 7 = 0 then
      perform private.notify(r.borrower_id, 'overdue', r.loan_id,
        format('%s to %s is overdue', private.money(r.remaining), r.lender_name),
        format('It was due %s. Pay what you can and let them know in Kinvo.', private.short_date(r.due_on)),
        'overdue:' || r.instalment_id || ':' || v_days || ':' || r.borrower_id);
      perform private.notify(r.lender_id, 'borrower_overdue', r.loan_id,
        format('%s''s payment of %s is overdue', r.borrower_name, private.money(r.remaining)),
        format('It was due %s (%s day%s ago).', private.short_date(r.due_on), v_days, case when v_days = 1 then '' else 's' end),
        'overdue:' || r.instalment_id || ':' || v_days || ':' || r.lender_id);
    end if;
  end loop;
end;
$$;


-- =============================================================================
-- In-app: mark notifications as read
-- =============================================================================
create function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
  set read_at = now()
  where recipient_id = (select auth.uid())
    and read_at is null
    and (p_ids is null or id = any (p_ids));
$$;


-- =============================================================================
-- Email outbox (used only by the send-notifications Edge Function, as service_role)
-- =============================================================================

-- Claim up to p_limit emails. SKIP LOCKED lets overlapping runs share the
-- work without sending anything twice. Stuck "sending" rows are retried
-- after 10 minutes. Gives up after 5 attempts.
create function public.claim_notification_emails(p_limit int default 20)
returns table (id uuid, email text, display_name text, title text, body text, link_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select n.id
    from public.notifications n
    where n.email_attempts < 5
      and (n.email_status = 'pending'
           or (n.email_status = 'sending' and n.created_at < now() - interval '10 minutes'))
    order by n.created_at
    limit greatest(least(coalesce(p_limit, 20), 100), 1)
    for update skip locked
  ),
  claimed as (
    update public.notifications n
    set email_status = 'sending', email_attempts = n.email_attempts + 1
    from picked
    where n.id = picked.id
    returning n.id, n.recipient_id, n.title, n.body, n.link_path
  )
  select c.id, p.email, p.display_name, c.title, c.body, c.link_path
  from claimed c join public.profiles p on p.id = c.recipient_id;
end;
$$;

create function public.finish_notification_email(p_id uuid, p_ok boolean, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
  set email_status = case
        when p_ok then 'sent'
        when email_attempts >= 5 then 'failed'
        else 'pending'
      end,
      email_sent_at = case when p_ok then now() end,
      email_last_error = case when p_ok then null else left(p_error, 500) end
  where id = p_id;
$$;


-- Calls the Edge Function. The URL and key come from Supabase Vault, set once
-- during setup (docs/setup.md), so nothing secret is in this repository.
create function private.trigger_email_sender()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'kinvo_send_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'kinvo_send_key';
  if v_url is null or v_key is null then
    return; -- not configured yet
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- Schedules (only where pg_cron is available, e.g. not in plain local Postgres)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
    perform cron.schedule('kinvo-queue-reminders', '5 * * * *', 'select private.queue_reminders()');
    perform cron.schedule('kinvo-send-emails', '*/5 * * * *', 'select private.trigger_email_sender()');
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.shares_relationship_with(uuid),
  private.is_party_to(uuid),
  private.is_loan_party(uuid),
  private.is_terms_party(uuid)
to authenticated;

revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- The outbox functions are for the server-side sender only.
revoke execute on function
  public.claim_notification_emails(int),
  public.finish_notification_email(uuid, boolean, text)
from public, anon, authenticated;
grant execute on function
  public.claim_notification_emails(int),
  public.finish_notification_email(uuid, boolean, text)
to service_role;
