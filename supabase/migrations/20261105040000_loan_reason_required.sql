-- =============================================================================
-- A request to borrow needs a reason (ADR-0025)
--
-- When the person who'd owe asks, they must say what it's for. The person
-- being asked sees it in the alert, on the request and when accepting. Offers
-- from the person who'd be owed can still leave it blank.
-- =============================================================================

create or replace function public.create_loan(
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
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_rel from public.lending_relationships r where r.id = p_relationship_id;

  if not found or v_user_id not in (v_rel.lender_id, v_rel.borrower_id) then
    raise exception 'relationship_not_found';
  elsif v_rel.ended_at is not null then
    raise exception 'relationship_ended';
  elsif not exists (select 1 from public.profiles p where p.id = v_rel.lender_id and p.can_lend) then
    raise exception 'lender_access_required';
  end if;

  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'invalid_reason';
  elsif v_reason is null and v_user_id = v_rel.borrower_id then
    raise exception 'loan_reason_required';
  end if;

  insert into public.loans (relationship_id, lender_id, borrower_id, created_by, reason)
  values (v_rel.id, v_rel.lender_id, v_rel.borrower_id, v_user_id, v_reason)
  returning id into v_loan_id;

  perform private.insert_terms(
    v_loan_id, v_user_id, p_principal_cents, p_charge_cents, p_instalments,
    p_late_terms, p_conditions, p_message
  );

  perform private.log_loan_event(
    v_loan_id,
    case when v_user_id = v_rel.borrower_id then 'loan_requested' else 'loan_offered' end,
    jsonb_build_object('version', 1, 'reason', v_reason)
  );
  return v_loan_id;
end;
$$;

-- The alert for a request now says what it's for.
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
        coalesce('For ' || v_loan.reason || '. ', '') || 'Open Kinvo to accept, suggest changes, or decline.',
        v_key || v_loan.lender_id);

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

