// Framework-free Supabase helpers. The proxy, the server client and the tests
// all go through this module, so the session logic lives in one place.
// Kept to erasable TypeScript so `node --test` can run it with type stripping.
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CookieToSet = { name: string; value: string; options: CookieOptions };

/** Where a server client reads and writes its auth cookies. */
export type CookieJar = {
  getAll(): { name: string; value: string }[];
  setAll(cookies: CookieToSet[], headers: Record<string, string>): void;
};

export type SupabaseEnv = { url: string; publishableKey: string };

/** Publishable key only. A service-role key never belongs in this app. */
export function readSupabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }
  return { url, publishableKey };
}

export function createServerSupabase(
  jar: CookieJar,
  env: SupabaseEnv = readSupabaseEnv(),
): SupabaseClient {
  return createServerClient(env.url, env.publishableKey, {
    cookies: { getAll: () => jar.getAll(), setAll: (c, h) => jar.setAll(c, h) },
  });
}

/** The signed-in user's id from a verified JWT, or null when there is no session. */
export async function getSessionUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

/**
 * Reuses the session in the cookies if there is one; otherwise signs the
 * visitor in anonymously, which writes the new session through the jar.
 */
export async function ensureAnonymousSession(
  supabase: SupabaseClient,
): Promise<{ userId: string; created: boolean }> {
  const existing = await getSessionUserId(supabase);
  if (existing) return { userId: existing, created: false };
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(`Anonymous sign-in failed: ${error?.message ?? "no user returned"}`);
  }
  return { userId: data.user.id, created: true };
}
