"use client";

// PLACEHOLDER. motion-engineer replaces this file's internals with the canvas
// renderer and the WebM download. Keep the props exactly { plan, vibe }.
import type { Plan, Vibe } from "@/lib/plan";
import { totalSeconds } from "@/lib/plan";

export type PlayerProps = { plan: Plan; vibe: Vibe };

export function Player({ plan, vibe }: PlayerProps) {
  return (
    <section aria-label={`Scenes, ${vibe} vibe`}>
      <p className="text-sm text-zinc-400">
        {plan.scenes.length} scenes, {totalSeconds(plan)} s in total. The player is not built yet.
      </p>
      <ol className="mt-4 space-y-2">
        {plan.scenes.map((scene, index) => (
          <li key={index} className="rounded-lg border border-zinc-800/60 bg-zinc-900 p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-4 text-xs text-zinc-500">
              <span className="capitalize">{scene.type}</span>
              <span>{scene.duration_s} s</span>
            </div>
            <p className="mt-2 text-base font-medium text-zinc-100">{scene.heading}</p>
            {scene.value ? <p className="mt-2 text-3xl font-semibold text-zinc-100">{scene.value}</p> : null}
            {scene.body ? <p className="mt-2 text-sm text-zinc-300">{scene.body}</p> : null}
            {scene.items ? (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-zinc-300">
                {scene.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
