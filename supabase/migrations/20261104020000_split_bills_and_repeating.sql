-- =============================================================================
-- Split bills and repeating debts (ADR-0020)
--
-- Split bill: the person who paid shares a bill with one or more people. Each
-- gets their own debt (kind 'bill') for their share, due on one date. Once they
-- accept, it's active straight away: the money was already spent on the day
-- the bill was paid (stored in originally_lent_on, like an existing debt).
--
-- Repeating debt: e.g. a rent share. The person owed proposes it once, the
-- other accepts once, then each occurrence is created automatically as an
-- active debt (kind 'repeating') due on its date.
-- =============================================================================

alter table public.loans drop constraint loans_kind_check;
alter table public.loans add constraint loans_kind_check
  check (kind in ('new', 'existing_debt', 'bill', 'repeating'));
alter table public.loans drop constraint loans_existing_debt_has_date;
alter table public.loans add constraint loans_dated_kinds_have_date
  check ((kind in ('existing_debt', 'bill', 'repeating')) = (originally_lent_on is not null));
comment on column public.loans.originally_lent_on is
  'When the money was spent or lent: before Kinvo (existing_debt), the bill date (bill), or the occurrence date (repeating).';


-- =============================================================================
-- 1. Split bills
-- =============================================================================
create function public.create_split_bill(
  p_description text,
  p_total_cents bigint,
  p_paid_on     date,
  p_due_on      date,
  p_shares      jsonb   -- [{ "relationship_id": uuid, "amount_cents": int }]
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid := private.require_user();
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_item        jsonb;
  v_rel         public.lending_relationships;
  v_amount      bigint;
  v_sum         bigint := 0;
  v_loan_id     uuid;
  v_ids         uuid[] := '{}';
begin
  if v_description is null or char_length(v_description) > 200 then
    raise exception 'invalid_reason';
  elsif p_total_cents is null or p_total_cents < 1 or p_total_cents > 10000000 then
    raise exception 'invalid_principal';
  elsif p_paid_on is null or p_paid_on > private.nz_today() then
    raise exception 'invalid_sent_date';
  elsif p_due_on is null or p_due_on < private.nz_today() then
    raise exception 'schedule_date_in_past';
  elsif jsonb_typeof(p_shares) is distinct from 'array'
     or jsonb_array_length(p_shares) not between 1 and 10 then
    raise exception 'invalid_split';
  end if;

  for v_item in select value from jsonb_array_elements(p_shares) loop
    begin
      v_amount := (v_item ->> 'amount_cents')::bigint;
    exception when others then
      raise exception 'invalid_split';
    end;
    if v_amount is null or v_amount < 1 then
      raise exception 'invalid_split';
    end if;
    v_sum := v_sum + v_amount;
  end loop;
  if v_sum > p_total_cents then
    raise exception 'split_more_than_total';
  end if;

  for v_item in select value from jsonb_array_elements(p_shares) loop
    v_rel := private.lock_relationship_as_lender((v_item ->> 'relationship_id')::uuid, v_user_id);
    v_amount := (v_item ->> 'amount_cents')::bigint;

    insert into public.loans (relationship_id, lender_id, borrower_id, created_by, reason, kind, originally_lent_on)
    values (v_rel.id, v_rel.lender_id, v_rel.borrower_id, v_user_id, v_description, 'bill', p_paid_on)
    returning id into v_loan_id;

    perform private.insert_terms(
      v_loan_id, v_user_id, v_amount, 0,
      jsonb_build_array(jsonb_build_object('due_on', p_due_on, 'amount_cents', v_amount)),
      '', '',
      format('Your share of %s (%s in total).', v_description, private.money(p_total_cents)),
      false
    );
    perform private.log_loan_event(v_loan_id, 'bill_shared',
      jsonb_build_object('total_cents', p_total_cents, 'share_cents', v_amount));
    v_ids := v_ids || v_loan_id;
  end loop;

  return v_ids;
end;
$$;

-- The receipt goes in each share's own folder (so only that pair can see it),
-- uploaded after the shares exist.
create function public.attach_bill_receipt(p_loan_id uuid, p_receipt_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_loan    public.loans := private.lock_loan_for_party(p_loan_id, v_user_id);
begin
  if v_loan.lender_id <> v_user_id then
    raise exception 'lender_only';
  elsif v_loan.kind <> 'bill' then
    raise exception 'invalid_receipt';
  end if;
  update public.loans
  set funds_receipt_path = private.require_receipt(p_loan_id, p_receipt_path)
  where id = p_loan_id;
end;
$$;

revoke all on function public.create_split_bill(text, bigint, date, date, jsonb) from public, anon;
grant execute on function public.create_split_bill(text, bigint, date, date, jsonb) to authenticated;
revoke all on function public.attach_bill_receipt(uuid, text) from public, anon;
grant execute on function public.attach_bill_receipt(uuid, text) to authenticated;

-- Accepting a bill share (like an existing debt) makes it active straight away.
create or replace function public.accept_terms(
  p_loan_id    uuid,
  p_terms_id   uuid,
  p_terms_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_loan    public.loans := private.lock_loan_for_party(p_loan_id, v_user_id);
  v_terms   public.loan_terms;
begin
  if v_loan.status <> 'negotiating' then
    raise exception 'loan_not_negotiating';
  elsif v_loan.current_terms_id is distinct from p_terms_id then
    raise exception 'terms_changed';
  end if;

  select * into v_terms from public.loan_terms t where t.id = p_terms_id;

  if v_terms.terms_hash is distinct from p_terms_hash
     or v_terms.terms_hash is distinct from private.compute_terms_hash(p_terms_id) then
    raise exception 'terms_changed';
  elsif v_terms.proposed_by = v_user_id then
    raise exception 'cannot_accept_own_terms';
  end if;

  insert into public.term_acceptances (terms_id, accepted_by, terms_hash)
  values (p_terms_id, v_user_id, v_terms.terms_hash);

  if v_loan.kind in ('existing_debt', 'bill') then
    update public.loans
    set status = 'active', agreed_at = now(), funds_sent_at = now(), funds_sent_on = v_loan.originally_lent_on
    where id = p_loan_id;
    perform private.log_loan_event(
      p_loan_id, case v_loan.kind when 'bill' then 'bill_accepted' else 'existing_debt_confirmed' end,
      jsonb_build_object('version', v_terms.version, 'terms_hash', v_terms.terms_hash)
    );
  else
    update public.loans set status = 'agreed', agreed_at = now() where id = p_loan_id;
    perform private.log_loan_event(
      p_loan_id, 'terms_accepted',
      jsonb_build_object('version', v_terms.version, 'terms_hash', v_terms.terms_hash)
    );
  end if;
end;
$$;

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

    when 'bill_shared' then
      perform private.notify(v_loan.borrower_id, 'bill_shared', v_loan.id,
        format('%s split %s with you', v_lender, coalesce(v_loan.reason, 'a bill')),
        format('Your share is %s. Open Kinvo to accept it.', private.money(v_total)), v_key || v_loan.borrower_id);

    when 'bill_accepted' then
      perform private.notify(v_loan.lender_id, 'bill_accepted', v_loan.id,
        format('%s accepted their share', v_borrower),
        format('%s for %s is now being tracked.', private.money(v_total), coalesce(v_loan.reason, 'the bill')),
        v_key || v_loan.lender_id);

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


-- =============================================================================
-- 2. Repeating debts
-- =============================================================================
create table public.repeating_debts (
  id              uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.lending_relationships (id) on delete cascade,
  created_by      uuid not null references public.profiles (id) on delete cascade,
  description     text not null check (char_length(description) between 1 and 200),
  amount_cents    bigint not null check (amount_cents between 1 and 10000000),
  frequency       text not null check (frequency in ('weekly', 'fortnightly', 'monthly')),
  first_on        date not null,
  end_on          date check (end_on is null or end_on >= first_on),
  status          text not null default 'proposed'
                  check (status in ('proposed', 'active', 'paused', 'stopped', 'declined')),
  -- How many have been created; the next date is worked out from first_on.
  created_count   int not null default 0,
  next_on         date,
  accepted_at     timestamptz,
  stopped_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index repeating_debts_relationship_idx on public.repeating_debts (relationship_id);
create index repeating_debts_due_idx on public.repeating_debts (next_on) where status = 'active';

alter table public.loans add column repeating_debt_id uuid references public.repeating_debts (id) on delete set null;
create index loans_repeating_debt_idx on public.loans (repeating_debt_id) where repeating_debt_id is not null;

revoke all on public.repeating_debts from anon, authenticated;
grant select on public.repeating_debts to authenticated;
alter table public.repeating_debts enable row level security;
create policy "Both people see repeating debts"
  on public.repeating_debts for select to authenticated
  using (private.is_party_to(relationship_id));

-- The n-th date of a series (0 = the first). Monthly is counted from the
-- first date, so the 31st becomes the last day of shorter months.
create function private.series_date(p_first_on date, p_frequency text, p_n int)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_frequency
    when 'weekly'      then p_first_on + 7 * p_n
    when 'fortnightly' then p_first_on + 14 * p_n
    else (p_first_on + make_interval(months => p_n))::date
  end;
$$;
revoke all on function private.series_date(date, text, int) from public, anon, authenticated;

-- The first index whose date is on or after p_from.
create function private.series_index_from(p_first_on date, p_frequency text, p_from date)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n int := 0;
begin
  while private.series_date(p_first_on, p_frequency, v_n) < p_from loop
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.series_index_from(date, text, date) from public, anon, authenticated;

-- A notification that opens a given page (private.notify links to the loan).
create function private.notify_link(
  p_recipient uuid, p_kind text, p_title text, p_body text, p_dedupe text, p_link text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, kind, loan_id, title, body, link_path, dedupe_key)
  values (p_recipient, p_kind, null, p_title, coalesce(p_body, ''), p_link, p_dedupe)
  on conflict (dedupe_key) do nothing;
$$;
revoke all on function private.notify_link(uuid, text, text, text, text, text) from public, anon, authenticated;

create function private.lock_repeating(p_id uuid, p_user_id uuid)
returns public.repeating_debts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series public.repeating_debts;
begin
  select s.* into v_series from public.repeating_debts s
  join public.lending_relationships r on r.id = s.relationship_id
  where s.id = p_id and p_user_id in (r.lender_id, r.borrower_id)
  for update of s;
  if not found then
    raise exception 'repeating_not_found';
  end if;
  return v_series;
end;
$$;
revoke all on function private.lock_repeating(uuid, uuid) from public, anon, authenticated;

create function private.repeating_parties(p_series public.repeating_debts)
returns table (lender_id uuid, borrower_id uuid, lender_name text, borrower_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.lender_id, r.borrower_id, le.display_name, bo.display_name
  from public.lending_relationships r
  join public.profiles le on le.id = r.lender_id
  join public.profiles bo on bo.id = r.borrower_id
  where r.id = p_series.relationship_id;
$$;
revoke all on function private.repeating_parties(public.repeating_debts) from public, anon, authenticated;

create function private.frequency_word(p_frequency text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_frequency when 'weekly' then 'every week' when 'fortnightly' then 'every fortnight' else 'every month' end;
$$;
revoke all on function private.frequency_word(text) from public, anon, authenticated;

create function public.propose_repeating_debt(
  p_relationship_id uuid,
  p_description     text,
  p_amount_cents    bigint,
  p_frequency       text,
  p_first_on        date,
  p_end_on          date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_rel     public.lending_relationships := private.lock_relationship_as_lender(p_relationship_id, v_user_id);
  v_desc    text := nullif(btrim(coalesce(p_description, '')), '');
  v_id      uuid;
  v_lender  text;
begin
  if v_desc is null or char_length(v_desc) > 200 then
    raise exception 'invalid_reason';
  elsif p_amount_cents is null or p_amount_cents not between 1 and 10000000 then
    raise exception 'invalid_amount';
  elsif p_frequency is null or p_frequency not in ('weekly', 'fortnightly', 'monthly') then
    raise exception 'invalid_setting';
  elsif p_first_on is null or p_first_on < private.nz_today() then
    raise exception 'schedule_date_in_past';
  elsif p_end_on is not null and p_end_on < p_first_on then
    raise exception 'invalid_end_date';
  end if;

  insert into public.repeating_debts (relationship_id, created_by, description, amount_cents, frequency, first_on, end_on)
  values (p_relationship_id, v_user_id, v_desc, p_amount_cents, p_frequency, p_first_on, p_end_on)
  returning id into v_id;

  select display_name into v_lender from public.profiles where id = v_user_id;
  perform private.notify_link(v_rel.borrower_id, 'repeating_proposed',
    format('%s set up %s: %s %s', v_lender, v_desc, private.money(p_amount_cents), private.frequency_word(p_frequency)),
    'Open Kinvo to accept or decline.', 'repeating_proposed:' || v_id, '/repeating/' || v_id);

  insert into public.audit_events (actor_id, relationship_id, event_type, payload)
  values (v_user_id, p_relationship_id, 'repeating_proposed',
    jsonb_build_object('repeating_debt_id', v_id, 'amount_cents', p_amount_cents, 'frequency', p_frequency));
  return v_id;
end;
$$;

-- The person who'd owe accepts or declines, once for the whole series.
create function public.respond_repeating_debt(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_series  public.repeating_debts := private.lock_repeating(p_id, v_user_id);
  v_p       record;
  v_n       int;
begin
  select * into v_p from private.repeating_parties(v_series);
  if v_p.borrower_id <> v_user_id then
    raise exception 'borrower_only';
  elsif v_series.status <> 'proposed' then
    raise exception 'repeating_not_proposed';
  end if;

  if p_accept then
    v_n := private.series_index_from(v_series.first_on, v_series.frequency, private.nz_today());
    update public.repeating_debts
    set status = 'active', accepted_at = now(), created_count = v_n,
        next_on = private.series_date(first_on, frequency, v_n)
    where id = p_id;
  else
    update public.repeating_debts set status = 'declined', stopped_at = now(), next_on = null where id = p_id;
  end if;

  perform private.notify_link(v_p.lender_id, case when p_accept then 'repeating_accepted' else 'repeating_declined' end,
    format('%s %s %s', v_p.borrower_name, case when p_accept then 'accepted' else 'declined' end, v_series.description),
    case when p_accept then format('%s %s, starting %s.', private.money(v_series.amount_cents),
      private.frequency_word(v_series.frequency), private.short_date(v_series.first_on)) else '' end,
    'repeating_response:' || p_id, '/repeating/' || p_id);

  insert into public.audit_events (actor_id, relationship_id, event_type, payload)
  values (v_user_id, v_series.relationship_id, case when p_accept then 'repeating_accepted' else 'repeating_declined' end,
    jsonb_build_object('repeating_debt_id', p_id));

  -- If the first one is due today, create it now rather than waiting an hour.
  if p_accept then
    perform private.create_repeating_debts();
  end if;
end;
$$;

-- The person owed changes the amount; only future ones change.
create function public.change_repeating_amount(p_id uuid, p_amount_cents bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_series  public.repeating_debts := private.lock_repeating(p_id, v_user_id);
  v_p       record;
begin
  select * into v_p from private.repeating_parties(v_series);
  if v_p.lender_id <> v_user_id then
    raise exception 'lender_only';
  elsif v_series.status not in ('active', 'paused', 'proposed') then
    raise exception 'repeating_stopped';
  elsif p_amount_cents is null or p_amount_cents not between 1 and 10000000 then
    raise exception 'invalid_amount';
  end if;

  update public.repeating_debts set amount_cents = p_amount_cents where id = p_id;
  perform private.notify_link(v_p.borrower_id, 'repeating_changed',
    format('%s changed %s to %s', v_p.lender_name, v_series.description, private.money(p_amount_cents)),
    'This applies from the next one. Earlier ones stay the same.',
    'repeating_changed:' || p_id || ':' || gen_random_uuid(), '/repeating/' || p_id);
  insert into public.audit_events (actor_id, relationship_id, event_type, payload)
  values (v_user_id, v_series.relationship_id, 'repeating_changed',
    jsonb_build_object('repeating_debt_id', p_id, 'from_cents', v_series.amount_cents, 'to_cents', p_amount_cents));
end;
$$;

-- Pause or resume (person owed), stop (either person).
create function public.set_repeating_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_series  public.repeating_debts := private.lock_repeating(p_id, v_user_id);
  v_p       record;
  v_n       int;
  v_other   uuid;
begin
  select * into v_p from private.repeating_parties(v_series);
  v_other := case when v_user_id = v_p.lender_id then v_p.borrower_id else v_p.lender_id end;

  if v_series.status in ('stopped', 'declined') then
    raise exception 'repeating_stopped';
  elsif p_status = 'stopped' then
    update public.repeating_debts set status = 'stopped', stopped_at = now(), next_on = null where id = p_id;
  elsif v_p.lender_id <> v_user_id then
    raise exception 'lender_only';
  elsif p_status = 'paused' and v_series.status = 'active' then
    update public.repeating_debts set status = 'paused', next_on = null where id = p_id;
  elsif p_status = 'active' and v_series.status = 'paused' then
    -- Resuming skips anything missed while paused.
    v_n := greatest(v_series.created_count,
      private.series_index_from(v_series.first_on, v_series.frequency, private.nz_today()));
    update public.repeating_debts
    set status = 'active', created_count = v_n, next_on = private.series_date(first_on, frequency, v_n)
    where id = p_id;
  else
    raise exception 'invalid_setting';
  end if;

  perform private.notify_link(v_other, 'repeating_' || p_status,
    format('%s %s %s', case when v_user_id = v_p.lender_id then v_p.lender_name else v_p.borrower_name end,
      case p_status when 'stopped' then 'stopped' when 'paused' then 'paused' else 'restarted' end, v_series.description),
    '', 'repeating_status:' || p_id || ':' || gen_random_uuid(), '/repeating/' || p_id);
  insert into public.audit_events (actor_id, relationship_id, event_type, payload)
  values (v_user_id, v_series.relationship_id, 'repeating_' || p_status, jsonb_build_object('repeating_debt_id', p_id));
end;
$$;

revoke all on function public.propose_repeating_debt(uuid, text, bigint, text, date, date) from public, anon;
grant execute on function public.propose_repeating_debt(uuid, text, bigint, text, date, date) to authenticated;
revoke all on function public.respond_repeating_debt(uuid, boolean) from public, anon;
grant execute on function public.respond_repeating_debt(uuid, boolean) to authenticated;
revoke all on function public.change_repeating_amount(uuid, bigint) from public, anon;
grant execute on function public.change_repeating_amount(uuid, bigint) to authenticated;
revoke all on function public.set_repeating_status(uuid, text) from public, anon;
grant execute on function public.set_repeating_status(uuid, text) to authenticated;

-- Creates every occurrence that's due (runs hourly, and on accept).
create function private.create_repeating_debts(p_today date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today   date := coalesce(p_today, private.nz_today());
  s         record;
  v_loan_id uuid;
  v_terms   uuid;
begin
  for s in
    select d.*, r.lender_id, r.borrower_id, r.ended_at, le.display_name as lender_name
    from public.repeating_debts d
    join public.lending_relationships r on r.id = d.relationship_id
    join public.profiles le on le.id = r.lender_id
    where d.status = 'active' and d.next_on is not null and d.next_on <= v_today
    for update of d skip locked
  loop
    if s.ended_at is not null or (s.end_on is not null and s.next_on > s.end_on) then
      update public.repeating_debts set status = 'stopped', stopped_at = now(), next_on = null where id = s.id;
      continue;
    end if;

    insert into public.loans (
      relationship_id, lender_id, borrower_id, created_by, reason, kind, originally_lent_on, repeating_debt_id,
      status, agreed_at, funds_sent_at, funds_sent_on
    )
    values (
      s.relationship_id, s.lender_id, s.borrower_id, s.created_by, s.description, 'repeating', s.next_on, s.id,
      'negotiating', null, null, null
    )
    returning id into v_loan_id;

    v_terms := private.insert_terms(
      v_loan_id, s.lender_id, s.amount_cents, 0,
      jsonb_build_array(jsonb_build_object('due_on', s.next_on, 'amount_cents', s.amount_cents)),
      '', '', null, true
    );
    -- Agreed once for the whole series.
    insert into public.term_acceptances (terms_id, accepted_by, terms_hash)
    select v_terms, s.borrower_id, t.terms_hash from public.loan_terms t where t.id = v_terms;
    update public.loans
    set status = 'active', agreed_at = now(), funds_sent_at = now(), funds_sent_on = s.next_on
    where id = v_loan_id;

    insert into public.audit_events (actor_id, relationship_id, loan_id, event_type, payload)
    values (null, s.relationship_id, v_loan_id, 'repeating_created',
      jsonb_build_object('repeating_debt_id', s.id, 'occurrence', s.created_count));

    perform private.notify(s.borrower_id, 'repeating_created', v_loan_id,
      format('%s to %s for %s', private.money(s.amount_cents), s.lender_name, s.description),
      format('Due %s.', private.short_date(s.next_on)), 'repeating_created:' || s.id || ':' || s.created_count);

    update public.repeating_debts
    set created_count = s.created_count + 1,
        next_on = case
          when s.end_on is not null and private.series_date(s.first_on, s.frequency, s.created_count + 1) > s.end_on then null
          else private.series_date(s.first_on, s.frequency, s.created_count + 1) end,
        status = case
          when s.end_on is not null and private.series_date(s.first_on, s.frequency, s.created_count + 1) > s.end_on then 'stopped'
          else 'active' end
    where id = s.id;
  end loop;
end;
$$;
revoke all on function private.create_repeating_debts(date) from public, anon, authenticated;

-- Run it from the hourly job.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('kinvo-repeating-debts', '2 * * * *', 'select private.create_repeating_debts()');
  end if;
end $$;
