-- Tighten grants on public.videos (written 2026-10-17, NOT applied; Alfred applies it).
--
-- Why: Postgres default privileges left `authenticated` with DELETE, TRUNCATE,
-- REFERENCES and TRIGGER on videos. RLS already blocks DELETE (there is no
-- delete policy) and the Data API cannot TRUNCATE, but the spec says "no delete
-- in v1", so the grants should say it too. The app needs only SELECT, INSERT
-- and UPDATE. `anon` already has no grants (see 20261017000000_create_videos.sql).

revoke delete, truncate, references, trigger on public.videos from authenticated;

-- VERIFY (run after applying). Expected, exactly one row:
--   authenticated | INSERT,SELECT,UPDATE
-- and no row for anon.
--
-- select grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
-- from information_schema.role_table_grants
-- where table_schema = 'public' and table_name = 'videos'
--   and grantee in ('anon', 'authenticated')
-- group by grantee
-- order by grantee;

-- ROLLBACK (only if the app breaks; restores the previous defaults):
--
-- grant delete, truncate, references, trigger on public.videos to authenticated;
