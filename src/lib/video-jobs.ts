// The code engine's API as plain functions: create (202 + background job), poll, cancel, fix.
// Store, generator, job registry and scheduler are injected, so every path is tested without
// network or database. Erasable TypeScript only (node --test runs this file directly).
import { z } from "zod";
import { isStale } from "./video-status.ts";

export const FORMATS = ["16:9", "9:16"] as const;
export type Format = (typeof FORMATS)[number];
export const VIBES = ["calm", "punchy", "retro"] as const;
export type Vibe = (typeof VIBES)[number];

/** A generation still running after this long is failed as a timeout. */
export const CODE_TIME_LIMIT_MS = 5 * 60_000;

export type Usage = { input_tokens: number; output_tokens: number };

export type CodeRequest = {
  prompt: string;
  format: Format;
  vibe: Vibe | null;
  fix?: { previousCode: string; error: string };
};

/** Returns the module source, or code null when the reply is not a valid module. */
export type GenerateCode = (
  request: CodeRequest,
  options: { signal: AbortSignal },
) => Promise<{ code: string | null; usage: Usage }>;

export type CodeVideoRow = {
  id: string;
  prompt: string;
  vibe: Vibe | null;
  format: Format;
  status: "generating" | "ready" | "failed";
  error: string | null;
  code: string | null;
  fix_attempts: number;
  input_tokens: number | null;
  output_tokens: number | null;
  /** When the current generation (or the last change) started; a fix restarts it. */
  updated_at: string;
};

/** The videos table as the signed-in user sees it (RLS applies in the real adapter). */
export type CodeVideoStore = {
  userId(): Promise<string | null>;
  insertGenerating(row: { prompt: string; format: Format; vibe: Vibe | null; model: string }): Promise<string>;
  /** The row if the signed-in user owns it, else null. */
  getOwn(id: string): Promise<CodeVideoRow | null>;
  /** fix_attempts 0 -> 1 and status -> generating, only if no fix was used and it is not running. */
  claimFix(id: string): Promise<boolean>;
  markReady(id: string, code: string, usage: Usage): Promise<void>;
  markFailed(id: string, error: string, usage?: Usage): Promise<void>;
};

export type JobDeps = {
  store: CodeVideoStore;
  generateCode: GenerateCode;
  model: string;
  /** Running jobs by video id, so cancel can reach the upstream call. */
  jobs: Map<string, AbortController>;
  /** Runs the task after the response is sent (next/server `after` in the app). */
  schedule: (task: () => Promise<void>) => void;
  timeoutMs?: number;
  /** Clock for the stale check; tests pass a fixed one. */
  now?: () => number;
};

type ReadDeps = Pick<JobDeps, "store" | "jobs" | "now">;

/**
 * Marks stale "generating" rows failed / timeout (see isStale) and returns them as stored.
 * Called on every read, so a row orphaned by a restart never shows "Writing" forever.
 */
export async function sweepStale<T extends { id: string; status: string; error: string | null; updated_at: string }>(
  rows: T[],
  deps: { store: Pick<CodeVideoStore, "markFailed">; jobs: Map<string, AbortController>; now?: () => number },
): Promise<T[]> {
  const now = (deps.now ?? Date.now)();
  return Promise.all(
    rows.map(async (row) => {
      if (!isStale(row, now, deps.jobs.has(row.id))) return row;
      await deps.store.markFailed(row.id, "timeout");
      return { ...row, status: "failed", error: "timeout" };
    }),
  );
}

async function readOwn(id: string, deps: ReadDeps): Promise<CodeVideoRow | null> {
  const row = await deps.store.getOwn(id);
  if (!row) return null;
  const [swept] = await sweepStale([row], deps);
  return swept;
}

const CreateInput = z.object({
  prompt: z
    .string({ error: "prompt must be text" })
    .trim()
    .min(3, "prompt must be 3 to 1500 characters")
    .max(1500, "prompt must be 3 to 1500 characters"),
  format: z.enum(FORMATS, { error: "format must be 16:9 or 9:16" }),
  vibe: z.enum(VIBES, { error: "vibe must be calm, punchy, retro or null" }).nullable().optional(),
});

const FixInput = z.object({
  error: z
    .string({ error: "error must be text" })
    .trim()
    .min(1, "error must be 1 to 4000 characters")
    .max(4000, "error must be 1 to 4000 characters"),
});

const json = (status: number, body: unknown) => Response.json(body, { status });
const ZERO: Usage = { input_tokens: 0, output_tokens: 0 };

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

function fieldError(error: z.ZodError) {
  const issue = error.issues[0];
  return json(422, { error: issue.message, field: String(issue.path[0] ?? "body") });
}

