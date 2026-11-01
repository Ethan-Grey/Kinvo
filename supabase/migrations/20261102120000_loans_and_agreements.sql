-- =============================================================================
-- M3: Loans, versioned terms and agreement acceptance
--
-- Lifecycle (docs/architecture.md):
--   negotiating ──accept──▶ agreed ──funds confirmed──▶ active
--        │  ▲ counter-offer      │
--        │  └────────────────────┘ (new terms version while negotiating)
--        ├──reject──▶ rejected
--        └──withdraw─▶ withdrawn   (also allowed from agreed, before funds)
--
-- Rules enforced here, not in the app:
--   * Terms versions are immutable. A counter-offer inserts a new version.
--   * Proposing a version counts as the proposer's acceptance of it.
--   * Instalments must add up exactly to principal + charge (CA-03).
--   * Accepting requires the exact terms hash the user was shown, so a
--     counter-offer that arrives while someone is reading can't be accepted
--     by mistake.
--   * A loan becomes active only when the lender confirms funds were sent.
-- =============================================================================

create type public.loan_status as enum (
  'negotiating', 'agreed', 'active', 'completed', 'rejected', 'withdrawn', 'written_off'
);

create type public.payment_method as enum ('bank_transfer', 'cash', 'other');


-- -----------------------------------------------------------------------------
-- loans: the envelope for one loan; terms live in loan_terms
-- -----------------------------------------------------------------------------
create table public.loans (
  id               uuid primary key default gen_random_uuid(),
  relationship_id  uuid not null references public.lending_relationships (id) on delete restrict,
  -- Copied from the relationship so access checks don't need a join.
  lender_id        uuid not null references public.profiles (id) on delete restrict,
  borrower_id      uuid not null references public.profiles (id) on delete restrict,
  created_by       uuid not null references public.profiles (id) on delete restrict,
  status           public.loan_status not null default 'negotiating',
  reason           text check (reason is null or char_length(reason) <= 500),
  current_terms_id uuid,
  agreed_at        timestamptz,
  funds_sent_at    timestamptz,
  funds_sent_on    date,
  funds_method     public.payment_method,
  funds_reference  text check (funds_reference is null or char_length(funds_reference) <= 100),
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),

  constraint loans_parties_differ check (lender_id <> borrower_id),
  constraint loans_funds_only_when_active check (
    (status in ('active', 'completed', 'written_off')) = (funds_sent_at is not null)
  ),
  constraint loans_agreed_at_set check (
    status in ('negotiating', 'rejected') or status = 'withdrawn' or agreed_at is not null
  )
);

create index loans_lender_id_idx on public.loans (lender_id);
create index loans_borrower_id_idx on public.loans (borrower_id);
create index loans_relationship_id_idx on public.loans (relationship_id);


-- -----------------------------------------------------------------------------
-- loan_terms: one row per proposal. Never updated.
-- -----------------------------------------------------------------------------
create table public.loan_terms (
  id              uuid primary key default gen_random_uuid(),
  loan_id         uuid not null references public.loans (id) on delete restrict,
  version         int not null check (version > 0),
  proposed_by     uuid not null references public.profiles (id) on delete restrict,
  principal_cents bigint not null check (principal_cents between 1 and 10000000),
  charge_cents    bigint not null check (charge_cents between 0 and 10000000),
  late_terms      text not null default '' check (char_length(late_terms) <= 1000),
  conditions      text not null default '' check (char_length(conditions) <= 2000),
  -- A note to the other person about this proposal, e.g. "Can we do fortnightly?"
  message         text check (message is null or char_length(message) <= 500),
  terms_hash      text,
  created_at      timestamptz not null default now(),

  constraint loan_terms_version_unique unique (loan_id, version)
);

alter table public.loans
  add constraint loans_current_terms_fk foreign key (current_terms_id) references public.loan_terms (id);


