-- =============================================================================
-- Live updates: new notifications are published to Supabase Realtime.
-- Run with:  npx supabase test db
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(1);

select ok(
  not exists (select 1 from pg_publication where pubname = 'supabase_realtime')
  or exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ),
  'notifications are sent to the app as they happen'
);

select * from finish();
rollback;
