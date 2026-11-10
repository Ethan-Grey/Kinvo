-- =============================================================================
-- Either person can add or change what a loan is for (ADR-0026).
-- =============================================================================
create function public.set_loan_reason(p_loan_id uuid, p_reason text)
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
  if v_loan.status = 'removed' then
    raise exception 'loan_not_found';
  elsif v_reason is null then
    raise exception 'loan_reason_required';
  elsif char_length(v_reason) > 500 then
    raise exception 'invalid_reason';
  elsif v_reason is not distinct from v_loan.reason then
    return;
  end if;

  update public.loans set reason = v_reason where id = p_loan_id;
  perform private.log_loan_event(
    p_loan_id, 'reason_changed', jsonb_build_object('from', v_loan.reason, 'to', v_reason)
  );
end;
$$;

revoke execute on function public.set_loan_reason(uuid, text) from public, anon;
grant execute on function public.set_loan_reason(uuid, text) to authenticated;
