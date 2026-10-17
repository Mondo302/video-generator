import type { SupabaseClient } from "@supabase/supabase-js";
import { getSessionUserId } from "./supabase/core";
import type { CodeVideoRow, CodeVideoStore } from "./video-jobs";

const COLUMNS = "id, prompt, vibe, format, status, error, code, fix_attempts, input_tokens, output_tokens";

/** The real CodeVideoStore: the videos table through the signed-in user's client, so RLS applies. */
export function supabaseCodeVideoStore(supabase: SupabaseClient): CodeVideoStore {
  async function update(id: string, patch: Record<string, unknown>) {
    const { data, error } = await supabase.from("videos").update(patch).eq("id", id).select("id");
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
    async getOwn(id) {
      const { data, error } = await supabase.from("videos").select(COLUMNS).eq("id", id).maybeSingle();
      if (error) {
        if (error.code === "22P02") return null; // not a uuid: same as not found
        throw new Error(`videos read failed: ${error.code}`);
      }
      return (data as CodeVideoRow | null) ?? null;
    },
    async claimFix(id) {
      // One conditional update: only the first fix request can flip fix_attempts 0 -> 1.
      const { data, error } = await supabase
        .from("videos")
        .update({ fix_attempts: 1, status: "generating", error: null })
        .eq("id", id)
        .eq("fix_attempts", 0)
        .neq("status", "generating")
        .select("id");
      if (error) throw new Error(`videos claimFix failed: ${error.code}`);
      return data?.length === 1;
    },
    markReady: (id, code, usage) => update(id, { status: "ready", code, error: null, ...usage }),
    markFailed: (id, error, usage) => update(id, { status: "failed", error, ...(usage ?? {}) }),
  };
}
