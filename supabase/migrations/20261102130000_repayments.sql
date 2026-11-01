-- =============================================================================
-- M4: Repayments, balances and overdue tracking
--
--   * The lender records a payment → confirmed immediately.
--   * The borrower says "I've paid" → claimed, until the lender confirms or
--     disputes it. Only confirmed payments reduce the balance (RP-02, RP-03).
--   * Payments are never edited or deleted. A mistake is corrected by
--     reversing the payment, with a reason (RP-04).
--   * A payment can't exceed the outstanding balance, so there are no credits.
--   * Balances and instalment status are always calculated, never stored
--     (CA-08). See private.instalment_progress and ADR-0010.
--   * The loan completes automatically when the balance reaches zero.
--   * The lender can forgive what's left, closing the loan as written off.
-- =============================================================================

create type public.repayment_status as enum ('claimed', 'confirmed', 'disputed', 'reversed');

create table public.repayments (
  id              uuid primary key default gen_random_uuid(),
  loan_id         uuid not null references public.loans (id) on delete restrict,
  amount_cents    bigint not null check (amount_cents between 1 and 20000000),
  received_on     date not null,
  method          public.payment_method not null,
  reference       text check (reference is null or char_length(reference) <= 100),
  notes           text check (notes is null or char_length(notes) <= 500),
  status          public.repayment_status not null,
  submitted_by    uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz,
  disputed_at     timestamptz,
  dispute_reason  text check (dispute_reason is null or char_length(dispute_reason) <= 500),
  reversed_at     timestamptz,
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 500),

  constraint repayments_confirmed_has_time check (status not in ('confirmed', 'reversed') or confirmed_at is not null),
  constraint repayments_disputed_has_time check (status <> 'disputed' or disputed_at is not null),
  constraint repayments_reversed_has_reason check (status <> 'reversed' or (reversed_at is not null and reversal_reason is not null))
);

create index repayments_loan_id_idx on public.repayments (loan_id, received_on, created_at);

alter table public.loans
  add column written_off_cents bigint check (written_off_cents is null or written_off_cents > 0);

revoke all on public.repayments from anon, authenticated;
grant select on public.repayments to authenticated;

alter table public.repayments enable row level security;

create policy "Parties see their loans' repayments"
  on public.repayments for select to authenticated
  using (private.is_loan_party(loan_id));


-- =============================================================================
-- Calculations
-- =============================================================================

-- Total repayable under the loan's current (agreed) terms.
create function private.loan_total_cents(p_loan_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select t.principal_cents + t.charge_cents
  from public.loans l
  join public.loan_terms t on t.id = l.current_terms_id
  where l.id = p_loan_id;
$$;

create function private.loan_paid_cents(p_loan_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.amount_cents), 0)::bigint
  from public.repayments r
  where r.loan_id = p_loan_id and r.status = 'confirmed';
$$;


