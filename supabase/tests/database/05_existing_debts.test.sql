-- =============================================================================
-- Tests for existing debts attached to invites (ADR-0012).
-- Run with:  npx supabase test db
--
-- Lena already lent Bob money before Kinvo. She invites him with a $300 debt
-- (originally lent 60 days ago), repaid as 2 × $150. Bob joins and confirms.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- Every payment and money-sent needs a receipt (ADR-0016). These stand-ins
-- upload one and pass it along, so the tests can focus on the payment rules.
create function pg_temp.receipt(p_loan uuid) returns text language plpgsql security definer as $h$
declare v_path text := p_loan || '/' || gen_random_uuid() || '.jpg';
begin
  if to_regclass('storage.objects') is not null then
    execute 'insert into storage.objects (bucket_id, name) values ($1, $2)' using 'receipts', v_path;
  end if;
  return v_path;
end
$h$;
create function pg_temp.record_repayment(
  p_loan uuid, p_amount bigint, p_on date, p_method public.payment_method, p_ref text default null, p_notes text default null
) returns uuid language sql as $h$
  select public.record_repayment(p_loan, p_amount, p_on, p_method, p_ref, p_notes, pg_temp.receipt(p_loan));
$h$;
create function pg_temp.confirm_funds_sent(p_loan uuid, p_on date, p_method public.payment_method, p_ref text default null)
returns void language sql as $h$
  select public.confirm_funds_sent(p_loan, p_on, p_method, p_ref, pg_temp.receipt(p_loan));
$h$;
grant execute on all functions in schema pg_temp to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'lena@example.test', '{"full_name": "Lena Lender"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test',  '{"full_name": "Bob Borrower"}'),
  ('00000000-0000-4000-8000-00000000000c', 'cara@example.test', '{"full_name": "Cara Cousin"}');
update public.profiles set can_lend = true where id = '00000000-0000-4000-8000-00000000000a';

select set_config('test.today', ((now() at time zone 'Pacific/Auckland')::date)::text, true);
select set_config('test.lent_on', (current_setting('test.today')::date - 60)::text, true);

create function pg_temp.debt(amount bigint, lent_on text, d1 text, a1 bigint, d2 text, a2 bigint) returns jsonb
language sql as $$
  select jsonb_build_object(
    'amount_cents', amount, 'lent_on', lent_on, 'reason', 'Car rego from August',
    'late_terms', 'Tell me if you''ll be late',
    'instalments', jsonb_build_array(
      jsonb_build_object('due_on', d1, 'amount_cents', a1),
      jsonb_build_object('due_on', d2, 'amount_cents', a2)));
$$;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);


-- -----------------------------------------------------------------------------
-- Validation when the invite is created
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ select public.create_invite('Bob', pg_temp.debt(30000, current_setting('test.lent_on'),
       (current_setting('test.today')::date + 7)::text, 15000, (current_setting('test.today')::date + 14)::text, 14999)) $$,
  'P0001', 'schedule_total_mismatch', 'the plan must add up to the amount owed'
);
select throws_ok(
  $$ select public.create_invite('Bob', pg_temp.debt(30000, (current_setting('test.today')::date + 1)::text,
       (current_setting('test.today')::date + 7)::text, 15000, (current_setting('test.today')::date + 14)::text, 15000)) $$,
  'P0001', 'invalid_lent_date', 'the original lending date cannot be in the future'
);
select throws_ok(
  $$ select public.create_invite('Bob', pg_temp.debt(30000, current_setting('test.lent_on'),
       (current_setting('test.today')::date - 1)::text, 15000, (current_setting('test.today')::date + 14)::text, 15000)) $$,
  'P0001', 'schedule_date_in_past', 'repayment dates cannot already be in the past when writing the invite'
);
select throws_ok(
  $$ select public.create_invite('Bob', '{"amount_cents": "lots"}'::jsonb) $$,
  'P0001', 'invalid_existing_debt', 'malformed debt details are rejected'
);
select lives_ok(
  $$ select set_config('test.token', (select token from public.create_invite('Bob', pg_temp.debt(30000, current_setting('test.lent_on'),
       (current_setting('test.today')::date + 7)::text, 15000, (current_setting('test.today')::date + 14)::text, 15000))), true) $$,
  'a lender can attach an existing debt to an invite'
);
select lives_ok(
  $$ select set_config('test.plain', (select token from public.create_invite('Cara')), true) $$,
  'invites without a debt still work'
);


