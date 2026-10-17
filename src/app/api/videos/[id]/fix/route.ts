import { after } from "next/server";
import { supabaseCodeVideoStore } from "@/lib/code-video-store";
import { CODE_MODEL, generateCode } from "@/lib/generate-code";
import { videoJobs } from "@/lib/job-registry";
import { createClient } from "@/lib/supabase/server";
import { handleFix } from "@/lib/video-jobs";

export async function POST(request: Request, ctx: RouteContext<"/api/videos/[id]/fix">) {
  const { id } = await ctx.params;
  const store = supabaseCodeVideoStore(await createClient());
  return handleFix(id, request, {
    store,
    generateCode,
    model: CODE_MODEL,
    jobs: videoJobs(),
    schedule: (task) => after(task),
  });
}
