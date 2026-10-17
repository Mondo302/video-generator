import type { SupabaseClient } from "@supabase/supabase-js";
import { getSessionUserId } from "./supabase/core";
import type { VideoStore } from "./videos-handler";

/** The real VideoStore: the videos table through the signed-in user's client, so RLS applies. */
export function supabaseVideoStore(supabase: SupabaseClient): VideoStore {
  async function update(id: string, patch: Record<string, unknown>) {
    const { data, error } = await supabase
      .from("videos")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    // RLS turns "not allowed" into zero rows, not an error, so check the count.
    if (error || data?.length !== 1) throw new Error(`videos update failed: ${error?.code ?? "0 rows"}`);
  }

  return {
    userId: () => getSessionUserId(supabase),
    async insertGenerating(row) {
      const { data, error } = await supabase.from("videos").insert(row).select("id").single();
      if (error || !data) throw new Error(`videos insert failed: ${error?.code ?? "no row"}`);
      return data.id as string;
    },
    markReady: (id, plan, usage) => update(id, { status: "ready", plan, error: null, ...usage }),
    markFailed: (id, error, usage) => update(id, { status: "failed", error, ...(usage ?? {}) }),
  };
}
