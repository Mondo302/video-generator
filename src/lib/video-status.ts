// How a row's status reads to a person, and when a "generating" row is stale.
// Pure and import-free: used by server pages, client components and node --test alike.

/** A generation not finished after this long, with no live job behind it, is treated as timed out. */
export const STALE_AFTER_MS = 6 * 60_000;

export type StatusLabel = "Writing" | "Ready" | "Failed" | "Timed out" | "Cancelled";

export function statusLabel(status: string, error: string | null): StatusLabel {
  if (status === "generating") return "Writing";
  if (status === "ready") return "Ready";
  if (error === "timeout") return "Timed out";
  if (error === "cancelled") return "Cancelled";
  return "Failed";
}

/**
 * True when the row says "generating" but nothing can still finish it: no job for it in this
 * process and its current generation started more than STALE_AFTER_MS ago (a restart, a crash).
 */
export function isStale(row: { status: string; updated_at: string }, now: number, jobRunning: boolean): boolean {
  if (row.status !== "generating" || jobRunning) return false;
  const started = Date.parse(row.updated_at);
  return Number.isFinite(started) && now - started > STALE_AFTER_MS;
}

/** The first line of the user's description, shortened for lists and titles. */
export function firstLine(text: string, max = 80): string {
  const line = text.trim().split(/\r?\n/, 1)[0].trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
