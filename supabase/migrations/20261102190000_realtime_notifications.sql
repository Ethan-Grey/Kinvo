-- =============================================================================
-- Live updates: the app listens for new notifications over Supabase Realtime,
-- so a loan request or payment shows up on the other person's screen straight
-- away, without reopening the app.
--
-- Realtime applies the table's RLS, so each person only ever receives their
-- own notifications ("Users see their own notifications" policy).
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
