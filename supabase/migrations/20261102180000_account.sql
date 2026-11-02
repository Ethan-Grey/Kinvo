-- =============================================================================
-- M7: Account settings
--
-- * An "Email me" switch (NT-05). The in-app list always works; only email
--   stops. Emails already queued when someone switches off are skipped too.
-- * "Download my data" (Privacy Act 2020, principle 6: access to personal
--   information). The export is built with the caller's own permissions, so
--   it can only ever contain what they could already see in the app.
-- =============================================================================

alter table public.profiles
  add column email_notifications boolean not null default true;

comment on column public.profiles.email_notifications is
  'False when the user has switched off notification emails. In-app notifications are unaffected.';

alter table public.notifications drop constraint notifications_email_status_check;
alter table public.notifications add constraint notifications_email_status_check
  check (email_status in ('pending', 'sending', 'sent', 'failed', 'skipped'));


-- -----------------------------------------------------------------------------
-- Switch notification emails on or off for yourself
-- -----------------------------------------------------------------------------
create function public.set_email_notifications(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
begin
  if p_enabled is null then
    raise exception 'invalid_setting';
  end if;

  update public.profiles set email_notifications = p_enabled where id = v_user_id;
  perform private.log_event('email_notifications_changed', null, jsonb_build_object('enabled', p_enabled));
end;
$$;


-- -----------------------------------------------------------------------------
-- The email outbox now skips people who have switched emails off.
-- Same signature as before; only the opt-out step is new.
-- -----------------------------------------------------------------------------
create or replace function public.claim_notification_emails(p_limit int default 20)
returns table (id uuid, email text, display_name text, title text, body text, link_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications n
  set email_status = 'skipped'
  from public.profiles p
  where p.id = n.recipient_id
    and not p.email_notifications
    and n.email_status = 'pending';

  return query
  with picked as (
    select n.id
    from public.notifications n
    where n.email_attempts < 5
      and (n.email_status = 'pending'
           or (n.email_status = 'sending' and n.created_at < now() - interval '10 minutes'))
    order by n.created_at
    limit greatest(least(coalesce(p_limit, 20), 100), 1)
    for update skip locked
  ),
  claimed as (
    update public.notifications n
    set email_status = 'sending', email_attempts = n.email_attempts + 1
    from picked
    where n.id = picked.id
    returning n.id, n.recipient_id, n.title, n.body, n.link_path
  )
  select c.id, p.email, p.display_name, c.title, c.body, c.link_path
  from claimed c join public.profiles p on p.id = c.recipient_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- Everything Kinvo holds that involves you, as one JSON document.
--
-- SECURITY INVOKER on purpose: every query below runs under the caller's own
-- Row Level Security, so the export can't reveal anything the app wouldn't.
-- Invite token hashes and email delivery internals are left out.
-- -----------------------------------------------------------------------------
create function public.export_my_data()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
begin
  return jsonb_build_object(
    'exported_at', now(),
    'format', 'kinvo-export-v1',
    'note', 'Amounts are in cents (e.g. 12550 = $125.50). Times are UTC.',
    'profile', (
      select to_jsonb(p) from public.profiles p where p.id = v_user_id
    ),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'relationship_id', r.id,
        'role', case when r.lender_id = v_user_id then 'lender' else 'borrower' end,
        'other_person', o.display_name,
        'connected_at', r.created_at,
        'ended_at', r.ended_at
      ) order by r.created_at)
      from public.lending_relationships r
      join public.profiles o on o.id = case when r.lender_id = v_user_id then r.borrower_id else r.lender_id end
    ), '[]'::jsonb),
    'loans', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from public.loans l), '[]'::jsonb),
    'loan_terms', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.loan_terms t), '[]'::jsonb),
    'instalments', coalesce((select jsonb_agg(to_jsonb(i) order by i.terms_id, i.sequence) from public.instalments i), '[]'::jsonb),
    'agreements', coalesce((select jsonb_agg(to_jsonb(a) order by a.accepted_at) from public.term_acceptances a), '[]'::jsonb),
    'repayments', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.repayments r), '[]'::jsonb),
    'invites_created', coalesce((
      select jsonb_agg(to_jsonb(i) - 'token_hash' order by i.created_at) from public.lender_invites i
    ), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', n.kind, 'title', n.title, 'body', n.body, 'loan_id', n.loan_id,
        'created_at', n.created_at, 'read_at', n.read_at, 'emailed_at', n.email_sent_at
      ) order by n.created_at)
      from public.notifications n
    ), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.audit_events e), '[]'::jsonb)
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke execute on function
  public.set_email_notifications(boolean),
  public.export_my_data()
from public, anon;
grant execute on function
  public.set_email_notifications(boolean),
  public.export_my_data()
to authenticated;

-- export_my_data runs as the caller, so it needs require_user (security definer).
grant execute on function private.require_user() to authenticated;

revoke execute on function public.claim_notification_emails(int) from public, anon, authenticated;
grant execute on function public.claim_notification_emails(int) to service_role;
