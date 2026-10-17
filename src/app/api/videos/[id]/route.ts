import { supabaseCodeVideoStore } from "@/lib/code-video-store";
import { createClient } from "@/lib/supabase/server";
import { handleGet } from "@/lib/video-jobs";

// Polling: {status, error, format, code?} for the owner's row (RLS), 404 otherwise.
export async function GET(_request: Request, ctx: RouteContext<"/api/videos/[id]">) {
  const { id } = await ctx.params;
  return handleGet(id, { store: supabaseCodeVideoStore(await createClient()) });
}
