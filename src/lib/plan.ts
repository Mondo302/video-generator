// The scene plan: the one definition of what a video is. Used to build the
// OpenAI strict output format AND to validate the model's answer afterwards.
// Erasable TypeScript only (node --test runs this file with type stripping).
import { z } from "zod";

export const VIBES = ["calm", "punchy", "retro"] as const;
export type Vibe = (typeof VIBES)[number];

export const SCENE_TYPES = ["title", "text", "list", "stat"] as const;
export const MAX_TOTAL_SECONDS = 45;

// The model has ended over-long titles on a junk glyph ("...the first™").
// A refine (not a regex) keeps this out of the strict JSON schema sent to OpenAI.
const JUNK_GLYPHS = /[™®©]/;
const text = (max: number) =>
  z.string().max(max).refine((s) => !JUNK_GLYPHS.test(s), { message: "contains ™, ® or ©" });

export const SceneSchema = z.object({
  type: z.enum(SCENE_TYPES),
  duration_s: z.number().min(2).max(8),
  heading: text(60),
  body: text(140).nullable(),
  items: z.array(text(40)).max(4).nullable(),
  value: text(12).nullable(),
});

export const PlanSchema = z
  .object({
    title: text(60),
    scenes: z.array(SceneSchema).min(3).max(8),
  })
  .refine((plan) => totalSeconds(plan) <= MAX_TOTAL_SECONDS, {
    message: `total duration must be at most ${MAX_TOTAL_SECONDS} s`,
    path: ["scenes"],
  });

export type Scene = z.infer<typeof SceneSchema>;
export type Plan = z.infer<typeof PlanSchema>;

export function totalSeconds(plan: { scenes: { duration_s: number }[] }): number {
  return plan.scenes.reduce((sum, scene) => sum + scene.duration_s, 0);
}
