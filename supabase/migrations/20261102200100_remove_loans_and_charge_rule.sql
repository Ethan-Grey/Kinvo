-- =============================================================================
-- 1. Removing a loan (ADR-0015)
--
-- The lender can remove a loan that shouldn't be there, such as a test or a
-- mistake. It's hidden, not erased: the status becomes 'removed', so it drops
-- out of every list, total, track record and reminder (they all count only
-- the statuses they need). Its notifications are deleted. The audit log keeps
-- one line saying who removed it, when and why.
--
-- 2. Only the lender sets the charge (ADR-0015)
--
-- A borrower's request has no charge. Once the lender proposes a charge, the
-- borrower can still change the amount and the plan, but the charge follows
-- the lender's rate: charge = round(amount × lender's charge ÷ lender's amount).
-- =============================================================================

alter table public.loans add column removed_reason text;

-- A removed loan keeps whatever dates it had, funded or not.
alter table public.loans drop constraint loans_funds_only_when_active;
alter table public.loans add constraint loans_funds_only_when_active check (
  status = 'removed' or (status in ('active', 'completed', 'written_off')) = (funds_sent_at is not null)
);
alter table public.loans drop constraint loans_agreed_at_set;
alter table public.loans add constraint loans_agreed_at_set check (
  status in ('negotiating', 'rejected', 'withdrawn', 'removed') or agreed_at is not null
);

comment on column public.loans.removed_reason is 'Why the lender removed this loan (status ''removed''), if they gave a reason.';


-- -----------------------------------------------------------------------------
-- Remove a loan (lender only, any status)
-- -----------------------------------------------------------------------------
create function public.remove_loan(p_loan_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_loan    public.loans := private.lock_loan_for_party(p_loan_id, v_user_id);
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_loan.lender_id <> v_user_id then
    raise exception 'lender_only';
  elsif v_loan.status = 'removed' then
    raise exception 'loan_already_removed';
  elsif char_length(coalesce(v_reason, '')) > 500 then
    raise exception 'reason_too_long';
  end if;

  update public.loans
  set status = 'removed', closed_at = now(), removed_reason = v_reason
  where id = p_loan_id;

  -- Alerts about a loan that's gone would only lead to a missing page.
  delete from public.notifications where loan_id = p_loan_id;

  perform private.log_loan_event(
    p_loan_id, 'loan_removed', jsonb_build_object('previous_status', v_loan.status, 'reason', v_reason)
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- insert_terms, now with the charge rule. Same signature and behaviour otherwise.
-- -----------------------------------------------------------------------------
create or replace function private.insert_terms(
  p_loan_id           uuid,
  p_proposed_by       uuid,
  p_principal_cents   bigint,
  p_charge_cents      bigint,
  p_instalments       jsonb,
  p_late_terms        text,
  p_conditions        text,
  p_message           text,
  p_allow_past_dates  boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terms_id uuid;
  v_version  int;
  v_item     jsonb;
  v_seq      int := 0;
  v_required bigint;
begin
  if p_principal_cents is null or p_principal_cents < 1 or p_principal_cents > 10000000 then
    raise exception 'invalid_principal';
  elsif p_charge_cents is null or p_charge_cents < 0 or p_charge_cents > 10000000 then
    raise exception 'invalid_charge';
  end if;

  v_required := private.required_borrower_charge(p_loan_id, p_proposed_by, p_principal_cents);
  if v_required <> -1 and p_charge_cents <> v_required then
    raise exception 'charge_set_by_lender';
  end if;

  perform private.validate_schedule(p_principal_cents + p_charge_cents, p_instalments, p_allow_past_dates);

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
    v_seq := v_seq + 1;
    insert into public.instalments (terms_id, sequence, due_on, amount_cents)
    values (v_terms_id, v_seq, (v_item ->> 'due_on')::date, (v_item ->> 'amount_cents')::bigint);
  end loop;

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

-- The charge a borrower's proposal must have, or -1 when the proposer is the
-- lender (who may set any charge). With no lender proposal yet, it's 0.
create function private.required_borrower_charge(p_loan_id uuid, p_proposed_by uuid, p_principal_cents bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_borrower uuid;
  v_principal bigint;
  v_charge bigint;
begin
  select l.borrower_id into v_borrower from public.loans l where l.id = p_loan_id;
  if p_proposed_by is distinct from v_borrower then
    return -1;
  end if;

  select t.principal_cents, t.charge_cents into v_principal, v_charge
  from public.loan_terms t
  where t.loan_id = p_loan_id and t.proposed_by <> v_borrower
  order by t.version desc
  limit 1;

  if v_principal is null or v_principal = 0 then
    return 0;
  end if;
  return round(p_principal_cents::numeric * v_charge / v_principal)::bigint;
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function private.required_borrower_charge(uuid, uuid, bigint) from public, anon, authenticated;
revoke execute on function public.remove_loan(uuid, text) from public, anon;
grant execute on function public.remove_loan(uuid, text) to authenticated;


-- -----------------------------------------------------------------------------
-- 3. Clearing alerts
--
-- Notifications are a copy of what happened, not the record itself (that's
-- the audit log), so people can clear their own.
-- -----------------------------------------------------------------------------
create function public.clear_notifications(p_ids uuid[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.notifications
  where recipient_id = (select auth.uid())
    and (p_ids is null or id = any (p_ids));
$$;

revoke execute on function public.clear_notifications(uuid[]) from public, anon;
grant execute on function public.clear_notifications(uuid[]) to authenticated;
