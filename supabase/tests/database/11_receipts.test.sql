-- =============================================================================
-- Tests for receipts: every movement of money needs one (ADR-0016).
-- Run with:  npx supabase test db
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'lena@example.test', '{"full_name": "Lena Lender"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test',  '{"full_name": "Bob Borrower"}');
update public.profiles set can_lend = true where id = '00000000-0000-4000-8000-00000000000a';
insert into public.lending_relationships (id, lender_id, borrower_id) values (
  '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');

select set_config('test.today', ((now() at time zone 'Pacific/Auckland')::date)::text, true);

-- An uploaded receipt in a loan's folder (inserted directly, as the app's upload would).
create function pg_temp.receipt(p_loan uuid) returns text language plpgsql security definer as $h$
declare v_path text := p_loan || '/' || gen_random_uuid() || '.jpg';
begin
  if to_regclass('storage.objects') is not null then
    execute 'insert into storage.objects (bucket_id, name) values ($1, $2)' using 'receipts', v_path;
  end if;
  return v_path;
end
$h$;
grant execute on all functions in schema pg_temp to authenticated;

-- Lena offers, Bob accepts.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select set_config('test.loan', public.create_loan('00000000-0000-4000-8000-0000000000e1', 20000, 0,
  jsonb_build_array(jsonb_build_object('due_on', (current_setting('test.today')::date + 7)::text, 'amount_cents', 20000)), 'Test reason')::text, true);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select public.accept_terms(l.id, t.id, t.terms_hash)
from public.loans l join public.loan_terms t on t.id = l.current_terms_id where l.id = current_setting('test.loan')::uuid;

-- Sending the money
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a"}', true);
select throws_ok(
  format('select public.confirm_funds_sent(%L, %L, %L)', current_setting('test.loan'), current_setting('test.today'), 'bank_transfer'),
  'P0001', 'receipt_required', 'sending the money needs a receipt'
);
select is((select status::text from public.loans where id = current_setting('test.loan')::uuid), 'agreed',
  'and nothing changes without one');
select throws_ok(
  format('select public.confirm_funds_sent(%L, %L, %L, null, %L)', current_setting('test.loan'), current_setting('test.today'),
    'bank_transfer', gen_random_uuid() || '/' || gen_random_uuid() || '.jpg'),
  'P0001', 'invalid_receipt', 'a receipt from another loan''s folder isn''t accepted'
);
select throws_ok(
  format('select public.confirm_funds_sent(%L, %L, %L, null, %L)', current_setting('test.loan'), current_setting('test.today'),
    'bank_transfer', current_setting('test.loan') || '/../evil.svg'),
  'P0001', 'invalid_receipt', 'nor a path that isn''t a plain image name'
);
select case
  when to_regclass('storage.objects') is null then skip('Supabase Storage isn''t available here', 1)
  else throws_ok(
    format('select public.confirm_funds_sent(%L, %L, %L, null, %L)', current_setting('test.loan'), current_setting('test.today'),
      'bank_transfer', current_setting('test.loan') || '/' || gen_random_uuid() || '.jpg'),
    'P0001', 'receipt_not_uploaded', 'nor one that was never uploaded')
end;
select set_config('test.funds_receipt', pg_temp.receipt(current_setting('test.loan')::uuid), true);
select lives_ok(
  format('select public.confirm_funds_sent(%L, %L, %L, null, %L)', current_setting('test.loan'), current_setting('test.today'),
    'bank_transfer', current_setting('test.funds_receipt')),
  'with an uploaded receipt the loan starts'
);

-- Payments
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b"}', true);
select throws_ok(
  format('select public.record_repayment(%L, 5000, %L, %L)', current_setting('test.loan'), current_setting('test.today'), 'cash'),
  'P0001', 'receipt_required', 'a payment needs a receipt'
);
select set_config('test.pay_receipt', pg_temp.receipt(current_setting('test.loan')::uuid), true);
select set_config('test.payment', public.record_repayment(current_setting('test.loan')::uuid, 5000,
  current_setting('test.today')::date, 'cash', p_receipt_path => current_setting('test.pay_receipt'))::text, true);
reset role;

select is(
  (select receipt_path from public.repayments where id = current_setting('test.payment')::uuid),
  current_setting('test.pay_receipt'), 'the payment keeps its receipt'
);
select is(
  (select funds_receipt_path from public.loans where id = current_setting('test.loan')::uuid),
  current_setting('test.funds_receipt'), 'and so does the money sent'
);

select * from finish();
rollback;
