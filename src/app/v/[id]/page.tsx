import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseCodeVideoStore } from "@/lib/code-video-store";
import { videoJobs } from "@/lib/job-registry";
import { PlanSchema, VIBES } from "@/lib/plan";
import type { Vibe } from "@/lib/plan";
import { sweepStale } from "@/lib/video-jobs";
import { firstLine } from "@/lib/video-status";
import { CodeVideo } from "@/components/CodeVideo";
import { StatusBadge } from "@/components/StatusBadge";
import { Player } from "@/render/Player";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Blocking on purpose: the row is read before anything streams, so a row the
// user cannot see answers with a real 404 status instead of a 200 shell.
export const instant = false;

export default async function VideoPage({ params }: PageProps<"/v/[id]">) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <Link
        href="/"
        className="text-sm text-zinc-400 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300"
      >
        Back to your videos
      </Link>
      {await VideoView({ params })}
    </main>
  );
}

type Row = {
  id: string;
  prompt: string;
  vibe: string | null;
  format: "16:9" | "9:16";
  status: "generating" | "ready" | "failed";
  error: string | null;
  plan: unknown;
  code: string | null;
  updated_at: string;
};

/** One video, read through the user's session: a row RLS hides is a 404. */
async function VideoView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("videos")
    .select("id, prompt, vibe, format, status, error, plan, code, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const [row] = await sweepStale([data as Row], { store: supabaseCodeVideoStore(supabase), jobs: videoJobs() });

  // Old rows carry a scene plan and keep the scene player.
  if (row.plan !== null) {
    const plan = PlanSchema.safeParse(row.plan);
    const vibe = VIBES.find((v) => v === row.vibe) as Vibe | undefined;
    return (
      <article className="mt-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
          {plan.success ? plan.data.title : firstLine(row.prompt, 60)}
        </h1>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-zinc-400">
          <span className="capitalize">{row.vibe}</span>
          <StatusBadge status={row.status} error={row.error} />
        </div>
        <div className="mt-6">
          {plan.success && vibe ? (
            <Player plan={plan.data} vibe={vibe} />
          ) : (
            <p className="rounded-lg border border-zinc-800/60 bg-zinc-900 p-4 text-sm text-zinc-400 shadow-sm">
              This video has no plan to play. Go back and describe it again.
            </p>
          )}
        </div>
      </article>
    );
  }

  return (
    <CodeVideo
      key={row.id}
      initial={{
        id: row.id,
        title: firstLine(row.prompt, 60),
        format: row.format,
        status: row.status,
        error: row.error,
        code: row.code,
        startedAt: row.updated_at,
      }}
    />
  );
}
