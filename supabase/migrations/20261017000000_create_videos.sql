-- Applied to Supabase project qtfztrasuxkcagursajb on 2026-10-17 (migration "create_videos").
create table public.videos (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  prompt        text not null check (char_length(prompt) between 3 and 500),
  vibe          text not null check (vibe in ('calm','punchy','retro')),
  status        text not null default 'generating' check (status in ('generating','ready','failed')),
  plan          jsonb,
  error         text,
  model         text not null,
  input_tokens  int check (input_tokens >= 0),
  output_tokens int check (output_tokens >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ready_has_plan check (status <> 'ready' or plan is not null)
);
create index videos_owner_created_idx on public.videos (owner_id, created_at desc);

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger videos_set_updated_at before update on public.videos
  for each row execute function public.set_updated_at();

alter table public.videos enable row level security;
revoke all on public.videos from anon;
create policy "own rows: read"   on public.videos for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: insert" on public.videos for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own rows: update" on public.videos for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
