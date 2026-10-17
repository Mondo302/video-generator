import { cookies } from "next/headers";
import { createServerSupabase } from "./core";

/**
 * Supabase client for Server Components, Server Functions and Route Handlers,
 * acting as the signed-in (anonymous) user so RLS applies.
 */
export async function createClient() {
  const store = await cookies();
  return createServerSupabase({
    getAll: () => store.getAll(),
    setAll(list) {
      try {
        for (const { name, value, options } of list) store.set(name, value, options);
      } catch {
        // Server Components cannot set cookies. src/proxy.ts refreshes the
        // session on every request, so a skipped write here is safe.
      }
    },
  });
}