-- -----------------------------------------------------------------------------
-- Bob sees the debt before joining, then joins
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);

select is(
  (select debt_amount_cents || ' / ' || debt_lent_on || ' / ' || debt_reason from public.preview_invite(current_setting('test.token'))),
  '30000 / ' || current_setting('test.lent_on') || ' / Car rego from August',
  'the invite preview shows the existing debt'
);
select lives_ok(
  format('select public.accept_invite(%L)', current_setting('test.token')),
  'accepting the invite works'
);
select set_config('test.loan', (select id::text from public.loans where kind = 'existing_debt'), true);
select is(
  (select status::text || ' / ' || kind || ' / ' || originally_lent_on from public.loans where id = current_setting('test.loan')::uuid),
  'negotiating / existing_debt / ' || current_setting('test.lent_on'),
  'joining creates the debt as a proposal waiting for Bob'
);
select is(
  (select t.proposed_by::text || ' / ' || t.principal_cents || ' / ' || t.charge_cents
   from public.loan_terms t join public.loans l on l.current_terms_id = t.id where l.id = current_setting('test.loan')::uuid),
  '00000000-0000-4000-8000-00000000000a / 30000 / 0',
  'the debt is proposed by the lender, for the amount owed, with no charge'
);
select is(
  (select count(*)::int from public.list_loan_balances() where loan_id = current_setting('test.loan')::uuid),
  0, 'an unconfirmed debt doesn''t count towards balances'
);
select throws_ok(
  format('select pg_temp.record_repayment(%L, 1000, %L, %L)', current_setting('test.loan'), current_setting('test.today'), 'cash'),
  'P0001', 'loan_not_active', 'nothing can be paid on an unconfirmed debt'
);


-- -----------------------------------------------------------------------------
-- Bob confirms: the debt is active immediately, dated from the original loan
-- -----------------------------------------------------------------------------
select lives_ok(
  format($f$ select public.accept_terms(l.id, t.id, t.terms_hash)
             from public.loans l join public.loan_terms t on t.id = l.current_terms_id where l.id = %L $f$,
    current_setting('test.loan')),
  'the borrower can confirm the debt'
);
select is(
  (select status::text || ' / ' || funds_sent_on from public.loans where id = current_setting('test.loan')::uuid),
  'active / ' || current_setting('test.lent_on'),
  'a confirmed debt is active straight away, dated from when the money was lent'
);
select is(
  (select outstanding_cents from public.list_loan_balances() where loan_id = current_setting('test.loan')::uuid),
  30000::bigint, 'the full amount is owed once confirmed'
);
select lives_ok(
  format('select pg_temp.record_repayment(%L, 5000, %L, %L)', current_setting('test.loan'), current_setting('test.today'), 'cash'),
  'the borrower can now say they''ve paid'
);
select is(
  (select string_agg(event_type, ',' order by id) from public.audit_events where loan_id = current_setting('test.loan')::uuid),
  'existing_debt_proposed,existing_debt_confirmed,repayment_claimed',
  'the debt''s history is in the audit trail'
);


-- -----------------------------------------------------------------------------
-- A plain invite creates no loan; a late join keeps past due dates
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c"}', true);
select public.accept_invite(current_setting('test.plain'));
select is((select count(*)::int from public.loans), 0, 'a plain invite creates no loan');

-- Lena's next invite to Cara is accepted after its first due date has passed.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select set_config('test.late_token', (select token from public.create_invite('Cara again', pg_temp.debt(30000, current_setting('test.lent_on'),
  (current_setting('test.today')::date + 1)::text, 15000, (current_setting('test.today')::date + 14)::text, 15000))), true);
reset role;
update public.lender_invites
set existing_debt = jsonb_set(existing_debt, '{instalments,0,due_on}', to_jsonb((current_setting('test.today')::date - 3)::text))
where note = 'Cara again';
set local role authenticated;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c"}', true);
select lives_ok(
  format('select public.accept_invite(%L)', current_setting('test.late_token')),
  'joining still works when a due date has passed since the invite was written'
);
select is(
  (select min(i.due_on)::text from public.instalments i
   join public.loans l on l.current_terms_id = i.terms_id where l.borrower_id = '00000000-0000-4000-8000-00000000000c'),
  (current_setting('test.today')::date - 3)::text,
  'the original dates are kept, so the borrower can confirm or suggest new ones'
);

select * from finish();
rollback;
