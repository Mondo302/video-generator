-- Code engine columns on public.videos (written 2026-10-17, NOT applied; Alfred applies it after reading).
--
-- Why: the model now writes the video as a JavaScript module (meta + renderFrame + renderAudio)
-- instead of a scene plan. Old rows keep their plan and vibe; new rows carry code and a format,
-- and the vibe becomes an optional style shortcut. One automatic fix attempt per video.
-- Constraint names below were read from the live project (pg_constraint) on 2026-10-17.

begin;

alter table public.videos add column code text;

alter table public.videos
  add column format text not null default '16:9'
  constraint videos_format_check check (format in ('16:9', '9:16'));

alter table public.videos
  add column fix_attempts int not null default 0
  constraint videos_fix_attempts_check check (fix_attempts between 0 and 1);

-- vibe: optional from now on; the existing check still limits non-null values to calm/punchy/retro.
alter table public.videos alter column vibe drop not null;

-- prompt: 3-500 becomes 3-1500 (the user now describes the whole video).
alter table public.videos drop constraint videos_prompt_check;
alter table public.videos
  add constraint videos_prompt_check check (char_length(prompt) between 3 and 1500);

-- ready needs something to play: a plan (old rows) or code (new rows).
alter table public.videos drop constraint ready_has_plan;
alter table public.videos
  add constraint ready_has_plan check (status <> 'ready' or plan is not null or code is not null);

commit;

-- VERIFY (run after applying).
-- 1) Columns. Expected: code | YES | null ; fix_attempts | NO | 0 ; format | NO | '16:9'::text ; vibe | YES | null
--
-- select column_name, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'videos'
--   and column_name in ('code', 'format', 'fix_attempts', 'vibe')
-- order by column_name;
--
-- 2) Constraints. Expected among the rows:
--   ready_has_plan             | CHECK (status <> 'ready' OR plan IS NOT NULL OR code IS NOT NULL)
--   videos_fix_attempts_check  | CHECK (fix_attempts >= 0 AND fix_attempts <= 1)
--   videos_format_check        | CHECK (format = ANY (ARRAY['16:9', '9:16']))
--   videos_prompt_check        | CHECK (char_length(prompt) >= 3 AND char_length(prompt) <= 1500)
--
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.videos'::regclass
-- order by conname;
--
-- 3) Old rows untouched. Expected: the same count of ready rows with a plan as before applying.
--
-- select count(*) from public.videos where status = 'ready' and plan is not null;

-- ROLLBACK (only if needed). It fails while rows exist that the old rules forbid: rows with a null
-- vibe, a prompt over 500 characters, or ready with code but no plan. Decide what to do with those
-- rows first (Mohannad's call); this block deliberately does not delete or rewrite any.
--
-- begin;
-- alter table public.videos drop constraint ready_has_plan;
-- alter table public.videos add constraint ready_has_plan check (status <> 'ready' or plan is not null);
-- alter table public.videos drop constraint videos_prompt_check;
-- alter table public.videos add constraint videos_prompt_check check (char_length(prompt) between 3 and 500);
-- alter table public.videos alter column vibe set not null;
-- alter table public.videos drop column fix_attempts;
-- alter table public.videos drop column format;
-- alter table public.videos drop column code;
-- commit;
