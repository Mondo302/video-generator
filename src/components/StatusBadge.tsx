import { statusLabel, type StatusLabel } from "@/lib/video-status";

const styles: Record<StatusLabel, string> = {
  Writing: "text-amber-300",
  Ready: "text-emerald-300",
  Failed: "text-red-300",
  "Timed out": "text-red-300",
  Cancelled: "text-zinc-400",
};

/** Row status in words: Writing, Ready, Failed, Timed out or Cancelled. */
export function StatusBadge({ status, error }: { status: string; error: string | null }) {
  const label = statusLabel(status, error);
  return <span className={styles[label]}>{label}</span>;
}
