"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Format = "16:9" | "9:16";
type Vibe = "calm" | "punchy" | "retro";

const FORMAT_OPTIONS: { value: Format; label: string }[] = [
  { value: "16:9", label: "16:9 landscape" },
  { value: "9:16", label: "9:16 vertical" },
];

const VIBE_OPTIONS: { value: Vibe; label: string; line: string }[] = [
  { value: "calm", label: "Calm", line: "Soft colours, eased motion, a slow pad." },
  { value: "punchy", label: "Punchy", line: "Bold type, hard cuts, a fast beat." },
  { value: "retro", label: "Retro", line: "Pixel art, four colours, chiptune." },
];

const MIN = 3;
const MAX = 1500;
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300";

type FieldErrors = { prompt?: string; format?: string; vibe?: string };

export function CreateVideoForm() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [format, setFormat] = useState<Format>("16:9");
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const [sending, setSending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);

  const length = prompt.trim().length;
  const lengthOk = length >= MIN && length <= MAX;

  async function submit() {
    setSending(true);
    setFieldErrors({});
    setError(null);
    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, format, vibe }),
      });
      if (res.status === 202) {
        const { id } = (await res.json()) as { id: string };
        router.push(`/v/${id}`);
        return;
      }
      if (res.status === 422) {
        const { error: message, field } = (await res.json()) as { error: string; field: string };
        setFieldErrors(field === "format" || field === "vibe" ? { [field]: message } : { prompt: message });
      } else {
        setError(
          res.status === 401
            ? "Your session has expired. Reload the page, then try again."
            : "Something went wrong on the server. Try again.",
        );
      }
    } catch {
      setError("The server could not be reached. Check that it is running, then try again.");
    }
    setSending(false);
  }

  return (
    <form
      className="rounded-lg border border-zinc-800/60 bg-zinc-900 p-4 shadow-sm sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!sending && lengthOk) void submit();
      }}
    >
      <label htmlFor="describe" className="block text-sm font-medium text-zinc-200">
        Describe your video
      </label>
      <textarea
        id="describe"
        name="prompt"
        rows={5}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        disabled={sending}
        aria-invalid={Boolean(fieldErrors.prompt)}
        aria-describedby="describe-count describe-error"
        placeholder="A 30 s intro about my bakery, warm and playful, pixel art"
        className="mt-2 block w-full resize-y rounded-md border border-zinc-800/60 bg-zinc-950 px-4 py-2 text-base text-zinc-100 placeholder:text-zinc-600 focus-visible:border-zinc-500 focus-visible:outline-none disabled:opacity-60"
      />
      <div className="mt-2 flex justify-between gap-4 text-xs">
        <p id="describe-error" className="text-red-300" role="alert">
          {fieldErrors.prompt ?? ""}
        </p>
        <p id="describe-count" className={length > MAX ? "text-red-300" : "text-zinc-500"}>
          {length}/{MAX}
        </p>
      </div>

      <fieldset className="mt-4" disabled={sending}>
        <legend className="text-sm font-medium text-zinc-200">Shape</legend>
        <div className="mt-2 inline-flex rounded-md border border-zinc-800/60 bg-zinc-950 p-1" role="radiogroup">
          {FORMAT_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`cursor-pointer rounded px-4 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-zinc-300 ${
                format === option.value ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <input
                type="radio"
                name="format"
                value={option.value}
                checked={format === option.value}
                onChange={() => setFormat(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
        {fieldErrors.format ? <p className="mt-2 text-xs text-red-300" role="alert">{fieldErrors.format}</p> : null}
      </fieldset>

      <fieldset className="mt-4" disabled={sending}>
        <legend className="text-sm font-medium text-zinc-200">Optional style</legend>
        <p className="mt-1 text-xs text-zinc-500">Pick one as a shortcut, or describe the style in your own words.</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {VIBE_OPTIONS.map((option) => {
            const selected = vibe === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setVibe(selected ? null : option.value)}
                className={`rounded-md border p-4 text-left transition-colors ${FOCUS} ${
                  selected ? "border-zinc-400 bg-zinc-800/60" : "border-zinc-800/60 bg-zinc-950 hover:border-zinc-700"
                }`}
              >
                <span className="block text-sm font-medium text-zinc-100">{option.label}</span>
                <span className="mt-1 block text-xs text-zinc-400">{option.line}</span>
              </button>
            );
          })}
        </div>
        {fieldErrors.vibe ? <p className="mt-2 text-xs text-red-300" role="alert">{fieldErrors.vibe}</p> : null}
      </fieldset>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={!lengthOk || sending}
          className={`rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`}
        >
          {sending ? "Starting…" : "Make the video"}
        </button>
        <p className="text-sm text-zinc-500">It takes 2 to 3 minutes.</p>
        {error ? (
          <p className="w-full text-sm text-red-300" aria-live="polite">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
