-- =============================================================================
-- Existing debts (ADR-0012)
--
-- A lender can attach a debt that already exists to an invite: the amount
-- still owed, when it was originally lent, and a repayment plan. When the
-- invite is accepted, the debt becomes a loan proposal from the lender. The
-- borrower must confirm it (or suggest changes, or decline) before it counts.
-- Confirming makes it active straight away: the money changed hands long ago.
-- =============================================================================

alter table public.loans
  add column kind text not null default 'new' check (kind in ('new', 'existing_debt')),
  add column originally_lent_on date;

alter table public.loans
  add constraint loans_existing_debt_has_date check ((kind = 'existing_debt') = (originally_lent_on is not null));

alter table public.lender_invites
  add column existing_debt jsonb;

comment on column public.lender_invites.existing_debt is
  'Optional debt to propose when the invite is accepted: {amount_cents, lent_on, reason, instalments, late_terms, conditions}.';


-- -----------------------------------------------------------------------------
-- Schedule validation, shared by new terms and existing debts.
-- With p_allow_past_dates, due dates may already have passed: used when an
-- invite's debt is turned into a loan days after it was written.
-- -----------------------------------------------------------------------------
create function private.validate_schedule(
  p_total_cents       bigint,
  p_instalments       jsonb,
  p_allow_past_dates  boolean default false
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_count    int;
  v_total    bigint := 0;
  v_prev_due date := null;
  v_item     jsonb;
  v_due      date;
  v_amount   bigint;
begin
  if jsonb_typeof(p_instalments) is distinct from 'array' then
    raise exception 'invalid_schedule';
  end if;
  v_count := jsonb_array_length(p_instalments);
  if v_count < 1 or v_count > 52 then
    raise exception 'invalid_schedule';
  end if;

  for v_item in select value from jsonb_array_elements(p_instalments) loop
    begin
      v_due := (v_item ->> 'due_on')::date;
      v_amount := (v_item ->> 'amount_cents')::bigint;
    exception when others then
      raise exception 'invalid_schedule';
    end;
    if v_due is null or v_amount is null or v_amount < 1 then
      raise exception 'invalid_schedule';
    elsif not p_allow_past_dates and v_due < private.nz_today() then
      raise exception 'schedule_date_in_past';
    elsif v_prev_due is not null and v_due <= v_prev_due then
      raise exception 'schedule_dates_not_increasing';
    end if;
    v_total := v_total + v_amount;
    v_prev_due := v_due;
  end loop;

  if v_total <> p_total_cents then
    raise exception 'schedule_total_mismatch';
  end if;
end;
$$;


-- insert_terms gains p_allow_past_dates and uses the shared validation.
drop function private.insert_terms(uuid, uuid, bigint, bigint, jsonb, text, text, text);

create function private.insert_terms(
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
begin
  if p_principal_cents is null or p_principal_cents < 1 or p_principal_cents > 10000000 then
    raise exception 'invalid_principal';
  elsif p_charge_cents is null or p_charge_cents < 0 or p_charge_cents > 10000000 then
    raise exception 'invalid_charge';
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


-- -----------------------------------------------------------------------------
-- create_invite gains an optional existing debt.
-- -----------------------------------------------------------------------------
drop function public.create_invite(text);

create function public.create_invite(p_note text default null, p_existing_debt jsonb default null)
returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id    uuid := private.require_user();
  v_token      text;
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_open_count int;
  v_debt       jsonb;
  v_amount     bigint;
  v_lent_on    date;
begin
  if not exists (select 1 from public.profiles p where p.id = v_user_id and p.can_lend) then
    raise exception 'lender_access_required';
  end if;
  if v_note is not null and char_length(v_note) > 80 then
    raise exception 'invalid_note';
  end if;

  select count(*) into v_open_count
  from public.lender_invites i
  where i.lender_id = v_user_id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now();
  if v_open_count >= 10 then
    raise exception 'too_many_open_invites';
  end if;

  -- Validate the debt now, so the lender hears about mistakes immediately.
  if p_existing_debt is not null then
    begin
      v_amount := (p_existing_debt ->> 'amount_cents')::bigint;
      v_lent_on := (p_existing_debt ->> 'lent_on')::date;
    exception when others then
      raise exception 'invalid_existing_debt';
    end;
    if v_amount is null or v_amount < 1 or v_amount > 10000000 then
      raise exception 'invalid_principal';
    elsif v_lent_on is null or v_lent_on > private.nz_today() then
      raise exception 'invalid_lent_date';
    elsif char_length(coalesce(p_existing_debt ->> 'reason', '')) > 500 then
      raise exception 'invalid_reason';
    elsif char_length(coalesce(p_existing_debt ->> 'late_terms', '')) > 1000
       or char_length(coalesce(p_existing_debt ->> 'conditions', '')) > 2000 then
      raise exception 'invalid_existing_debt';
    end if;
    perform private.validate_schedule(v_amount, p_existing_debt -> 'instalments', false);

    -- Keep only the fields we use.
    v_debt := jsonb_build_object(
      'amount_cents', v_amount,
      'lent_on', v_lent_on,
      'reason', nullif(btrim(coalesce(p_existing_debt ->> 'reason', '')), ''),
      'instalments', p_existing_debt -> 'instalments',
      'late_terms', btrim(coalesce(p_existing_debt ->> 'late_terms', '')),
      'conditions', btrim(coalesce(p_existing_debt ->> 'conditions', ''))
    );
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.lender_invites (lender_id, token_hash, note, expires_at, existing_debt)
  values (v_user_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_note, now() + interval '7 days', v_debt)
  returning lender_invites.id, lender_invites.expires_at into invite_id, expires_at;

  token := v_token;
  perform private.log_event(
    'invite_created', null,
    jsonb_build_object('invite_id', invite_id, 'with_existing_debt', v_debt is not null)
  );
  return next;
end;
$$;


-- -----------------------------------------------------------------------------
-- preview_invite also shows any existing debt, so the person knows before joining.
-- -----------------------------------------------------------------------------
drop function public.preview_invite(text);

create function public.preview_invite(p_token text)
returns table (
  lender_name        text,
  expires_at         timestamptz,
  status             text,
  debt_amount_cents  bigint,
  debt_lent_on       date,
  debt_reason        text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
  v_invite  public.lender_invites;
begin
  select * into v_invite
  from public.lender_invites i
  where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');

  if not found then
    status := 'not_found';
    return next;
    return;
  end if;

  select p.display_name into lender_name from public.profiles p where p.id = v_invite.lender_id;
  expires_at := v_invite.expires_at;
  status := case
    when v_invite.revoked_at is not null then 'revoked'
    when v_invite.accepted_at is not null then 'used'
    when v_invite.expires_at <= now() then 'expired'
    when v_invite.lender_id = v_user_id then 'own_invite'
    else 'valid'
  end;
  if status = 'valid' and v_invite.existing_debt is not null then
    debt_amount_cents := (v_invite.existing_debt ->> 'amount_cents')::bigint;
    debt_lent_on := (v_invite.existing_debt ->> 'lent_on')::date;
    debt_reason := v_invite.existing_debt ->> 'reason';
  end if;
  return next;
end;
$$;


-- -----------------------------------------------------------------------------
-- accept_invite turns an attached debt into a loan proposal from the lender.
-- -----------------------------------------------------------------------------
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id         uuid := private.require_user();
  v_invite          public.lender_invites;
  v_relationship_id uuid;
  v_loan_id         uuid;
  v_debt            jsonb;
begin
  select * into v_invite
  from public.lender_invites i
  where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  for update;

  if not found then
    raise exception 'invite_not_found';
  elsif v_invite.revoked_at is not null then
    raise exception 'invite_revoked';
  elsif v_invite.accepted_at is not null then
    raise exception 'invite_used';
  elsif v_invite.expires_at <= now() then
    raise exception 'invite_expired';
  elsif v_invite.lender_id = v_user_id then
    raise exception 'invite_own';
  end if;

  insert into public.lending_relationships (lender_id, borrower_id, invite_id)
  values (v_invite.lender_id, v_user_id, v_invite.id)
  on conflict on constraint lending_relationships_pair_unique
  do update set ended_at = null, invite_id = excluded.invite_id
  returning id into v_relationship_id;

  update public.lender_invites
  set accepted_by = v_user_id, accepted_at = now()
  where id = v_invite.id;

  perform private.log_event('invite_accepted', v_relationship_id, jsonb_build_object('invite_id', v_invite.id));

  v_debt := v_invite.existing_debt;
  if v_debt is not null then
    insert into public.loans (
      relationship_id, lender_id, borrower_id, created_by, reason, kind, originally_lent_on
    )
    values (
      v_relationship_id, v_invite.lender_id, v_user_id, v_invite.lender_id,
      v_debt ->> 'reason', 'existing_debt', (v_debt ->> 'lent_on')::date
    )
    returning id into v_loan_id;

    -- Proposed by the lender; the borrower confirms. Due dates may have
    -- passed since the invite was written, so they're allowed here.
    perform private.insert_terms(
      v_loan_id, v_invite.lender_id,
      (v_debt ->> 'amount_cents')::bigint, 0, v_debt -> 'instalments',
      v_debt ->> 'late_terms', v_debt ->> 'conditions', null,
      true
    );

    insert into public.audit_events (actor_id, relationship_id, loan_id, event_type, payload)
    values (v_invite.lender_id, v_relationship_id, v_loan_id, 'existing_debt_proposed',
            jsonb_build_object('amount_cents', v_debt -> 'amount_cents', 'lent_on', v_debt -> 'lent_on'));
  end if;

  return v_relationship_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- accept_terms: confirming an existing debt makes it active straight away,
-- dated from when the money was originally lent.
-- -----------------------------------------------------------------------------
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

  if v_loan.kind = 'existing_debt' then
    update public.loans
    set status = 'active', agreed_at = now(), funds_sent_at = now(), funds_sent_on = v_loan.originally_lent_on
    where id = p_loan_id;
    perform private.log_loan_event(
      p_loan_id, 'existing_debt_confirmed',
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


-- Lenders can see the debt attached to their own invites (already covered by
-- the invites RLS policy). Nothing else changes for table access.


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
  public.create_invite(text, jsonb),
  public.preview_invite(text)
from public, anon;

grant execute on function
  public.create_invite(text, jsonb),
  public.preview_invite(text)
to authenticated;
