// POST /api/videos behaviour, tested at the handler seam with an in-memory
// store and a fake generator (no network, no database).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleCreateVideo } from "../src/lib/videos-handler.ts";
import type { GeneratePlan, Usage, VideoStore } from "../src/lib/videos-handler.ts";
import { PlanSchema } from "../src/lib/plan.ts";

type Row = {
  id: string;
  prompt: string;
  vibe: string;
  model: string;
  status: "generating" | "ready" | "failed";
  plan: unknown;
  error: string | null;
  usage: Usage | null;
};

function memoryStore(userId: string | null): VideoStore & { rows: Row[] } {
  const rows: Row[] = [];
  const find = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error(`no row ${id}`);
    return row;
  };
  return {
    rows,
    userId: async () => userId,
    async insertGenerating({ prompt, vibe, model }) {
      const id = `row-${rows.length + 1}`;
      rows.push({ id, prompt, vibe, model, status: "generating", plan: null, error: null, usage: null });
      return id;
    },
    async markReady(id, plan, usage) {
      Object.assign(find(id), { status: "ready", plan, usage, error: null });
    },
    async markFailed(id, error, usage) {
      Object.assign(find(id), { status: "failed", error, usage: usage ?? null });
    },
  };
}

const USAGE: Usage = { input_tokens: 120, output_tokens: 340 };

const VALID_PLAN = {
  title: "Why clients leave",
  scenes: [
    { type: "title", duration_s: 4, heading: "Why clients leave", body: null, items: null, value: null },
    { type: "text", duration_s: 5, heading: "The first call", body: "They called once and waited.", items: null, value: null },
    { type: "list", duration_s: 6, heading: "What helps", body: null, items: ["Reply fast", "Follow up"], value: null },
  ],
};

function fakeGenerator(result: { plan: unknown; usage: Usage } | Error) {
  const calls: { input: unknown; signal: AbortSignal }[] = [];
  const generatePlan: GeneratePlan = async (input, { signal }) => {
    calls.push({ input, signal });
    if (result instanceof Error) throw result;
    return result;
  };
  return { generatePlan, calls };
}

function post(body: string, signal?: AbortSignal) {
  return new Request("http://localhost/api/videos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal,
  });
}

const GOOD_BODY = JSON.stringify({ prompt: "Why small service businesses lose clients", vibe: "calm" });
const MODEL = "gpt-6-astra";

