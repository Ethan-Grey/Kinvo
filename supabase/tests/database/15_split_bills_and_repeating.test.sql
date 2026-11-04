-- =============================================================================
-- Tests for split bills and repeating debts (ADR-0020).
-- Run with:  npx supabase test db
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(29);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'ethan@example.test', '{"full_name": "Ethan Grey"}'),
  ('00000000-0000-4000-8000-00000000000b', 'hana@example.test',  '{"full_name": "Hana Grey"}'),
  ('00000000-0000-4000-8000-00000000000c', 'sam@example.test',   '{"full_name": "Sam Flat"}'),
  ('00000000-0000-4000-8000-00000000000d', 'casey@example.test', '{"full_name": "Casey Outsider"}');
insert into public.lending_relationships (id, lender_id, borrower_id) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c');

select set_config('test.today', ((now() at time zone 'Pacific/Auckland')::date)::text, true);
create function pg_temp.d(p_offset int) returns date language sql as $$
  select current_setting('test.today')::date + p_offset;
$$;
create function pg_temp.receipt(p_loan uuid) returns text language plpgsql security definer as $h$
declare v_path text := p_loan || '/' || gen_random_uuid() || '.jpg';
begin
  if to_regclass('storage.objects') is not null then
    execute 'insert into storage.objects (bucket_id, name) values ($1, $2)' using 'receipts', v_path;
  end if;
  return v_path;
end
$h$;
create function pg_temp.kind_count(p_kind text) returns int language sql security definer as $$
  select count(*)::int from public.notifications where kind = p_kind;
$$;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated;