/** POST /api/videos {prompt, format, vibe?} -> 202 {id}; the model runs after the response. */
export async function handleCreate(request: Request, deps: JobDeps): Promise<Response> {
  if (!(await deps.store.userId())) return json(401, { error: "no session" });
  const parsed = await readJson(request);
  if (!parsed.ok) return json(400, { error: "body must be JSON" });
  const input = CreateInput.safeParse(parsed.body);
  if (!input.success) return fieldError(input.error);

  const { prompt, format } = input.data;
  const vibe = input.data.vibe ?? null;
  const id = await deps.store.insertGenerating({ prompt, format, vibe, model: deps.model });
  startJob(id, { prompt, format, vibe }, ZERO, deps);
  return json(202, { id });
}

/** GET /api/videos/[id] -> {status, error, format, code?} for the owner; 404 otherwise. */
export async function handleGet(id: string, deps: ReadDeps): Promise<Response> {
  if (!(await deps.store.userId())) return json(401, { error: "no session" });
  const row = await readOwn(id, deps);
  if (!row) return json(404, { error: "not found" });
  return json(200, {
    status: row.status,
    error: row.error,
    format: row.format,
    ...(row.code ? { code: row.code } : {}),
  });
}

/** POST /api/videos/[id]/cancel: aborts the upstream call and marks the row failed / cancelled. */
export async function handleCancel(id: string, deps: ReadDeps): Promise<Response> {
  if (!(await deps.store.userId())) return json(401, { error: "no session" });
  const row = await readOwn(id, deps);
  if (!row) return json(404, { error: "not found" });
  if (row.status !== "generating") return json(409, { error: "not generating", status: row.status });
  deps.jobs.get(id)?.abort();
  await deps.store.markFailed(id, "cancelled");
  return json(200, { id, status: "failed", error: "cancelled" });
}

/** POST /api/videos/[id]/fix {error}: one retry with the failed module and the sandbox error. */
export async function handleFix(id: string, request: Request, deps: JobDeps): Promise<Response> {
  if (!(await deps.store.userId())) return json(401, { error: "no session" });
  const parsed = await readJson(request);
  if (!parsed.ok) return json(400, { error: "body must be JSON" });
  const input = FixInput.safeParse(parsed.body);
  if (!input.success) return fieldError(input.error);

  const row = await readOwn(id, deps);
  if (!row) return json(404, { error: "not found" });
  if (!row.code) return json(409, { error: "no code to fix" });
  if (row.status === "generating") return json(409, { error: "still generating" });
  if (row.fix_attempts >= 1 || !(await deps.store.claimFix(id))) {
    return json(409, { error: "the one fix attempt is used" });
  }

  const request_: CodeRequest = {
    prompt: row.prompt,
    format: row.format,
    vibe: row.vibe,
    fix: { previousCode: row.code, error: input.data.error },
  };
  const spent = { input_tokens: row.input_tokens ?? 0, output_tokens: row.output_tokens ?? 0 };
  startJob(id, request_, spent, deps);
  return json(202, { id });
}

function startJob(id: string, request: CodeRequest, spent: Usage, deps: JobDeps) {
  const controller = new AbortController();
  deps.jobs.set(id, controller);
  deps.schedule(() => runJob(id, request, spent, controller, deps));
}

/** The background half: model call with cancel + deadline, then ready or failed. Never throws. */
async function runJob(id: string, request: CodeRequest, spent: Usage, controller: AbortController, deps: JobDeps) {
  const { store } = deps;
  const deadline = AbortSignal.timeout(deps.timeoutMs ?? CODE_TIME_LIMIT_MS);
  const signal = AbortSignal.any([controller.signal, deadline]);
  try {
    if (controller.signal.aborted) return; // cancelled before it started: no model call
    let result: { code: string | null; usage: Usage };
    try {
      result = await untilAborted(deps.generateCode(request, { signal }), signal);
    } catch (err) {
      if (controller.signal.aborted) return; // cancel already marked the row
      if (deadline.aborted) return void (await store.markFailed(id, "timeout"));
      // Upstream messages can echo request details; store only a code.
      const status = (err as { status?: unknown }).status;
      return void (await store.markFailed(id, typeof status === "number" ? `model_error: ${status}` : "model_error"));
    }
    const usage = {
      input_tokens: spent.input_tokens + result.usage.input_tokens,
      output_tokens: spent.output_tokens + result.usage.output_tokens,
    };
    if (!result.code) return void (await store.markFailed(id, "invalid_code", usage));
    await store.markReady(id, result.code, usage);
  } catch {
    try {
      await store.markFailed(id, "internal_error");
    } catch {
      // Nothing more can be done from a background task.
    }
  } finally {
    if (deps.jobs.get(id) === controller) deps.jobs.delete(id);
  }
}

/** Resolves with the work, or rejects as soon as the signal aborts, whichever comes first. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
