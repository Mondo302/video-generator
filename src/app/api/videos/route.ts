import { after } from "next/server";
import { supabaseCodeVideoStore } from "@/lib/code-video-store";
import { CODE_MODEL, generateCode } from "@/lib/generate-code";
import { videoJobs } from "@/lib/job-registry";
import { createClient } from "@/lib/supabase/server";
import { handleCreate } from "@/lib/video-jobs";

// Code engine: 202 {id} at once, the model call runs after the response (next/server after()).
// The old plan path (src/lib/videos-handler.ts) is no longer routed; old plan rows still play.
export async function POST(request: Request) {
  const store = supabaseCodeVideoStore(await createClient());
  return handleCreate(request, {
    store,
    generateCode,
    model: CODE_MODEL,
    jobs: videoJobs(),
    schedule: (task) => after(task),
  });
}
