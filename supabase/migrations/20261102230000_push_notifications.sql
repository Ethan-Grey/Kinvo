-- =============================================================================
-- Phone notifications (Web Push, ADR-0017)
--
-- Each device that turns on notifications stores a push subscription. Every
-- new notification is pushed to the recipient's devices as well as emailed,
-- straight away: a trigger calls the sender as soon as notifications are
-- written, instead of waiting for the 5-minute schedule (which stays as a
-- fallback). The push only carries the title, a short text and an in-app link.
-- =============================================================================

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  endpoint     text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh       text not null check (char_length(p256dh) between 20 and 200),
  auth         text not null check (char_length(auth) between 10 and 100),
  user_agent   text check (char_length(user_agent) <= 300),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;
alter table public.push_subscriptions enable row level security;
create policy "Users see their own devices" on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

alter table public.notifications
  add column push_status text not null default 'pending'
    check (push_status in ('pending', 'sending', 'sent', 'none', 'failed'));

-- Existing alerts are history; don't push them now.
update public.notifications set push_status = 'none';

create index notifications_pending_push_idx on public.notifications (created_at) where push_status in ('pending', 'sending');


-- -----------------------------------------------------------------------------
-- This device: turn notifications on or off
-- -----------------------------------------------------------------------------
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_user();
begin
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_user_id, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end;
$$;

create function public.delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = (select auth.uid());
$$;


-- -----------------------------------------------------------------------------
-- The push outbox (for the send-notifications function only)
-- -----------------------------------------------------------------------------
create function public.claim_notification_pushes(p_limit int default 50)
returns table (id uuid, title text, body text, link_path text, unread int, subscriptions jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nobody to send to, or too old to be news: nothing to do.
  update public.notifications n
  set push_status = 'none'
  where n.push_status = 'pending'
    and (n.created_at < now() - interval '1 day'
         or not exists (select 1 from public.push_subscriptions s where s.user_id = n.recipient_id));

  return query
  with picked as (
    select n.id
    from public.notifications n
    where n.push_status = 'pending'
       or (n.push_status = 'sending' and n.created_at < now() - interval '10 minutes')
    order by n.created_at
    limit greatest(least(coalesce(p_limit, 50), 200), 1)
    for update skip locked
  ),
  claimed as (
    update public.notifications n
    set push_status = 'sending'
    from picked
    where n.id = picked.id
    returning n.id, n.recipient_id, n.title, n.body, n.link_path
  )
  select c.id, c.title, c.body, c.link_path,
         (select count(*)::int from public.notifications u where u.recipient_id = c.recipient_id and u.read_at is null),
         (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
          from public.push_subscriptions s where s.user_id = c.recipient_id)
  from claimed c;
end;
$$;

-- p_gone: endpoints the push service says no longer exist (the person
-- uninstalled the app or turned notifications off); they're forgotten.
create function public.finish_notification_push(p_id uuid, p_ok boolean, p_gone text[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications set push_status = case when p_ok then 'sent' else 'failed' end where id = p_id;
  delete from public.push_subscriptions where endpoint = any (coalesce(p_gone, '{}'));
  if p_ok then
    update public.push_subscriptions s set last_used_at = now()
    from public.notifications n
    where n.id = p_id and s.user_id = n.recipient_id;
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- Send straight away: when notifications are written, wake the sender.
-- pg_net makes the call after the transaction commits, so actions stay fast.
-- -----------------------------------------------------------------------------
create function private.wake_sender()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    perform private.trigger_email_sender();
  end if;
  return null;
end;
$$;

create trigger wake_sender_on_notification
  after insert on public.notifications
  for each statement execute function private.wake_sender();


-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function private.wake_sender() from public, anon, authenticated;
revoke execute on function
  public.save_push_subscription(text, text, text, text),
  public.delete_push_subscription(text)
from public, anon;
grant execute on function
  public.save_push_subscription(text, text, text, text),
  public.delete_push_subscription(text)
to authenticated;
revoke execute on function
  public.claim_notification_pushes(int),
  public.finish_notification_push(uuid, boolean, text[])
from public, anon, authenticated;
grant execute on function
  public.claim_notification_pushes(int),
  public.finish_notification_push(uuid, boolean, text[])
to service_role;