describe("POST /api/videos handler", () => {
  it("400 when the body is not JSON, with no row and no model call", async () => {
    const store = memoryStore("user-a");
    const gen = fakeGenerator({ plan: VALID_PLAN, usage: USAGE });
    const res = await handleCreateVideo(post("not json"), { store, generatePlan: gen.generatePlan, model: MODEL });
    assert.equal(res.status, 400);
    assert.equal(gen.calls.length, 0);
    assert.equal(store.rows.length, 0);
  });

  it("401 when there is no session", async () => {
    const store = memoryStore(null);
    const gen = fakeGenerator({ plan: VALID_PLAN, usage: USAGE });
    const res = await handleCreateVideo(post(GOOD_BODY), { store, generatePlan: gen.generatePlan, model: MODEL });
    assert.equal(res.status, 401);
    assert.equal(gen.calls.length, 0);
    assert.equal(store.rows.length, 0);
  });

  for (const [body, field] of [
    [{ prompt: "hi", vibe: "calm" }, "prompt"],
    [{ prompt: "x".repeat(501), vibe: "calm" }, "prompt"],
    [{ prompt: "A fine topic", vibe: "loud" }, "vibe"],
    [{ vibe: "calm" }, "prompt"],
  ] as const) {
    it(`422 on bad ${field} (${JSON.stringify(body).slice(0, 40)}), no model call`, async () => {
      const store = memoryStore("user-a");
      const gen = fakeGenerator({ plan: VALID_PLAN, usage: USAGE });
      const res = await handleCreateVideo(post(JSON.stringify(body)), { store, generatePlan: gen.generatePlan, model: MODEL });
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.field, field);
      assert.equal(typeof json.error, "string");
      assert.equal(gen.calls.length, 0);
      assert.equal(store.rows.length, 0);
    });
  }

  it("201 stores the plan and tokens on a ready row and returns them", async () => {
    const store = memoryStore("user-a");
    const gen = fakeGenerator({ plan: VALID_PLAN, usage: USAGE });
    const res = await handleCreateVideo(post(GOOD_BODY), { store, generatePlan: gen.generatePlan, model: MODEL });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.deepEqual(json, { id: "row-1", status: "ready", plan: VALID_PLAN, usage: USAGE });
    assert.deepEqual(gen.calls[0].input, { prompt: "Why small service businesses lose clients", vibe: "calm" });
    const [row] = store.rows;
    assert.equal(row.status, "ready");
    assert.equal(row.model, "gpt-6-astra");
    assert.deepEqual(row.plan, VALID_PLAN);
    assert.deepEqual(row.usage, USAGE);
  });

  it("502 and a failed row when the plan breaks the schema (total over 45 s)", async () => {
    const tooLong = { ...VALID_PLAN, scenes: Array.from({ length: 7 }, () => ({ ...VALID_PLAN.scenes[1], duration_s: 7 })) };
    const store = memoryStore("user-a");
    const gen = fakeGenerator({ plan: tooLong, usage: USAGE });
    const res = await handleCreateVideo(post(GOOD_BODY), { store, generatePlan: gen.generatePlan, model: MODEL });
    assert.equal(res.status, 502);
    const [row] = store.rows;
    assert.equal(row.status, "failed");
    assert.match(row.error ?? "", /^invalid_plan/);
    assert.deepEqual(row.usage, USAGE, "tokens are kept even when the plan is rejected");
  });

  it("502 when the model call fails, without leaking the upstream message", async () => {
    const store = memoryStore("user-a");
    const gen = fakeGenerator(new Error("Incorrect API key provided: sk-proj-abc123SECRET"));
    const res = await handleCreateVideo(post(GOOD_BODY), { store, generatePlan: gen.generatePlan, model: MODEL });
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.doesNotMatch(text, /sk-|SECRET|Incorrect API key/);
    assert.equal(store.rows[0].status, "failed");
    assert.doesNotMatch(store.rows[0].error ?? "", /sk-|SECRET/);
  });

  it("client abort cancels the model call and marks the row failed / cancelled", async () => {
    const store = memoryStore("user-a");
    const controller = new AbortController();
    let sawAbort = false;
    const generatePlan: GeneratePlan = (_input, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          sawAbort = true;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
        setTimeout(() => controller.abort(), 5);
      });
    const res = await handleCreateVideo(post(GOOD_BODY, controller.signal), { store, generatePlan, model: MODEL });
    assert.equal(sawAbort, true, "the generator received the request's signal");
    assert.notEqual(res.status, 201);
    assert.equal(store.rows[0].status, "failed");
    assert.equal(store.rows[0].error, "cancelled");
  });

  it("504 and a failed / timeout row when the model passes the time limit, even if it ignores the signal", { timeout: 2000 }, async () => {
    const store = memoryStore("user-a");
    let sawAbort = false;
    const generatePlan: GeneratePlan = (_input, { signal }) => {
      signal.addEventListener("abort", () => {
        sawAbort = true;
      });
      return new Promise(() => {}); // never settles: a stuck upstream call
    };
    const res = await handleCreateVideo(post(GOOD_BODY), { store, generatePlan, model: MODEL, timeoutMs: 20 });
    assert.equal(res.status, 504);
    assert.deepEqual(await res.json(), { error: "timeout" });
    assert.equal(sawAbort, true, "the deadline also aborts the upstream call");
    assert.equal(store.rows[0].status, "failed");
    assert.equal(store.rows[0].error, "timeout");
  });
});

describe("plan schema", () => {
  it("accepts a valid plan", () => {
    assert.equal(PlanSchema.safeParse(VALID_PLAN).success, true);
  });
  it("rejects the junk glyphs ™ ® © in any text field", () => {
    const withGlyph = (scene: object) => ({ ...VALID_PLAN, scenes: [scene, ...VALID_PLAN.scenes.slice(1)] });
    const title = VALID_PLAN.scenes[0];
    assert.equal(PlanSchema.safeParse({ ...VALID_PLAN, title: "Why clients leave after the first™" }).success, false);
    assert.equal(PlanSchema.safeParse(withGlyph({ ...title, heading: "Brand®" })).success, false);
    assert.equal(PlanSchema.safeParse(withGlyph({ ...title, body: "Made by us ©" })).success, false);
    assert.equal(PlanSchema.safeParse(withGlyph({ ...title, items: ["One™"] })).success, false);
    assert.equal(PlanSchema.safeParse(withGlyph({ ...title, value: "40%®" })).success, false);
    assert.equal(PlanSchema.safeParse({ ...VALID_PLAN, title: "Fair prices, (c) and TM spelled out" }).success, true);
  });
  it("rejects fewer than 3 scenes, more than 4 list items, and a total over 45 s", () => {
    assert.equal(PlanSchema.safeParse({ ...VALID_PLAN, scenes: VALID_PLAN.scenes.slice(0, 2) }).success, false);
    const fiveItems = { ...VALID_PLAN.scenes[2], items: ["a", "b", "c", "d", "e"] };
    assert.equal(PlanSchema.safeParse({ ...VALID_PLAN, scenes: [...VALID_PLAN.scenes.slice(0, 2), fiveItems] }).success, false);
    const long = { ...VALID_PLAN, scenes: Array.from({ length: 6 }, () => ({ ...VALID_PLAN.scenes[1], duration_s: 8 })) };
    assert.equal(PlanSchema.safeParse(long).success, false);
  });
});
