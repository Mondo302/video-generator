const styles: Record<string, string> = {
  ready: "text-emerald-300",
  generating: "text-amber-300",
  failed: "text-red-300",
};

/** Row status in words; a failed row says why when the reason is known. */
export function StatusBadge({ status, error }: { status: string; error: string | null }) {
  const label =
    status === "failed" && error === "cancelled" ? "Cancelled" : status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={styles[status] ?? "text-zinc-400"}>{label}</span>;
}
