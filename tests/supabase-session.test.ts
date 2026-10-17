// Live check against the training Supabase project. It creates anonymous users
// and one videos row, so it only runs when LIVE_DB_TEST=1 is set.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createServerSupabase,
  ensureAnonymousSession,
  readSupabaseEnv,
} from "../src/lib/supabase/core.ts";
import type { CookieJar } from "../src/lib/supabase/core.ts";

const live = process.env.LIVE_DB_TEST === "1";

/** Stands in for one browser's cookie storage. */
function memoryJar(): CookieJar & { names(): string[] } {
  const cookies = new Map<string, string>();
  return {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll(list) {
      for (const { name, value, options } of list) {
        if (value === "" || options?.maxAge === 0) cookies.delete(name);
        else cookies.set(name, value);
      }
    },
    names: () => [...cookies.keys()],
  };
}

describe("anonymous session + videos RLS (live)", { skip: !live && "set LIVE_DB_TEST=1" }, () => {
  if (live) process.loadEnvFile(".env.local");
  const browserA = memoryJar();
  let userA = "";
  let rowId = "";

  it("signs a first-time visitor in anonymously and stores the session in cookies", async () => {
    const session = await ensureAnonymousSession(createServerSupabase(browserA, readSupabaseEnv()));
    assert.equal(session.created, true);
    assert.match(session.userId, /^[0-9a-f-]{36}$/);
    assert.ok(browserA.names().some((n) => n.startsWith("sb-")), "auth cookie written");
    userA = session.userId;
  });

  it("reuses that session on the next request from the same browser", async () => {
    const again = await ensureAnonymousSession(createServerSupabase(browserA));
    assert.deepEqual(again, { userId: userA, created: false });
  });

  it("inserts a videos row as that user and reads it back", async () => {
    const supabase = createServerSupabase(browserA);
    const { data, error } = await supabase
      .from("videos")
      .insert({ prompt: "skeleton test", vibe: "calm", model: "gpt-6-astra" })
      .select("id, owner_id, prompt, vibe, status, model")
      .single();
    assert.equal(error, null);
    assert.equal(data?.owner_id, userA);
    assert.equal(data?.status, "generating");
    assert.equal(data?.prompt, "skeleton test");
    rowId = data!.id;
    console.log(`row id: ${rowId} | user A: ${userA}`);

    // Positive control: the exact lookup user B makes below finds the row for A.
    const own = await supabase.from("videos").select("id").eq("id", rowId);
    assert.equal(own.data?.length, 1);
  });

  it("a second anonymous user cannot see the first user's row", async () => {
    const supabaseB = createServerSupabase(memoryJar());
    const sessionB = await ensureAnonymousSession(supabaseB);
    assert.notEqual(sessionB.userId, userA);
    console.log(`user B: ${sessionB.userId}`);
    const { data, error } = await supabaseB.from("videos").select("id").eq("id", rowId);
    assert.equal(error, null);
    assert.deepEqual(data, []);
  });
});
