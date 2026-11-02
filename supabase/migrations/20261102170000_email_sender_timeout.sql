-- =============================================================================
-- Give the email sender time to finish.
--
-- pg_net gives up waiting after 5 seconds by default. A cold start of the
-- send-notifications function, plus sending a batch through Gmail, can take
-- longer. The function keeps running either way, but the call is logged as a
-- timeout, which hides real failures. Wait up to 60 seconds instead.
-- =============================================================================
create or replace function private.trigger_email_sender()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'kinvo_send_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'kinvo_send_key';
  if v_url is null or v_key is null then
    return; -- not configured yet
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function private.trigger_email_sender() from public, anon, authenticated;
