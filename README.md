# Video generator

Personal training app, localhost only. Topic + vibe, then a scene plan from OpenAI, saved in Supabase,
played on a canvas, exported as WebM. Read `ARCHITECTURE.md` before changing anything.

Spec: Obsidian vault `output/weekend-builds/01-video-generator/spec.md`.

## Run

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the three values:
   `OPENAI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   Never commit `.env.local` (it is git-ignored).
3. `npm run dev` starts the app on http://127.0.0.1:3417 (bound to this machine only).

## Check

- `npm run typecheck` generates the Next route types, then runs `tsc --noEmit`.
- `npm test` runs every `tests/*.test.ts` with Node's built-in runner. No network, no database.
- `LIVE_DB_TEST=1 npm test` also runs the live Supabase check. It **writes to the real database**: it
  signs in two new anonymous users and inserts one `videos` row (prompt "skeleton test", vibe calm), then
  shows the second user cannot see it. Nothing is deleted afterwards. Run it only when you mean to.
- `npm run build` must pass before any commit.
