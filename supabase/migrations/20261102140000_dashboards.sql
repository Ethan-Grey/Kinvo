-- =============================================================================
-- M5: Dashboards and borrower track records
--
-- 1. Refactors allocation into one replay (private.replay_payments) that
--    reports how each payment was split. instalment_progress now aggregates
--    it, so loan pages and dashboards always agree (ADR-0010).
-- 2. Adds read-only functions for the home screens and the lender-only
--    borrower track record (DB-01, DB-02, DB-03, DB-04).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Each instalment's share of the one-off charge: in proportion to instalment
-- amounts, rounded down, leftover cents on the first instalment (ADR-0004).
-- -----------------------------------------------------------------------------
create function private.instalment_charge_shares(p_loan_id uuid)
returns table (
  instalment_id      uuid,
  sequence           int,
  due_on             date,
  amount_cents       bigint,
  charge_share_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select x.id, x.sequence, x.due_on, x.amount_cents, t.charge_cents,
           sum(x.amount_cents) over () as total_cents
    from public.loans l
    join public.loan_terms t on t.id = l.current_terms_id
    join public.instalments x on x.terms_id = t.id
    where l.id = p_loan_id
  ),
  floored as (
    select b.*, (b.charge_cents * b.amount_cents) / b.total_cents as share
    from base b
  )
  select f.id, f.sequence, f.due_on, f.amount_cents,
         f.share + case when f.sequence = 1 then f.charge_cents - sum(f.share) over () else 0 end
  from floored f
  order by f.sequence;
$$;


