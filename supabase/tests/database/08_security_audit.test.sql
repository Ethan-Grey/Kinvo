-- =============================================================================
-- Security audit: rules every table and function must follow (docs/security.md).
--
-- These tests check the whole schema rather than one feature, so a future
-- migration that forgets RLS, grants a write, or leaves out search_path fails
-- CI even if its own tests pass.
-- Run with:  npx supabase test db
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- 1. Row Level Security is on for every table in public.
select is(
  (select coalesce(string_agg(relname, ', ' order by relname), '')
   from pg_class
   where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity),
  '', 'every public table has Row Level Security enabled'
);

-- 2. Signed-in users can only read tables; every change goes through a function (ADR-0003).
select is(
  (select coalesce(string_agg(distinct table_name || ':' || privilege_type, ', '), '')
   from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'),
  '', 'nobody can insert, update or delete table rows directly'
);

-- 3. Signed-out visitors can't read any table.
select is(
  (select coalesce(string_agg(distinct table_name, ', '), '')
   from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'),
  '', 'signed-out visitors have no access to any table'
);

-- 4. ...or call any of Kinvo's functions.
select is(
  (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname), '')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')),
  '', 'signed-out visitors cannot call any function'
);

-- 5. SECURITY DEFINER functions pin search_path, so a user can't hijack them
--    by creating look-alike tables or functions in another schema.
select is(
  (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname), '')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  '', 'every SECURITY DEFINER function sets search_path'
);

-- 6. Internal helpers stay internal, apart from the few that RLS policies or
--    invoker functions need.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
   from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname not in ('shares_relationship_with', 'is_party_to', 'is_loan_party', 'is_terms_party', 'require_user')),
  '', 'signed-in users can only call the private helpers RLS needs'
);

-- 7. The email outbox is for the server only.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('claim_notification_emails', 'finish_notification_email')
     and has_function_privilege('authenticated', p.oid, 'execute')),
  '', 'signed-in users cannot touch the email outbox'
);

-- 8. The audit log is append-only: no policy lets anyone change or remove history.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'audit_events' and cmd in ('UPDATE', 'DELETE', 'ALL')),
  0, 'the audit log has no update or delete policies'
);

select * from finish();
rollback;
