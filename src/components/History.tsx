import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { supabaseCodeVideoStore } from "@/lib/code-video-store";
import { videoJobs } from "@/lib/job-registry";
import { sweepStale } from "@/lib/video-jobs";
import { firstLine } from "@/lib/video-status";
import { StatusBadge } from "@/components/StatusBadge";

type HistoryRow = {
  id: string;
  prompt: string;
  format: string;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/** The signed-in user's videos, newest first. RLS limits the rows to their own. */
export async function History() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("videos")
    .select("id, prompt, format, status, error, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return <p className="mt-4 text-sm text-red-300">Your videos could not be loaded. Reload the page to try again.</p>;
  }
  if (!data?.length) {
    return <p className="mt-4 text-sm text-zinc-400">No videos yet. The first one you describe shows up here.</p>;
  }
  const rows = await sweepStale(data as HistoryRow[], {
    store: supabaseCodeVideoStore(supabase),
    jobs: videoJobs(),
  });

  return (
    <ul className="mt-4 space-y-2">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/v/${row.id}`}
            className="block rounded-lg border border-zinc-800/60 bg-zinc-900 p-4 shadow-sm transition-colors hover:border-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300"
          >
            <p className="truncate text-sm font-medium text-zinc-100">{firstLine(row.prompt)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-400">
              <span>{row.format}</span>
              <StatusBadge status={row.status} error={row.error} />
              <time dateTime={row.created_at}>{when.format(new Date(row.created_at))}</time>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function HistorySkeleton() {
  return (
    <ul className="mt-4 space-y-2" aria-hidden="true">
      {[0, 1].map((i) => (
        <li key={i} className="h-[76px] animate-pulse rounded-lg border border-zinc-800/60 bg-zinc-900" />
      ))}
    </ul>
  );
}
