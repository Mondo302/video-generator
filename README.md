# Video generator

Personal training app, localhost only. Prompt + vibe -> scene plan (OpenAI) -> saved in Supabase -> played on a canvas -> WebM download.

Spec: Obsidian vault `output/weekend-builds/01-video-generator/spec.md`.

## Run

1. Copy `.env.example` to `.env.local` and fill in the three values.
2. `npm install`
3. `npx next dev -p 3417`