-- -----------------------------------------------------------------------------
-- instalments: the repayment schedule for one terms version
-- -----------------------------------------------------------------------------
create table public.instalments (
  id           uuid primary key default gen_random_uuid(),
  terms_id     uuid not null references public.loan_terms (id) on delete restrict,
  sequence     int not null check (sequence > 0),
  due_on       date not null,
  amount_cents bigint not null check (amount_cents > 0),

  constraint instalments_sequence_unique unique (terms_id, sequence)
);


-- -----------------------------------------------------------------------------
-- term_acceptances: who accepted which version, and exactly what they saw
-- -----------------------------------------------------------------------------
create table public.term_acceptances (
  id          uuid primary key default gen_random_uuid(),
  terms_id    uuid not null references public.loan_terms (id) on delete restrict,
  accepted_by uuid not null references public.profiles (id) on delete restrict,
  terms_hash  text not null,
  accepted_at timestamptz not null default now(),

  constraint term_acceptances_once unique (terms_id, accepted_by)
);


-- Audit events can now belong to a loan.
alter table public.audit_events
  add column loan_id uuid references public.loans (id) on delete restrict;
create index audit_events_loan_id_idx on public.audit_events (loan_id);


-- -----------------------------------------------------------------------------
-- Privileges and Row Level Security: read-only for parties to the loan.
-- -----------------------------------------------------------------------------
revoke all on public.loans, public.loan_terms, public.instalments, public.term_acceptances
  from anon, authenticated;
grant select on public.loans, public.loan_terms, public.instalments, public.term_acceptances
  to authenticated;

create function private.is_loan_party(p_loan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.loans l
    where l.id = p_loan_id and (select auth.uid()) in (l.lender_id, l.borrower_id)
  );
$$;

create function private.is_terms_party(p_terms_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.loan_terms t
    join public.loans l on l.id = t.loan_id
    where t.id = p_terms_id and (select auth.uid()) in (l.lender_id, l.borrower_id)
  );
$$;

alter table public.loans enable row level security;
alter table public.loan_terms enable row level security;
alter table public.instalments enable row level security;
alter table public.term_acceptances enable row level security;

create policy "Parties see their loans"
  on public.loans for select to authenticated
  using ((select auth.uid()) in (lender_id, borrower_id));

create policy "Parties see their loans' terms"
  on public.loan_terms for select to authenticated
  using (private.is_loan_party(loan_id));

create policy "Parties see their loans' instalments"
  on public.instalments for select to authenticated
  using (private.is_terms_party(terms_id));

create policy "Parties see their loans' acceptances"
  on public.term_acceptances for select to authenticated
  using (private.is_terms_party(terms_id));

-- Audit events for a loan are visible to both parties (extends the M2 policy).
create policy "Parties see their loans' events"
  on public.audit_events for select to authenticated
  using (loan_id is not null and private.is_loan_party(loan_id));


-- =============================================================================
-- Internal helpers
-- =============================================================================

-- Today's date in New Zealand. Due dates are NZ calendar dates (NF-04).
create function private.nz_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Pacific/Auckland')::date;
$$;


-- Audit event for a loan.
create function private.log_loan_event(
  p_loan_id    uuid,
  p_event_type text,
  p_payload    jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (actor_id, relationship_id, loan_id, event_type, payload)
  select (select auth.uid()), l.relationship_id, l.id, p_event_type, p_payload
  from public.loans l
  where l.id = p_loan_id;
$$;


-- Lock a loan the caller is party to, or fail as if it doesn't exist.
create function private.lock_loan_for_party(p_loan_id uuid, p_user_id uuid)
returns public.loans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans l where l.id = p_loan_id for update;
  if not found or p_user_id not in (v_loan.lender_id, v_loan.borrower_id) then
    raise exception 'loan_not_found';
  end if;
  return v_loan;
end;
$$;


-- SHA-256 of a canonical description of a terms version. jsonb's text output
-- is deterministic (keys are sorted), so the same terms always give the same hash.
create function private.compute_terms_hash(p_terms_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      jsonb_build_object(
        'loan_id', t.loan_id,
        'version', t.version,
        'principal_cents', t.principal_cents,
        'charge_cents', t.charge_cents,
        'late_terms', t.late_terms,
        'conditions', t.conditions,
        'instalments', coalesce((
          select jsonb_agg(
                   jsonb_build_object('sequence', i.sequence, 'due_on', i.due_on, 'amount_cents', i.amount_cents)
                   order by i.sequence)
          from public.instalments i
          where i.terms_id = t.id
        ), '[]'::jsonb)
      )::text,
      'sha256'
    ),
    'hex'
  )
  from public.loan_terms t
  where t.id = p_terms_id;