-- =============================================================================
-- Split bills: Ethan paid $120 of groceries, Hana and Sam owe $40 each.
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select throws_ok(
  format($$ select public.create_split_bill('Groceries', 12000, %L, %L,
    '[{"relationship_id": "00000000-0000-4000-8000-0000000000e1", "amount_cents": 8000},
      {"relationship_id": "00000000-0000-4000-8000-0000000000e2", "amount_cents": 8000}]') $$, pg_temp.d(0), pg_temp.d(7)),
  'P0001', 'split_more_than_total', 'shares can''t add up to more than the bill'
);
select set_config('test.bills', (select public.create_split_bill('Groceries', 12000, pg_temp.d(0), pg_temp.d(7),
  '[{"relationship_id": "00000000-0000-4000-8000-0000000000e1", "amount_cents": 4000},
    {"relationship_id": "00000000-0000-4000-8000-0000000000e2", "amount_cents": 4000}]'))::text, true);
select set_config('test.hana_bill', (current_setting('test.bills')::uuid[])[1]::text, true);
select is(cardinality(current_setting('test.bills')::uuid[]), 2, 'one debt per person');
select is(
  (select array_agg(t.principal_cents order by l.borrower_id) from public.loans l
   join public.loan_terms t on t.id = l.current_terms_id where l.id = any(current_setting('test.bills')::uuid[])),
  array[4000, 4000]::bigint[], 'each for their share'
);
select is((select status::text from public.loans where id = current_setting('test.hana_bill')::uuid), 'negotiating',
  'waiting for each person to accept');
select lives_ok(
  format('select public.attach_bill_receipt(%L, %L)', current_setting('test.hana_bill'),
    pg_temp.receipt(current_setting('test.hana_bill')::uuid)),
  'the receipt is attached to each share'
);
select throws_ok(
  format('select public.attach_bill_receipt(%L, %L)', current_setting('test.hana_bill'),
    pg_temp.receipt((current_setting('test.bills')::uuid[])[2])),
  'P0001', 'invalid_receipt', 'from that share''s own folder only'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select is((select count(*)::int from public.loans), 1, 'Hana sees only her share');
select is(
  (select title from public.notifications where kind = 'bill_shared'),
  'Ethan Grey split Groceries with you', 'and is told about it'
);
select lives_ok(
  format('select public.accept_terms(%L, l.current_terms_id, t.terms_hash) from public.loans l join public.loan_terms t on t.id = l.current_terms_id where l.id = %L',
    current_setting('test.hana_bill'), current_setting('test.hana_bill')),
  'Hana accepts her share'
);
select is(
  (select status::text || ' ' || funds_sent_on::text from public.loans where id = current_setting('test.hana_bill')::uuid),
  'active ' || pg_temp.d(0)::text, 'it''s active straight away, dated when the bill was paid'
);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select is((select title from public.notifications where kind = 'bill_accepted'), 'Hana Grey accepted their share',
  'Ethan is told');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d"}', true);
select throws_ok(
  format($$ select public.create_split_bill('Pizza', 3000, %L, %L,
    '[{"relationship_id": "00000000-0000-4000-8000-0000000000e1", "amount_cents": 1000}]') $$, pg_temp.d(0), pg_temp.d(7)),
  'P0001', 'relationship_not_found', 'you can only split with people you''re connected to'
);


-- =============================================================================
-- Repeating debts: Hana's rent share, $150 every week from today.
-- =============================================================================
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select throws_ok(
  format($$ select public.propose_repeating_debt('00000000-0000-4000-8000-0000000000e1', 'Rent', 15000, 'weekly', %L) $$, pg_temp.d(0)),
  'P0001', 'lender_only', 'only the person owed can set one up'
);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select set_config('test.rent', public.propose_repeating_debt(
  '00000000-0000-4000-8000-0000000000e1', 'Rent', 15000, 'weekly', pg_temp.d(0), pg_temp.d(14))::text, true);
select is((select count(*)::int from public.loans where repeating_debt_id is not null), 0, 'nothing is owed until accepted');
select throws_ok(
  format('select public.respond_repeating_debt(%L, true)', current_setting('test.rent')),
  'P0001', 'borrower_only', 'Ethan can''t accept his own'
);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select is((select link_path from public.notifications where kind = 'repeating_proposed'),
  '/repeating/' || current_setting('test.rent'), 'Hana is asked, with a link to it');
select lives_ok(format('select public.respond_repeating_debt(%L, true)', current_setting('test.rent')), 'Hana accepts once');
select is(
  (select count(*)::int from public.loans where repeating_debt_id = current_setting('test.rent')::uuid and status = 'active'),
  1, 'the first one, due today, is created straight away'
);
select is(
  (select next_on from public.repeating_debts where id = current_setting('test.rent')::uuid), pg_temp.d(7),
  'the next is a week later'
);
select ok(
  (select count(*) = 2 from public.term_acceptances a join public.loans l on l.current_terms_id = a.terms_id
   where l.repeating_debt_id = current_setting('test.rent')::uuid),
  'both people''s agreement is on record'
);
reset role;

select private.create_repeating_debts(pg_temp.d(7));
select private.create_repeating_debts(pg_temp.d(7));
select is((select count(*)::int from public.loans where repeating_debt_id = current_setting('test.rent')::uuid), 2,
  'each one is created once');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select lives_ok(format('select public.change_repeating_amount(%L, 17500)', current_setting('test.rent')),
  'Ethan changes the amount');
reset role;
select private.create_repeating_debts(pg_temp.d(14));
select is(
  (select array_agg(t.principal_cents order by l.originally_lent_on) from public.loans l
   join public.loan_terms t on t.id = l.current_terms_id where l.repeating_debt_id = current_setting('test.rent')::uuid),
  array[15000, 15000, 17500]::bigint[], 'only future ones change'
);
select is((select status from public.repeating_debts where id = current_setting('test.rent')::uuid), 'stopped',
  'it stops after the end date');

-- Pausing skips what's missed.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select set_config('test.power', public.propose_repeating_debt(
  '00000000-0000-4000-8000-0000000000e2', 'Power', 4000, 'monthly', pg_temp.d(1))::text, true);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c"}', true);
select public.respond_repeating_debt(current_setting('test.power')::uuid, true);
select throws_ok(format('select public.set_repeating_status(%L, %L)', current_setting('test.power'), 'paused'),
  'P0001', 'lender_only', 'only the person owed can pause');
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select public.set_repeating_status(current_setting('test.power')::uuid, 'paused');
reset role;
select private.create_repeating_debts(pg_temp.d(40));
select is((select count(*)::int from public.loans where repeating_debt_id = current_setting('test.power')::uuid), 0,
  'nothing is created while paused');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c"}', true);
select lives_ok(format('select public.set_repeating_status(%L, %L)', current_setting('test.power'), 'stopped'),
  'either person can stop it');
select is((select count(*)::int from public.repeating_debts), 1, 'Sam only sees his own');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d"}', true);
select is((select count(*)::int from public.repeating_debts), 0, 'outsiders see none');
reset role;

select * from finish();
rollback;
