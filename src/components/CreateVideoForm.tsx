"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Vibe } from "@/lib/plan";

// Kept local (not imported from plan.ts) so zod stays out of the client bundle.
const VIBE_OPTIONS: { value: Vibe; label: string; line: string }[] = [
  { value: "calm", label: "Calm", line: "Soft colours, eased motion, a slow pad." },
  { value: "punchy", label: "Punchy", line: "Bold type, hard cuts, a fast beat." },
  { value: "retro", label: "Retro", line: "Pixel font, four colours, chiptune." },
];

const MIN = 3;
const MAX = 500;

type Phase = "idle" | "generating" | "cancelled" | "error";
type FieldErrors = { prompt?: string; vibe?: string };

export function CreateVideoForm() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [vibe, setVibe] = useState<Vibe>("calm");
  const [phase, setPhase] = useState<Phase>("idle");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const length = prompt.trim().length;
  const lengthOk = length >= MIN && length <= MAX;
  const generating = phase === "generating";

  async function generate() {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("generating");
    setFieldErrors({});
    setError(null);
    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, vibe }),
        signal: controller.signal,
      });
      if (res.status === 201) {
        const { id } = (await res.json()) as { id: string };
        router.push(`/v/${id}`);
        return;
      }
      if (res.status === 422) {
        const { error: message, field } = (await res.json()) as { error: string; field: string };
        setFieldErrors(field === "vibe" ? { vibe: message } : { prompt: message });
        setPhase("idle");
        return;
      }
      setError(
        res.status === 401
          ? "Your session has expired. Reload the page, then try again."
          : res.status === 502
            ? "The model did not return a usable video plan. Try again."
            : "Something went wrong on the server. Try again.",
      );
      setPhase("error");
    } catch {
      if (controller.signal.aborted) {
        setPhase("cancelled");
        router.refresh();
        return;
      }
      setError("The server could not be reached. Check that it is running, then try again.");
      setPhase("error");
    }
  }

  return (
    <form
      className="rounded-lg border border-zinc-800/60 bg-zinc-900 p-4 shadow-sm sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!generating && lengthOk) void generate();
      }}
    >
      <label htmlFor="topic" className="block text-sm font-medium text-zinc-200">
        Topic
      </label>
      <textarea
        id="topic"
        name="prompt"
        rows={3}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        disabled={generating}
        aria-invalid={Boolean(fieldErrors.prompt)}
        aria-describedby="topic-count topic-error"
        placeholder="Why small service businesses lose clients after the first call"
        className="mt-2 block w-full resize-y rounded-md border border-zinc-800/60 bg-zinc-950 px-4 py-2 text-base text-zinc-100 placeholder:text-zinc-600 focus-visible:border-zinc-500 focus-visible:outline-none disabled:opacity-60"
      />
      <div className="mt-2 flex justify-between gap-4 text-xs">
        <p id="topic-error" className="text-red-300" role="alert">
          {fieldErrors.prompt ?? ""}
        </p>
        <p id="topic-count" className={length > MAX ? "text-red-300" : "text-zinc-500"}>
          {length}/{MAX}
        </p>
      </div>

      <fieldset className="mt-4" disabled={generating}>
        <legend className="text-sm font-medium text-zinc-200">Vibe</legend>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {VIBE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`cursor-pointer rounded-md border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-zinc-300 ${
                vibe === option.value
                  ? "border-zinc-400 bg-zinc-800/60"
                  : "border-zinc-800/60 bg-zinc-950 hover:border-zinc-700"
              }`}
            >
              <input
                type="radio"
                name="vibe"
                value={option.value}
                checked={vibe === option.value}
                onChange={() => setVibe(option.value)}
                className="sr-only"
              />
              <span className="block text-sm font-medium text-zinc-100">{option.label}</span>
              <span className="mt-1 block text-xs text-zinc-400">{option.line}</span>
            </label>
          ))}
        </div>
        {fieldErrors.vibe ? (
          <p className="mt-2 text-xs text-red-300" role="alert">
            {fieldErrors.vibe}
          </p>
        ) : null}
      </fieldset>

      {generating ? (
        <div className="mt-6" aria-live="polite">
          <div className="space-y-2" aria-hidden="true">
            <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-800" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-800" />
            <div className="h-4 w-3/5 animate-pulse rounded bg-zinc-800" />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-zinc-300">Writing the scenes… usually ~15 s</p>
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={!lengthOk}
            className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {phase === "error" ? "Try again" : "Generate"}
          </button>
          <p className="text-sm" aria-live="polite">
            {phase === "error" ? <span className="text-red-300">{error}</span> : null}
            {phase === "cancelled" ? <span className="text-zinc-400">Cancelled. Nothing was saved as ready.</span> : null}
          </p>
        </div>
      )}
    </form>
  );
}
