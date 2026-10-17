import { supabaseCodeVideoStore } from "@/lib/code-video-store";
import { videoJobs } from "@/lib/job-registry";
import { createClient } from "@/lib/supabase/server";
import { handleCancel } from "@/lib/video-jobs";

export async function POST(_request: Request, ctx: RouteContext<"/api/videos/[id]/cancel">) {
  const { id } = await ctx.params;
  return handleCancel(id, { store: supabaseCodeVideoStore(await createClient()), jobs: videoJobs() });
}
