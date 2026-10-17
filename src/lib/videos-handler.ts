// POST /api/videos as a plain function: Request in, Response out, with the
// store and the generator injected so it can be tested without a network.
// Erasable TypeScript only (node --test runs this file with type stripping).
import { z } from "zod";
import { PlanSchema, VIBES } from "./plan.ts";
import type { Plan, Vibe } from "./plan.ts";

export type Usage = { input_tokens: number; output_tokens: number };

export type GeneratePlan = (
  input: { prompt: string; vibe: Vibe },
  options: { signal: AbortSignal },
) => Promise<{ plan: unknown; usage: Usage }>;

/** The videos table, as the signed-in user sees it (RLS applies in the real adapter). */
export type VideoStore = {
  userId(): Promise<string | null>;
  insertGenerating(row: { prompt: string; vibe: Vibe; model: string }): Promise<string>;
  markReady(id: string, plan: Plan, usage: Usage): Promise<void>;
  markFailed(id: string, error: string, usage?: Usage): Promise<void>;
};

export type CreateVideoDeps = { store: VideoStore; generatePlan: GeneratePlan; model: string };

const VideoInput = z.object({
  prompt: z
    .string({ error: "prompt must be text" })
    .trim()
    .min(3, "prompt must be 3 to 500 characters")
    .max(500, "prompt must be 3 to 500 characters"),
  vibe: z.enum(VIBES, { error: "vibe must be calm, punchy or retro" }),
});

const json = (status: number, body: unknown) => Response.json(body, { status });

export async function handleCreateVideo(request: Request, deps: CreateVideoDeps): Promise<Response> {
  const { store } = deps;
  let rowId: string | null = null;
  try {
    const userId = await store.userId();
    if (!userId) return json(401, { error: "no session" });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "body must be JSON" });
    }

    const input = VideoInput.safeParse(body);
    if (!input.success) {
      const issue = input.error.issues[0];
      return json(422, { error: issue.message, field: String(issue.path[0] ?? "body") });
    }
    const { prompt, vibe } = input.data;

    rowId = await store.insertGenerating({ prompt, vibe, model: deps.model });

    let generated: { plan: unknown; usage: Usage };
    try {
      generated = await deps.generatePlan({ prompt, vibe }, { signal: request.signal });
    } catch (err) {
      if (request.signal.aborted) {
        await store.markFailed(rowId, "cancelled");
        return new Response(null, { status: 499 });
      }
      // Upstream messages can echo request details; store and return only a code.
      const status = (err as { status?: unknown }).status;
      await store.markFailed(rowId, typeof status === "number" ? `model_error: ${status}` : "model_error");
      return json(502, { error: "the model call failed", id: rowId });
    }

    const plan = PlanSchema.safeParse(generated.plan);
    if (!plan.success) {
      const issue = plan.error.issues[0];
      await store.markFailed(rowId, `invalid_plan: ${issue.path.join(".") || "plan"} ${issue.code}`, generated.usage);
      return json(502, { error: "the model returned an invalid plan", id: rowId });
    }

    await store.markReady(rowId, plan.data, generated.usage);
    return json(201, { id: rowId, status: "ready", plan: plan.data, usage: generated.usage });
  } catch {
    if (rowId) {
      try {
        await store.markFailed(rowId, "internal_error");
      } catch {
        // The row stays 'generating'; nothing more can be done in this request.
      }
    }
    return json(500, { error: "something went wrong" });
  }
}
