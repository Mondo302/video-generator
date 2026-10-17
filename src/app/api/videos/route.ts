import { generatePlan, MODEL } from "@/lib/generate";
import { createClient } from "@/lib/supabase/server";
import { supabaseVideoStore } from "@/lib/video-store";
import { handleCreateVideo } from "@/lib/videos-handler";

export async function POST(request: Request) {
  const store = supabaseVideoStore(await createClient());
  return handleCreateVideo(request, { store, generatePlan, model: MODEL });
}
