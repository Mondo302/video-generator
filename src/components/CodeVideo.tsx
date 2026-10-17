"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Player } from "@/render/Player";
import { StatusBadge } from "@/components/StatusBadge";

type Format = "16:9" | "9:16";

export type CodeVideoState = {
  id: string;
  title: string;
  format: Format;
  status: "generating" | "ready" | "failed";
  error: string | null;
  code: string | null;
  /** When the current generation started (ISO); drives the elapsed clock. */
  startedAt: string;
};

const POLL_MS = 3000;
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300";

const FAILED_TEXT: Record<string, string> = {
  cancelled: "You cancelled this video.",
  timeout: "That took too long.",
};

/** A model-written video: waits while it is written, plays it, and asks for the one fix if it breaks. */
export function CodeVideo({ initial }: { initial: CodeVideoState }) {
  const [video, setVideo] = useState(initial);
  const [gaveUp, setGaveUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const fixedFor = useRef<string | null>(null); // the code version a fix was already asked for

  // Poll every 3 s while the video is being written.
  useEffect(() => {
    if (video.status !== "generating") return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/videos/${video.id}`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const next = (await res.json()) as { status: CodeVideoState["status"]; error: string | null; code?: string };
        if (next.status !== "generating") {
          setVideo((v) => ({ ...v, status: next.status, error: next.error, code: next.code ?? v.code }));
        }
      } catch {
        // A missed poll is retried on the next tick.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [video.id, video.status]);

  async function cancel() {
    setBusy(true);
    try {
      const res = await fetch(`/api/videos/${video.id}/cancel`, { method: "POST" });
      if (res.ok || res.status === 409) {
        const check = await fetch(`/api/videos/${video.id}`, { cache: "no-store" });
        if (check.ok) {
          const next = (await check.json()) as { status: CodeVideoState["status"]; error: string | null; code?: string };
          setVideo((v) => ({ ...v, status: next.status, error: next.error, code: next.code ?? v.code }));
        }
      }
    } finally {
      setBusy(false);
    }
  }

  // The player reports a broken module: ask for the one fix, once per code version.
  const onRenderError = useCallback(
    async (message: string) => {
      const code = video.code;
      if (!code || fixedFor.current === code) return;
      fixedFor.current = code;
      try {
        const res = await fetch(`/api/videos/${video.id}/fix`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: message.slice(0, 4000) }),
        });
        if (res.status === 202) {
          setVideo((v) => ({ ...v, status: "generating", error: null, startedAt: new Date().toISOString() }));
        } else {
          setGaveUp(true);
        }
      } catch {
        setGaveUp(true);
      }
    },
    [video.id, video.code],
  );

  return (
    <article className="mt-6">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">{video.title}</h1>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-zinc-400">
        <span>{video.format}</span>
        <StatusBadge status={video.status} error={video.error} />
      </div>

      <div className="mt-6">
        {gaveUp ? (
          <TryAgain text="This one didn't work. Try describing it again." />
        ) : video.status === "generating" ? (
          <Waiting startedAt={video.startedAt} onCancel={cancel} busy={busy} />
        ) : video.status === "ready" && video.code ? (
          <Player code={video.code} format={video.format} title={video.title} onRenderError={onRenderError} />
        ) : (
          <TryAgain
            text={FAILED_TEXT[video.error ?? ""] ?? "This one didn't work. Try describing it again."}
          />
        )}
      </div>
    </article>
  );
}

function Waiting({ startedAt, onCancel, busy }: { startedAt: string; onCancel: () => void; busy: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = now === null ? 0 : Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="rounded-lg border border-zinc-800/60 bg-zinc-900 p-4 shadow-sm sm:p-6" aria-live="polite">
      <div className="space-y-2" aria-hidden="true">
        <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-800" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-800" />
        <div className="h-4 w-3/5 animate-pulse rounded bg-zinc-800" />
      </div>
      <p className="mt-4 text-sm text-zinc-200">Writing your video. This takes 2 to 3 minutes.</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm tabular-nums text-zinc-400">
          <span className="sr-only">Elapsed </span>
          {elapsed}
        </p>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={`rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 ${FOCUS}`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function TryAgain({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-zinc-800/60 bg-zinc-900 p-4 text-sm shadow-sm">
      <p className="text-zinc-300">{text}</p>
      <Link href="/" className={`mt-4 inline-block text-zinc-100 underline underline-offset-4 ${FOCUS}`}>
        Describe a new video
      </Link>
    </div>
  );
}
