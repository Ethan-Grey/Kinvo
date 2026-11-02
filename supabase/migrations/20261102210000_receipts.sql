-- =============================================================================
-- Receipts (ADR-0016)
--
-- Every movement of money needs a photo of the receipt or bank statement:
-- the lender sending the loan, a payment the lender records, and a payment
-- the borrower says they've made. The image lives in a private Storage
-- bucket; only the two people on the loan can upload or view it.
--
-- The app re-encodes every image to a fresh JPEG before uploading, which
-- drops metadata and anything hidden in the file. The bucket only accepts
-- JPEG or WebP up to 5 MB, and the database only accepts a path inside the
-- loan's own folder that really exists in the bucket.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- The loan a receipt file belongs to, from its path ("<loan id>/<file>"),
-- or null if the path isn't in that shape.
create function private.receipt_loan_id(p_path text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|webp)$'
    then split_part(p_path, '/', 1)::uuid
  end;
$$;

-- Raises unless p_path is an uploaded receipt in this loan's folder.
create function private.require_receipt(p_loan_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
begin
  if p_path is null or btrim(p_path) = '' then
    raise exception 'receipt_required';
  elsif private.receipt_loan_id(p_path) is distinct from p_loan_id then
    raise exception 'invalid_receipt';
  end if;

  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)'
      into v_exists using 'receipts', p_path;
    if not v_exists then
      raise exception 'receipt_not_uploaded';
    end if;
  end if;
  return p_path;
end;
$$;

-- -----------------------------------------------------------------------------
-- The private bucket and who may use it (only where Supabase Storage exists)
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/webp'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    -- Files are stored as <loan id>/<random id>.jpg. Both people on the loan
    -- can add and view receipts in its folder. Nobody can change or delete one.
    execute $p$
      create policy "Loan parties view receipts" on storage.objects for select to authenticated
      using (bucket_id = 'receipts' and private.is_loan_party(private.receipt_loan_id(name)))
    $p$;
    execute $p$
      create policy "Loan parties upload receipts" on storage.objects for insert to authenticated
      with check (bucket_id = 'receipts' and private.is_loan_party(private.receipt_loan_id(name)))
    $p$;
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- Where receipts are recorded
-- -----------------------------------------------------------------------------
alter table public.repayments add column receipt_path text;
alter table public.loans add column funds_receipt_path text;

comment on column public.repayments.receipt_path is 'Path in the receipts bucket. Required for payments recorded from now on.';
comment on column public.loans.funds_receipt_path is 'Path in the receipts bucket for the lender sending the money.';


-- -----------------------------------------------------------------------------
-- record_repayment and confirm_funds_sent now take a receipt.
--
-- The existing functions do all the checking and recording; they move to the
-- private schema unchanged, and the public versions wrap them. The receipt is
-- checked after the payment's own checks, so their error messages still come
-- first; if the receipt is missing, the whole call is undone.
-- -----------------------------------------------------------------------------
alter function public.record_repayment(uuid, bigint, date, public.payment_method, text, text) set schema private;
alter function private.record_repayment(uuid, bigint, date, public.payment_method, text, text) rename to record_repayment_unchecked;
alter function public.confirm_funds_sent(uuid, date, public.payment_method, text) set schema private;
alter function private.confirm_funds_sent(uuid, date, public.payment_method, text) rename to confirm_funds_sent_unchecked;

create function public.record_repayment(
  p_loan_id      uuid,
  p_amount_cents bigint,
  p_received_on  date,
  p_method       public.payment_method,
  p_reference    text default null,
  p_notes        text default null,
  p_receipt_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  v_id := private.record_repayment_unchecked(p_loan_id, p_amount_cents, p_received_on, p_method, p_reference, p_notes);
  update public.repayments
  set receipt_path = private.require_receipt(p_loan_id, p_receipt_path)
  where id = v_id;
  return v_id;
end;
$$;

create function public.confirm_funds_sent(
  p_loan_id      uuid,
  p_sent_on      date,
  p_method       public.payment_method,
  p_reference    text default null,
  p_receipt_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.confirm_funds_sent_unchecked(p_loan_id, p_sent_on, p_method, p_reference);
  update public.loans
  set funds_receipt_path = private.require_receipt(p_loan_id, p_receipt_path)
  where id = p_loan_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function
  private.record_repayment_unchecked(uuid, bigint, date, public.payment_method, text, text),
  private.confirm_funds_sent_unchecked(uuid, date, public.payment_method, text),
  private.require_receipt(uuid, text)
from public, anon, authenticated;

-- Storage policies call these as the signed-in user.
revoke all on function private.receipt_loan_id(text) from public, anon;
grant execute on function private.receipt_loan_id(text) to authenticated;

revoke execute on function
  public.record_repayment(uuid, bigint, date, public.payment_method, text, text, text),
  public.confirm_funds_sent(uuid, date, public.payment_method, text, text)
from public, anon;
grant execute on function
  public.record_repayment(uuid, bigint, date, public.payment_method, text, text, text),
  public.confirm_funds_sent(uuid, date, public.payment_method, text, text)
to authenticated;
