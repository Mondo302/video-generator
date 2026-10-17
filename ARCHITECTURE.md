# Video generator: ARCHITECTURE.md

**Read this before touching anything.** It records intent, not every file. Verified 2026-10-17 against
`master` of this repo and the live Supabase project `qtfztrasuxkcagursajb` (read-only queries).

## 1. What is the system?

A personal training app that runs on localhost only. You type a topic and pick a vibe (calm, punchy, retro);
OpenAI (`gpt-6-astra`) writes a **scene plan** as JSON; the plan is saved in Supabase; the browser plays it on a
canvas and can export a WebM. The plan is the video: same plan + same vibe = same video, so plans are stored,
never video files. Stack: Next.js 16 App Router + TypeScript, Tailwind, Supabase (Postgres, RLS, anonymous
sign-in), OpenAI Node SDK (Responses API).

## 2. Who owns what?

- Product owner: Mohannad. This is a training build, not client work.
- Server logic, API, database access: fullstack-engineer.
- `src/render/` (canvas, audio, WebM export): motion-engineer.

## 3. Why is it built this way?

The approved spec is the source of truth: vault `output/weekend-builds/01-video-generator/spec.md`
(`C:\Users\User\OneDrive\Documents\Obsidian Vault\output\weekend-builds\01-video-generator\spec.md`).
- **Anonymous sign-in, no login screen.** Every visitor still gets a real `auth.uid()`, so RLS is real.
- **One zod schema** (`src/lib/plan.ts`) builds the OpenAI strict format and validates the answer, because
  strict mode cannot express every rule (the 45 s total, the ™ ® © ban).
- **The route is a plain function** (`src/lib/videos-handler.ts`) with the store and the generator injected,
  so every status code is tested without network or database.

## 4. Boundaries (what may touch what)

- Localhost only (`127.0.0.1:3417`). Never deployed.
- OpenAI is called only on the server (`src/lib/generate.ts`, `import "server-only"`).
- Supabase is reached only with the publishable key, as the signed-in user. No service-role key, anywhere.
- `videos` has RLS on; each user reads, inserts and updates only their own rows. No delete.
- Rendering and export run only in the browser. The server never makes video files.

## 5. Main flow

1. **Session.** `src/proxy.ts` refreshes the session on every request and signs page visitors in anonymously.
   `/api/*` only refreshes, so a request without a session gets 401.
2. **Create.** The form posts `{prompt, vibe}` to `POST /api/videos`: 400 not JSON, 401 no session, 422 bad
   field (no model call).
3. **Generate.** A `generating` row is inserted, then the model is called with the client's abort signal and a
   60 s deadline. Client abort: row `failed` / `cancelled`. Deadline: `failed` / `timeout`, 504.
4. **Store.** The answer is validated by zod. Invalid: `failed`, 502. Valid: `ready` with plan and tokens, 201.
5. **Play and export.** `/v/[id]` reads the row through RLS (hidden row = 404) and hands
   `{ plan, vibe }` to `src/render/Player.tsx`, which draws it and records the WebM.

## 6. What can never break?

- The OpenAI key is never in the client bundle (`.next/static` has no key and no `OPENAI_API_KEY`).
- A generation never runs longer than 60 s; a row never stays `generating` because the model hung.
- `anon` has no grants on `videos`; RLS stays on.
- A row is `ready` only after zod has validated its plan.
- Tokens are saved on every row that got a model answer.

## 7. Where does new code go?

- Server logic and data access: `src/lib/` (keep files run by `node --test` to erasable TypeScript).
- Pages and routes: `src/app/`. UI components: `src/components/`.
- Canvas, audio, export: `src/render/` (motion-engineer). Its entry keeps the props `{ plan: Plan; vibe: Vibe }`.
- Tests: `tests/*.test.ts`, run with `node --test`.
- Database changes: a new file in `supabase/migrations/`, applied by Mohannad.

## 8. When do you stop and ask?

If a task means breaking §4 or §6, or needs any new dependency, any database change (schema, policy, grant),
any deploy, or a service-role key: **stop, name the conflict, show what it affects, propose the smallest fix
that keeps the rule.**

## Known gaps (true today, not design)

- `authenticated` still holds Postgres's default `DELETE` and `TRUNCATE` grants on `videos`. RLS blocks
  DELETE (no policy) and the Data API cannot TRUNCATE, but revoking both is tighter. The fix is written,
  not yet applied: `supabase/migrations/20261017010000_tighten_videos_grants.sql`.
- The first migration file (`20261017000000_create_videos.sql`) has no rollback or verification block.
- The system prompt has been run once per vibe only; there is no test table with golden answers yet.
- No favicon; the browser logs one 404 for it.
- `src/render/Player.tsx` is a placeholder until motion-engineer's renderer lands.