-- -----------------------------------------------------------------------------
-- Replay confirmed payments in the order received and report how each one
-- was split: oldest instalment first, charge share before principal.
-- One row per (payment, instalment) it touched.
-- -----------------------------------------------------------------------------
create function private.replay_payments(p_loan_id uuid)
returns table (
  repayment_id    uuid,
  received_on     date,
  instalment_id   uuid,
  sequence        int,
  charge_cents    bigint,
  principal_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids     uuid[];
  v_amounts bigint[];
  v_shares  bigint[];
  v_paid    bigint[];
  v_paid_c  bigint[];
  v_n       int;
  v_left    bigint;
  v_take    bigint;
  v_c       bigint;
  v_pay     record;
  i         int;
begin
  select array_agg(s.instalment_id order by s.sequence),
         array_agg(s.amount_cents order by s.sequence),
         array_agg(s.charge_share_cents order by s.sequence)
  into v_ids, v_amounts, v_shares
  from private.instalment_charge_shares(p_loan_id) s;

  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then
    return;
  end if;
  v_paid := array_fill(0::bigint, array[v_n]);
  v_paid_c := array_fill(0::bigint, array[v_n]);

  for v_pay in
    select r.id, r.amount_cents, r.received_on
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

      repayment_id := v_pay.id;
      received_on := v_pay.received_on;
      instalment_id := v_ids[i];
      sequence := i;
      charge_cents := v_c;
      principal_cents := v_take - v_c;
      return next;
    end loop;
  end loop;
end;
$$;


-- Same output as before (M4), now built from the replay. `paid_on` is the
-- date of the payment that finished paying the instalment.
create or replace function private.instalment_progress(p_loan_id uuid)
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
language sql
stable
security definer
set search_path = ''
as $$
  with alloc as (
    select a.instalment_id,
           sum(a.charge_cents)::bigint as paid_charge,
           sum(a.principal_cents)::bigint as paid_principal,
           max(a.received_on) as last_received_on
    from private.replay_payments(p_loan_id) a
    group by a.instalment_id
  )
  select s.instalment_id, s.sequence, s.due_on, s.amount_cents, s.charge_share_cents,
         coalesce(a.paid_charge, 0) + coalesce(a.paid_principal, 0),
         coalesce(a.paid_charge, 0),
         coalesce(a.paid_principal, 0),
         case when coalesce(a.paid_charge, 0) + coalesce(a.paid_principal, 0) >= s.amount_cents
              then a.last_received_on end
  from private.instalment_charge_shares(p_loan_id) s
  left join alloc a on a.instalment_id = s.instalment_id
  order by s.sequence;
$$;


-- First day of the NZ tax year (1 April) containing p_date.
create function private.tax_year_start(p_date date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when p_date >= make_date(extract(year from p_date)::int, 4, 1)
      then make_date(extract(year from p_date)::int, 4, 1)
    else make_date(extract(year from p_date)::int - 1, 4, 1)
  end;
$$;


-- =============================================================================
-- Dashboard summary (DB-01, DB-02, DB-04)
-- =============================================================================
create function public.get_dashboard_summary()
returns table (
  lending_owed_cents             bigint,
  lending_overdue_cents          bigint,
  lending_overdue_count          int,
  lending_total_lent_cents       bigint,
  lending_active_count           int,
  charges_received_cents         bigint,
  tax_year_start                 date,
  borrowing_owed_cents           bigint,
  borrowing_overdue_cents        bigint,
  borrowing_overdue_count        int,
  borrowing_next_due_on          date,
  borrowing_next_due_cents       bigint,
  borrowing_active_count         int,
  replies_needed                 int,
  funds_to_send                  int,
  claims_to_confirm              int,
  claims_disputed                int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
begin
  tax_year_start := private.tax_year_start(private.nz_today());

  -- Money lent and owed, from the same balance function the loan list uses.
  select coalesce(sum(b.outstanding_cents) filter (where l.status = 'active'), 0),
         coalesce(sum(b.overdue_cents), 0),
         coalesce(sum(b.overdue_count), 0),
         count(*) filter (where l.status = 'active')
  into lending_owed_cents, lending_overdue_cents, lending_overdue_count, lending_active_count
  from public.list_loan_balances() b
  join public.loans l on l.id = b.loan_id
  where l.lender_id = v_user_id;

  select coalesce(sum(t.principal_cents), 0)
  into lending_total_lent_cents
  from public.loans l
  join public.loan_terms t on t.id = l.current_terms_id
  where l.lender_id = v_user_id and l.status in ('active', 'completed', 'written_off');

  -- Charges received this tax year (DB-04), from how each payment was split.
  select coalesce(sum(r.charge_cents), 0)
  into charges_received_cents
  from public.loans l
  cross join lateral private.replay_payments(l.id) r
  where l.lender_id = v_user_id
    and l.status in ('active', 'completed', 'written_off')
    and r.received_on >= tax_year_start;

  select coalesce(sum(b.outstanding_cents) filter (where l.status = 'active'), 0),
         coalesce(sum(b.overdue_cents), 0),
         coalesce(sum(b.overdue_count), 0),
         count(*) filter (where l.status = 'active'),
         min(b.next_due_on) filter (where l.status = 'active')
  into borrowing_owed_cents, borrowing_overdue_cents, borrowing_overdue_count,
       borrowing_active_count, borrowing_next_due_on
  from public.list_loan_balances() b
  join public.loans l on l.id = b.loan_id
  where l.borrower_id = v_user_id;

  select sum(b.next_due_cents)
  into borrowing_next_due_cents
  from public.list_loan_balances() b
  join public.loans l on l.id = b.loan_id
  where l.borrower_id = v_user_id and l.status = 'active' and b.next_due_on = borrowing_next_due_on;

  -- Things waiting on this user.
  select count(*) into replies_needed
  from public.loans l
  join public.loan_terms t on t.id = l.current_terms_id
  where l.status = 'negotiating'
    and v_user_id in (l.lender_id, l.borrower_id)
    and t.proposed_by <> v_user_id;

  select count(*) into funds_to_send
  from public.loans l
  where l.status = 'agreed' and l.lender_id = v_user_id;

  select count(*) into claims_to_confirm
  from public.repayments r
  join public.loans l on l.id = r.loan_id
  where r.status = 'claimed' and l.lender_id = v_user_id and l.status = 'active';

  select count(*) into claims_disputed
  from public.repayments r
  join public.loans l on l.id = r.loan_id
  where r.status = 'disputed' and l.borrower_id = v_user_id and l.status = 'active';

  return next;
end;
$$;


-- =============================================================================
-- Upcoming and overdue instalments across all active loans
-- =============================================================================
create function public.list_upcoming_instalments(p_limit int default 10)
returns table (
  loan_id           uuid,
  role              text,
  other_person_name text,
  sequence          int,
  due_on            date,
  remaining_cents   bigint,
  status            text
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id,
         case when l.lender_id = (select auth.uid()) then 'lender' else 'borrower' end,
         case when l.lender_id = (select auth.uid()) then b.display_name else le.display_name end,
         p.sequence, p.due_on, p.amount_cents - p.paid_cents,
         case when p.due_on < private.nz_today() then 'overdue' else 'due' end
  from public.loans l
  join public.profiles le on le.id = l.lender_id
  join public.profiles b on b.id = l.borrower_id
  cross join lateral private.instalment_progress(l.id) p
  where l.status = 'active'
    and (select auth.uid()) in (l.lender_id, l.borrower_id)
    and p.paid_cents < p.amount_cents
  order by p.due_on, l.created_at, p.sequence
  limit greatest(least(coalesce(p_limit, 10), 50), 1);
$$;


-- =============================================================================
-- Borrower track records, for the lender only (DB-03, ADR-0011)
--
-- An instalment counts once it's been paid in full, or once it's past due on
-- an active loan:
--   * on time: fully paid on or before its due date;
--   * late:    fully paid after its due date, or still unpaid past it.
-- Days late = (date fully paid, or today if unpaid) − due date.
-- Instalments forgiven by a write-off are left out.
-- =============================================================================
create function public.list_borrower_records()
returns table (
  relationship_id      uuid,
  borrower_id          uuid,
  borrower_name        text,
  connected_since      timestamptz,
  ended_at             timestamptz,
  loans_funded         int,
  loans_open           int,
  total_borrowed_cents bigint,
  total_repaid_cents   bigint,
  owed_cents           bigint,
  overdue_cents        bigint,
  instalments_assessed int,
  instalments_on_time  int,
  instalments_late     int,
  average_days_late    numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select r.id, r.borrower_id, r.created_at, r.ended_at, p.display_name
    from public.lending_relationships r
    join public.profiles p on p.id = r.borrower_id
    where r.lender_id = (select auth.uid())
  ),
  funded as (
    select l.id, l.relationship_id, l.status, t.principal_cents, t.charge_cents
    from public.loans l
    join public.loan_terms t on t.id = l.current_terms_id
    join mine m on m.id = l.relationship_id
    where l.status in ('active', 'completed', 'written_off')
  ),
  instalments as (
    select f.relationship_id, f.status as loan_status, p.*
    from funded f
    cross join lateral private.instalment_progress(f.id) p
  ),
  assessed as (
    select i.relationship_id,
           case
             when i.paid_on is not null then i.paid_on - i.due_on
             when i.loan_status = 'active' and i.due_on < private.nz_today() then private.nz_today() - i.due_on
           end as days_late
    from instalments i
  ),
  stats as (
    select a.relationship_id,
           count(a.days_late)::int as assessed,
           count(*) filter (where a.days_late <= 0)::int as on_time,
           count(*) filter (where a.days_late > 0)::int as late,
           round(avg(a.days_late) filter (where a.days_late > 0), 1) as avg_late
    from assessed a
    group by a.relationship_id
  ),
  money as (
    select f.relationship_id,
           count(*)::int as funded,
           count(*) filter (where f.status = 'active')::int as open,
           sum(f.principal_cents)::bigint as borrowed,
           sum(private.loan_paid_cents(f.id))::bigint as repaid,
           sum(case when f.status = 'active'
                    then f.principal_cents + f.charge_cents - private.loan_paid_cents(f.id) else 0 end)::bigint as owed
    from funded f
    group by f.relationship_id
  ),
  overdue as (
    select i.relationship_id, sum(i.amount_cents - i.paid_cents)::bigint as overdue
    from instalments i
    where i.loan_status = 'active' and i.paid_cents < i.amount_cents and i.due_on < private.nz_today()
    group by i.relationship_id
  )
  select m.id, m.borrower_id, m.display_name, m.created_at, m.ended_at,
         coalesce(mo.funded, 0), coalesce(mo.open, 0),
         coalesce(mo.borrowed, 0), coalesce(mo.repaid, 0), coalesce(mo.owed, 0),
         coalesce(o.overdue, 0),
         coalesce(s.assessed, 0), coalesce(s.on_time, 0), coalesce(s.late, 0), s.avg_late
  from mine m
  left join money mo on mo.relationship_id = m.id
  left join stats s on s.relationship_id = m.id
  left join overdue o on o.relationship_id = m.id
  order by m.ended_at nulls first, m.display_name;
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
  public.get_dashboard_summary(),
  public.list_upcoming_instalments(int),
  public.list_borrower_records()
from public, anon;

grant execute on function
  public.get_dashboard_summary(),
  public.list_upcoming_instalments(int),
  public.list_borrower_records()
to authenticated;
