// Pure helpers for the code engine: what goes to the model, and what counts as a module.
// Erasable TypeScript only, no imports: node --test runs this file directly.

const FENCE = /```(?:js|javascript)?[^\n]*\n([\s\S]*?)```/;
const HAS_META = /export\s+(?:const|let|var)\s+meta\b/;
const HAS_RENDER_FRAME = /export\s+(?:(?:async\s+)?function\s+renderFrame\b|(?:const|let|var)\s+renderFrame\b)/;

/**
 * The module source from the model's reply: the first ```js block if there is one, else the
 * whole reply. Null when it does not export both `meta` and `renderFrame`.
 */
export function extractModule(reply: string): string | null {
  const match = reply.match(FENCE);
  const code = (match ? match[1] : reply).trim();
  if (!HAS_META.test(code) || !HAS_RENDER_FRAME.test(code)) return null;
  return code + "\n";
}

export type ModuleFix = { previousCode: string; error: string };

/** The user input for the model: the request, plus the failed module and host error for a fix. */
export function buildVideoInput(prompt: string, fix?: ModuleFix): string {
  // Text from the user, the model or the sandbox is data: it cannot close our tags.
  const clean = (text: string, tag: string) => text.replaceAll(`</${tag}>`, "");
  let input = `<request>${clean(prompt, "request")}</request>`;
  if (fix) {
    input +=
      "\n\nYour previous module failed the host's checks. Fix it and reply with the full corrected module only." +
      `\n<previous_module>\n${clean(fix.previousCode, "previous_module")}\n</previous_module>` +
      `\n<host_error>\n${clean(fix.error, "host_error")}\n</host_error>`;
  }
  return input;
}
