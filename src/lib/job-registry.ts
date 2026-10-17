import "server-only";

// Running generations by video id, so a cancel request can abort the upstream call.
// Kept on globalThis because Next can load a module once per route bundle; one map must
// serve POST /api/videos and POST /api/videos/[id]/cancel alike. Localhost, one process:
// a restart forgets running jobs (their rows then fail on timeout or are cancelled by row).
const holder = globalThis as typeof globalThis & { __videoJobs?: Map<string, AbortController> };

export function videoJobs(): Map<string, AbortController> {
  holder.__videoJobs ??= new Map();
  return holder.__videoJobs;
}