-- How much of each instalment is paid, replaying confirmed payments in the
-- order they were received (ADR-0004, ADR-0010):
--   1. oldest instalment first;
--   2. within an instalment, its share of the charge before principal.
-- Each instalment's charge share is the total charge split in proportion to
-- instalment amounts, with leftover cents on the first instalment.
-- `paid_on` is the date of the payment that finished paying the instalment.
create function private.instalment_progress(p_loan_id uuid)
returns table (
  instalment_id        uuid,
  sequence             int,
  due_on               date,
  amount_cents         bigint,
  charge_share_cents   bigint,
  paid_cents           bigint,
  paid_charge_cents    bigint,
  paid_principal_cents bigint,
  paid_on              date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids     uuid[];
  v_seqs    int[];
  v_dues    date[];
  v_amounts bigint[];
  v_shares  bigint[];
  v_paid    bigint[];
  v_paid_c  bigint[];
  v_paid_on date[];
  v_charge  bigint;
  v_total   bigint;
  v_n       int;
  v_left    bigint;
  v_take    bigint;
  v_c       bigint;
  v_pay     record;
  i         int;
begin
  select array_agg(x.id order by x.sequence), array_agg(x.sequence order by x.sequence),
         array_agg(x.due_on order by x.sequence), array_agg(x.amount_cents order by x.sequence),
         max(t.charge_cents)
  into v_ids, v_seqs, v_dues, v_amounts, v_charge
  from public.loans l
  join public.loan_terms t on t.id = l.current_terms_id
  join public.instalments x on x.terms_id = t.id
  where l.id = p_loan_id;

  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then
    return;
  end if;

  select sum(a) into v_total from unnest(v_amounts) a;

  -- Charge shares (floor), leftover cents to the first instalment.
  v_shares := array_fill(0::bigint, array[v_n]);
  for i in 1..v_n loop
    v_shares[i] := (v_charge * v_amounts[i]) / v_total;
  end loop;
  v_shares[1] := v_shares[1] + (v_charge - (select sum(s) from unnest(v_shares) s));

  v_paid := array_fill(0::bigint, array[v_n]);
  v_paid_c := array_fill(0::bigint, array[v_n]);
  v_paid_on := array_fill(null::date, array[v_n]);

  for v_pay in
    select r.amount_cents, r.received_on
    from public.repayments r
    where r.loan_id = p_loan_id and r.status = 'confirmed'
    order by r.received_on, r.created_at, r.id
  loop
    v_left := v_pay.amount_cents;
    for i in 1..v_n loop
      exit when v_left = 0;
      v_take := least(v_amounts[i] - v_paid[i], v_left);
      continue when v_take = 0;
      v_c := least(v_take, v_shares[i] - v_paid_c[i]);
      v_paid_c[i] := v_paid_c[i] + v_c;
      v_paid[i] := v_paid[i] + v_take;
      v_left := v_left - v_take;
      if v_paid[i] = v_amounts[i] and v_paid_on[i] is null then
        v_paid_on[i] := v_pay.received_on;
      end if;
    end loop;
  end loop;

  for i in 1..v_n loop
    instalment_id := v_ids[i];
    sequence := v_seqs[i];
    due_on := v_dues[i];
    amount_cents := v_amounts[i];
    charge_share_cents := v_shares[i];
    paid_cents := v_paid[i];
    paid_charge_cents := v_paid_c[i];
    paid_principal_cents := v_paid[i] - v_paid_c[i];
    paid_on := v_paid_on[i];
    return next;
  end loop;
end;
$$;


-- Complete a loan when nothing is owed, or reopen it if a reversal means
-- something is owed again.
create function private.sync_loan_completion(p_loan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.loan_status;
  v_outstanding bigint := private.loan_total_cents(p_loan_id) - private.loan_paid_cents(p_loan_id);
begin
  select l.status into v_status from public.loans l where l.id = p_loan_id;

  if v_status = 'active' and v_outstanding <= 0 then
    update public.loans set status = 'completed', closed_at = now() where id = p_loan_id;
    perform private.log_loan_event(p_loan_id, 'loan_completed');
  elsif v_status = 'completed' and v_outstanding > 0 then
    update public.loans set status = 'active', closed_at = null where id = p_loan_id;
    perform private.log_loan_event(p_loan_id, 'loan_reopened');
  end if;
end;
$$;


-- Lock a repayment and its loan for the loan's lender.
create function private.lock_repayment_for_lender(p_repayment_id uuid, p_user_id uuid)
returns public.repayments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_repayment public.repayments;
  v_loan public.loans;
begin
  select * into v_repayment from public.repayments r where r.id = p_repayment_id for update;
  if not found then
    raise exception 'repayment_not_found';
  end if;
  v_loan := private.lock_loan_for_party(v_repayment.loan_id, p_user_id);
  if v_loan.lender_id <> p_user_id then
    raise exception 'lender_only';
  end if;
  return v_repayment;
end;
$$;


-- =============================================================================
-- Public read functions
-- =============================================================================

-- Per-instalment progress for one loan, with its status today.
create function public.get_instalment_progress(p_loan_id uuid)
returns table (
  instalment_id        uuid,
  sequence             int,
  due_on               date,
  amount_cents         bigint,
  paid_cents           bigint,
  paid_charge_cents    bigint,
  paid_principal_cents bigint,
  paid_on              date,
  status               text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
begin
  if not exists (
    select 1 from public.loans l where l.id = p_loan_id and v_user_id in (l.lender_id, l.borrower_id)
  ) then
    raise exception 'loan_not_found';
  end if;

  return query
  select p.instalment_id, p.sequence, p.due_on, p.amount_cents, p.paid_cents,
         p.paid_charge_cents, p.paid_principal_cents, p.paid_on,
         case
           when p.paid_cents >= p.amount_cents then 'paid'
           -- Overdue from the day after the due date (NZ time).
           when p.due_on < private.nz_today() then 'overdue'
           else 'due'
         end
  from private.instalment_progress(p_loan_id) p
  order by p.sequence;
end;
$$;


-- Balance summary for every funded loan the caller is party to.
create function public.list_loan_balances()
returns table (
  loan_id           uuid,
  total_cents       bigint,
  paid_cents        bigint,
  written_off_cents bigint,
  outstanding_cents bigint,
  next_due_on       date,
  next_due_cents    bigint,
  overdue_cents     bigint,
  overdue_count     int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_loan record;
begin
  for v_loan in
    select l.id, l.status, coalesce(l.written_off_cents, 0) as written_off
    from public.loans l
    where v_user_id in (l.lender_id, l.borrower_id)
      and l.status in ('active', 'completed', 'written_off')
  loop
    loan_id := v_loan.id;
    total_cents := private.loan_total_cents(v_loan.id);
    paid_cents := private.loan_paid_cents(v_loan.id);
    written_off_cents := v_loan.written_off;
    outstanding_cents := greatest(total_cents - paid_cents - v_loan.written_off, 0);

    select p.due_on, p.amount_cents - p.paid_cents
    into next_due_on, next_due_cents
    from private.instalment_progress(v_loan.id) p
    where p.paid_cents < p.amount_cents
    order by p.sequence
    limit 1;

    if v_loan.status <> 'active' then
      next_due_on := null;
      next_due_cents := null;
      overdue_cents := 0;
      overdue_count := 0;
    else
      select coalesce(sum(p.amount_cents - p.paid_cents), 0), count(*)
      into overdue_cents, overdue_count
      from private.instalment_progress(v_loan.id) p
      where p.paid_cents < p.amount_cents and p.due_on < private.nz_today();
    end if;

    return next;
  end loop;
end;
$$;


-- =============================================================================
-- Public write functions
-- =============================================================================

-- Record a payment. From the lender it's confirmed straight away; from the
-- borrower it's a claim the lender confirms or disputes.
create function public.record_repayment(
  p_loan_id      uuid,
  p_amount_cents bigint,
  p_received_on  date,
  p_method       public.payment_method,
  p_reference    text default null,
  p_notes        text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid := private.require_user();
  v_loan        public.loans := private.lock_loan_for_party(p_loan_id, v_user_id);
  v_is_lender   boolean := v_loan.lender_id = v_user_id;
  v_outstanding bigint;
  v_id          uuid;
  v_reference   text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if v_loan.status <> 'active' then
    raise exception 'loan_not_active';
  elsif p_amount_cents is null or p_amount_cents < 1 then
    raise exception 'invalid_amount';
  elsif p_received_on is null or p_received_on > private.nz_today() then
    raise exception 'invalid_received_date';
  elsif p_received_on < v_loan.funds_sent_on then
    raise exception 'received_before_funds_sent';
  elsif p_method is null then
    raise exception 'invalid_payment_method';
  elsif v_reference is not null and char_length(v_reference) > 100 then
    raise exception 'invalid_reference';
  elsif p_notes is not null and char_length(btrim(p_notes)) > 500 then
    raise exception 'invalid_notes';
  end if;

  v_outstanding := private.loan_total_cents(p_loan_id) - private.loan_paid_cents(p_loan_id);
  if p_amount_cents > v_outstanding then
    raise exception 'amount_exceeds_outstanding';
  end if;

  -- Guard against double-submits (RP-05).
  if exists (
    select 1 from public.repayments r
    where r.loan_id = p_loan_id
      and r.amount_cents = p_amount_cents
      and r.received_on = p_received_on
      and r.reference is not distinct from v_reference
      and r.status in ('claimed', 'confirmed')
      and r.created_at > now() - interval '2 minutes'
  ) then
    raise exception 'duplicate_repayment';
  end if;

  insert into public.repayments (
    loan_id, amount_cents, received_on, method, reference, notes, status, submitted_by, confirmed_at
  )
  values (
    p_loan_id, p_amount_cents, p_received_on, p_method, v_reference,
    nullif(btrim(coalesce(p_notes, '')), ''),
    case when v_is_lender then 'confirmed'::public.repayment_status else 'claimed'::public.repayment_status end,
    v_user_id,
    case when v_is_lender then now() end
  )
  returning id into v_id;

  perform private.log_loan_event(
    p_loan_id,
    case when v_is_lender then 'repayment_recorded' else 'repayment_claimed' end,
    jsonb_build_object('repayment_id', v_id, 'amount_cents', p_amount_cents, 'received_on', p_received_on)
  );

  if v_is_lender then
    perform private.sync_loan_completion(p_loan_id);
  end if;
  return v_id;
end;
$$;


-- The lender confirms a borrower's claim.
create function public.confirm_repayment(p_repayment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id   uuid := private.require_user();
  v_repayment public.repayments := private.lock_repayment_for_lender(p_repayment_id, v_user_id);
begin
  if v_repayment.status not in ('claimed', 'disputed') then
    raise exception 'repayment_not_pending';
  elsif (select l.status from public.loans l where l.id = v_repayment.loan_id) <> 'active' then
    raise exception 'loan_not_active';
  elsif v_repayment.amount_cents >
        private.loan_total_cents(v_repayment.loan_id) - private.loan_paid_cents(v_repayment.loan_id) then
    raise exception 'amount_exceeds_outstanding';
  end if;

  update public.repayments
  set status = 'confirmed', confirmed_at = now()
  where id = p_repayment_id;

  perform private.log_loan_event(
    v_repayment.loan_id, 'repayment_confirmed', jsonb_build_object('repayment_id', p_repayment_id)
  );
  perform private.sync_loan_completion(v_repayment.loan_id);
end;
$$;


-- The lender says a claimed payment hasn't arrived.
create function public.dispute_repayment(p_repayment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id   uuid := private.require_user();
  v_repayment public.repayments := private.lock_repayment_for_lender(p_repayment_id, v_user_id);
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_repayment.status <> 'claimed' then
    raise exception 'repayment_not_pending';
  elsif v_reason is null or char_length(v_reason) > 500 then
    raise exception 'reason_required';
  end if;

  update public.repayments
  set status = 'disputed', disputed_at = now(), dispute_reason = v_reason
  where id = p_repayment_id;

  perform private.log_loan_event(
    v_repayment.loan_id, 'repayment_disputed',
    jsonb_build_object('repayment_id', p_repayment_id, 'reason', v_reason)
  );
end;
$$;


-- The lender undoes a confirmed payment that was recorded by mistake.
-- The original row stays, marked reversed, with the reason.
create function public.reverse_repayment(p_repayment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id   uuid := private.require_user();
  v_repayment public.repayments := private.lock_repayment_for_lender(p_repayment_id, v_user_id);
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_repayment.status <> 'confirmed' then
    raise exception 'repayment_not_confirmed';
  elsif (select l.status from public.loans l where l.id = v_repayment.loan_id) not in ('active', 'completed') then
    raise exception 'loan_closed';
  elsif v_reason is null or char_length(v_reason) > 500 then
    raise exception 'reason_required';
  end if;

  update public.repayments
  set status = 'reversed', reversed_at = now(), reversal_reason = v_reason
  where id = p_repayment_id;

  perform private.log_loan_event(
    v_repayment.loan_id, 'repayment_reversed',
    jsonb_build_object('repayment_id', p_repayment_id, 'reason', v_reason)
  );
  perform private.sync_loan_completion(v_repayment.loan_id);
end;
$$;


-- The lender forgives what's left. The loan closes as written off (LN-09).
create function public.forgive_remaining(p_loan_id uuid, p_note text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid := private.require_user();
  v_loan        public.loans := private.lock_loan_for_party(p_loan_id, v_user_id);
  v_outstanding bigint;
begin
  if v_loan.lender_id <> v_user_id then
    raise exception 'lender_only';
  elsif v_loan.status <> 'active' then
    raise exception 'loan_not_active';
  end if;

  v_outstanding := private.loan_total_cents(p_loan_id) - private.loan_paid_cents(p_loan_id);
  if v_outstanding <= 0 then
    raise exception 'nothing_outstanding';
  end if;

  update public.loans
  set status = 'written_off', written_off_cents = v_outstanding, closed_at = now()
  where id = p_loan_id;

  perform private.log_loan_event(
    p_loan_id, 'loan_written_off',
    jsonb_build_object('amount_cents', v_outstanding, 'note', nullif(btrim(coalesce(p_note, '')), ''))
  );
  return v_outstanding;
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
  public.get_instalment_progress(uuid),
  public.list_loan_balances(),
  public.record_repayment(uuid, bigint, date, public.payment_method, text, text),
  public.confirm_repayment(uuid),
  public.dispute_repayment(uuid, text),
  public.reverse_repayment(uuid, text),
  public.forgive_remaining(uuid, text)
from public, anon;

grant execute on function
  public.get_instalment_progress(uuid),
  public.list_loan_balances(),
  public.record_repayment(uuid, bigint, date, public.payment_method, text, text),
  public.confirm_repayment(uuid),
  public.dispute_repayment(uuid, text),
  public.reverse_repayment(uuid, text),
  public.forgive_remaining(uuid, text)
to authenticated;