$$;


-- Validate and insert a terms version with its schedule. The proposer
-- accepts it in the same step. Returns the new terms id.
--
-- p_instalments is a JSON array: [{"due_on": "2026-11-09", "amount_cents": 15000}, ...]
create function private.insert_terms(
  p_loan_id         uuid,
  p_proposed_by     uuid,
  p_principal_cents bigint,
  p_charge_cents    bigint,
  p_instalments     jsonb,
  p_late_terms      text,
  p_conditions      text,
  p_message         text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terms_id   uuid;
  v_version    int;
  v_count      int;
  v_total      bigint := 0;
  v_prev_due   date := null;
  v_item       jsonb;
  v_due        date;
  v_amount     bigint;
  v_seq        int := 0;
begin
  if p_principal_cents is null or p_principal_cents < 1 or p_principal_cents > 10000000 then
    raise exception 'invalid_principal';
  end if;
  if p_charge_cents is null or p_charge_cents < 0 or p_charge_cents > 10000000 then
    raise exception 'invalid_charge';
  end if;
  if jsonb_typeof(p_instalments) is distinct from 'array' then
    raise exception 'invalid_schedule';
  end if;

  v_count := jsonb_array_length(p_instalments);
  if v_count < 1 or v_count > 52 then
    raise exception 'invalid_schedule';
  end if;

  select coalesce(max(t.version), 0) + 1 into v_version
  from public.loan_terms t where t.loan_id = p_loan_id;

  insert into public.loan_terms (
    loan_id, version, proposed_by, principal_cents, charge_cents, late_terms, conditions, message
  )
  values (
    p_loan_id, v_version, p_proposed_by, p_principal_cents, p_charge_cents,
    btrim(coalesce(p_late_terms, '')), btrim(coalesce(p_conditions, '')),
    nullif(btrim(coalesce(p_message, '')), '')
  )
  returning id into v_terms_id;

  for v_item in select value from jsonb_array_elements(p_instalments) loop
    begin
      v_due := (v_item ->> 'due_on')::date;
      v_amount := (v_item ->> 'amount_cents')::bigint;
    exception when others then
      raise exception 'invalid_schedule';
    end;

    if v_due is null or v_amount is null or v_amount < 1 then
      raise exception 'invalid_schedule';
    end if;
    if v_due < private.nz_today() then
      raise exception 'schedule_date_in_past';
    end if;
    if v_prev_due is not null and v_due <= v_prev_due then
      raise exception 'schedule_dates_not_increasing';
    end if;

    v_seq := v_seq + 1;
    v_total := v_total + v_amount;
    v_prev_due := v_due;

    insert into public.instalments (terms_id, sequence, due_on, amount_cents)
    values (v_terms_id, v_seq, v_due, v_amount);
  end loop;

  if v_total <> p_principal_cents + p_charge_cents then
    raise exception 'schedule_total_mismatch';
  end if;

  update public.loan_terms
  set terms_hash = private.compute_terms_hash(v_terms_id)
  where id = v_terms_id;

  -- Proposing counts as accepting your own proposal (LN-05).
  insert into public.term_acceptances (terms_id, accepted_by, terms_hash)
  select v_terms_id, p_proposed_by, t.terms_hash from public.loan_terms t where t.id = v_terms_id;

  update public.loans set current_terms_id = v_terms_id where id = p_loan_id;
  return v_terms_id;
end;
$$;


-- =============================================================================
-- Public functions
-- =============================================================================

-- Start a loan: a borrower's request or a lender's offer (LN-01, LN-02).
create function public.create_loan(
  p_relationship_id uuid,
  p_principal_cents bigint,
  p_charge_cents    bigint,
  p_instalments     jsonb,
  p_reason          text default null,
  p_late_terms      text default '',
  p_conditions      text default '',
  p_message         text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_rel     public.lending_relationships;
  v_loan_id uuid;
begin
  select * into v_rel from public.lending_relationships r where r.id = p_relationship_id;

  if not found or v_user_id not in (v_rel.lender_id, v_rel.borrower_id) then
    raise exception 'relationship_not_found';
  elsif v_rel.ended_at is not null then
    raise exception 'relationship_ended';
  elsif not exists (select 1 from public.profiles p where p.id = v_rel.lender_id and p.can_lend) then
    raise exception 'lender_access_required';
  end if;

  if p_reason is not null and char_length(btrim(p_reason)) > 500 then
    raise exception 'invalid_reason';
  end if;

  insert into public.loans (relationship_id, lender_id, borrower_id, created_by, reason)
  values (v_rel.id, v_rel.lender_id, v_rel.borrower_id, v_user_id, nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_loan_id;

  perform private.insert_terms(
    v_loan_id, v_user_id, p_principal_cents, p_charge_cents, p_instalments,
    p_late_terms, p_conditions, p_message
  );

  perform private.log_loan_event(
    v_loan_id,
    case when v_user_id = v_rel.borrower_id then 'loan_requested' else 'loan_offered' end,
    jsonb_build_object('version', 1)
  );
  return v_loan_id;
end;
$$;


-- Propose new terms while negotiating (LN-03). Either party may counter.
-- p_expected_terms_id must be the version the caller was looking at, so a
-- newer proposal is never overwritten unseen.
create function public.counter_offer(
  p_loan_id           uuid,
  p_expected_terms_id uuid,
  p_principal_cents   bigint,
  p_charge_cents      bigint,
  p_instalments       jsonb,
  p_late_terms        text default '',
  p_conditions        text default '',
  p_message           text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id  uuid := private.require_user();
  v_loan     public.loans := private.lock_loan_for_party(p_loan_id, v_user_id);
  v_terms_id uuid;
begin
  if v_loan.status <> 'negotiating' then
    raise exception 'loan_not_negotiating';
  elsif v_loan.current_terms_id is distinct from p_expected_terms_id then
    raise exception 'terms_changed';
  end if;

  v_terms_id := private.insert_terms(
    p_loan_id, v_user_id, p_principal_cents, p_charge_cents, p_instalments,
    p_late_terms, p_conditions, p_message
  );

  perform private.log_loan_event(
    p_loan_id, 'terms_proposed',
    jsonb_build_object('version', (select version from public.loan_terms where id = v_terms_id))
  );
  return v_terms_id;
end;
$$;


-- Accept the current terms (AG-02, AG-03). The loan becomes agreed, not
-- active: money hasn't moved yet (LN-07).
create function public.accept_terms(
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

  update public.loans set status = 'agreed', agreed_at = now() where id = p_loan_id;

  perform private.log_loan_event(
    p_loan_id, 'terms_accepted',
    jsonb_build_object('version', v_terms.version, 'terms_hash', v_terms.terms_hash)
  );
end;
$$;


-- Turn down the other person's proposal. Ends the negotiation.
create function public.reject_terms(p_loan_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_loan    public.loans := private.lock_loan_for_party(p_loan_id, v_user_id);
begin
  if v_loan.status <> 'negotiating' then
    raise exception 'loan_not_negotiating';
  elsif (select t.proposed_by from public.loan_terms t where t.id = v_loan.current_terms_id) = v_user_id then
    -- You can't reject your own proposal; withdraw it instead.
    raise exception 'cannot_reject_own_terms';
  end if;

  update public.loans set status = 'rejected', closed_at = now() where id = p_loan_id;
  perform private.log_loan_event(
    p_loan_id, 'loan_rejected', jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), ''))
  );
end;
$$;


-- Cancel: the proposer withdraws while negotiating, or either party cancels
-- an agreed loan before the money is sent (LN-06).
create function public.withdraw_loan(p_loan_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_loan    public.loans := private.lock_loan_for_party(p_loan_id, v_user_id);
begin
  if v_loan.status = 'negotiating' then
    if (select t.proposed_by from public.loan_terms t where t.id = v_loan.current_terms_id) <> v_user_id then
      -- The other person's proposal is waiting on you: reject it instead.
      raise exception 'cannot_withdraw_their_terms';
    end if;
  elsif v_loan.status <> 'agreed' then
    raise exception 'loan_not_cancellable';
  end if;

  update public.loans set status = 'withdrawn', closed_at = now() where id = p_loan_id;
  perform private.log_loan_event(
    p_loan_id, 'loan_withdrawn', jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), ''))
  );
end;
$$;


-- The lender confirms the money was sent. Only now is the loan active (LN-07, AG-04).
create function public.confirm_funds_sent(
  p_loan_id   uuid,
  p_sent_on   date,
  p_method    public.payment_method,
  p_reference text default null
)
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
  elsif v_loan.status <> 'agreed' then
    raise exception 'loan_not_agreed';
  elsif p_sent_on is null or p_sent_on > private.nz_today() then
    raise exception 'invalid_sent_date';
  elsif p_method is null then
    raise exception 'invalid_payment_method';
  elsif p_reference is not null and char_length(btrim(p_reference)) > 100 then
    raise exception 'invalid_reference';
  end if;

  update public.loans
  set status = 'active',
      funds_sent_at = now(),
      funds_sent_on = p_sent_on,
      funds_method = p_method,
      funds_reference = nullif(btrim(coalesce(p_reference, '')), '')
  where id = p_loan_id;

  perform private.log_loan_event(
    p_loan_id, 'funds_confirmed',
    jsonb_build_object('sent_on', p_sent_on, 'method', p_method)
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- Relationships with open loans can't be ended (resolves the M2 TODO).
-- -----------------------------------------------------------------------------
create or replace function public.end_relationship(p_relationship_id uuid)
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
  elsif exists (
    select 1 from public.loans l
    where l.relationship_id = p_relationship_id
      and l.status in ('negotiating', 'agreed', 'active')
  ) then
    raise exception 'relationship_has_open_loans';
  end if;

  update public.lending_relationships set ended_at = now() where id = p_relationship_id;
  perform private.log_event('relationship_ended', p_relationship_id);
end;
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

revoke execute on function
  public.create_loan(uuid, bigint, bigint, jsonb, text, text, text, text),
  public.counter_offer(uuid, uuid, bigint, bigint, jsonb, text, text, text),
  public.accept_terms(uuid, uuid, text),
  public.reject_terms(uuid, text),
  public.withdraw_loan(uuid, text),
  public.confirm_funds_sent(uuid, date, public.payment_method, text),
  public.end_relationship(uuid)
from public, anon;

grant execute on function
  public.create_loan(uuid, bigint, bigint, jsonb, text, text, text, text),
  public.counter_offer(uuid, uuid, bigint, bigint, jsonb, text, text, text),
  public.accept_terms(uuid, uuid, text),
  public.reject_terms(uuid, text),
  public.withdraw_loan(uuid, text),
  public.confirm_funds_sent(uuid, date, public.payment_method, text),
  public.end_relationship(uuid)
to authenticated;
