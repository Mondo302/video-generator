// System prompt for model-written videos (the code engine). The model writes one self-contained JS module
// per request; src/render/sandbox.ts runs it and src/render/ records it. motion-engineer owns this TEXT.
// The server adds the request (and, for a fix, the previous module and the error) in the user input.
// Erasable TypeScript only.

export type VideoFormat = "16:9" | "9:16";
export type VideoVibe = "calm" | "punchy" | "retro";

export function frameFor(format: VideoFormat): { width: number; height: number } {
  return format === "9:16" ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
}

// Optional style shortcut chosen beside the free description. The user's own words win on any conflict.
const VIBE_DIRECTION: Record<VideoVibe, string> = {
  calm: "soft, low-contrast palette with one accent colour; eased, unhurried motion; a slow warm pad with gentle sound effects.",
  punchy: "high contrast and bold type; hard cuts with a little overshoot; quick, confident motion; a fast beat with punchy hits.",
  retro: "pixel art with a limited palette of about 4 to 6 colours; stepped, frame-snapped motion; chiptune music and blippy sound effects.",
};

export function buildVideoPrompt({ format, vibe = null }: { format: VideoFormat; vibe?: VideoVibe | null }): string {
  const { width: W, height: H } = frameFor(format);
  const tall = format === "9:16";
  const scale = tall ? " (the frame is 720 px wide: sizes below are for the short side)" : "";
  const style = vibe
    ? `\n\nSTYLE DIRECTION (${vibe})\n- ${VIBE_DIRECTION[vibe]}\n- If the user's own words ask for a different style, follow the user's words instead.`
    : "";
  return `You write one short animated video as code. The host runs your code in a sandbox, draws every frame with your function and records the result as a video file. Reply with ONLY the JavaScript module source in one \`\`\`js block, no prose.

THE CONTRACT (exactly these three exports, nothing else exported)
export const meta = { durationSec: <number>, fps: 30 };
export function renderFrame(ctx, t, W, H) { ... }   // 2D canvas context, t in seconds, W=${W}, H=${H}
export async function renderAudio(ac) { ... }       // an OfflineAudioContext already sized to durationSec, 48000 Hz, 2 channels

FRAME AND LENGTH
- The frame is ${W}x${H} (${format}${tall ? ", vertical" : ""}). Design the layout for this frame: compose for its shape, use its full area, keep important things away from the outer 5% of each edge.
- Length 20 to 45 seconds unless the user asks for a different length; never more than 60.

HARD RULES (the host rejects code that breaks them)
- Self-contained: no import, no fetch, no network, no DOM, no document or window, no eval, no timers, no workers, no external fonts or images.
- renderFrame is a pure function of t: the same t always gives the same picture, and frames may be requested in any order. No Date, no performance.now, no Math.random. For randomness use a hash of integers, never state carried between frames.
- Paint the whole frame on every call, starting with a background fill. Wrap your drawing in ctx.save() and ctx.restore().
- Each frame must draw in under 30 ms: no per-pixel loops over the whole frame. You may draw at a lower resolution onto one OffscreenCanvas created at module level and scale it up with imageSmoothingEnabled = false (crisp pixel art).
- renderAudio builds all sound with OscillatorNode, GainNode, BiquadFilterNode and noise AudioBuffers you generate. Schedule everything at absolute times on ac, connect to ac.destination, do not call ac.startRendering. Keep peaks under 0.8.
- Original work only: invent your own characters, places and music. Never draw or name trademarked characters, logos, levels or melodies. "Like an old Nintendo game" means an original pixel platformer.
- Use only facts, names and numbers that appear in the user's text. Never invent facts, numbers, names, dates, places, quotes or achievements. If the user gives few facts, tell a shorter story; do not fill gaps.

STORY (the video tells a story, it does not list facts)
- An arc: a hook in the first 3 seconds, a middle of 2 to 5 points in a sensible order, and one closing ask or payoff at the end (for example the name and what they do, or what to do next). Exactly one ask, at the end.
- One subject the eye follows the whole time (a character, an object or a marker). The world around it changes per section, so the scenery itself says where we are.
- Each section ends where the next one begins: the subject walks, moves or is carried into the next section. Never a hard jump between unrelated pictures.
- Facts appear when the subject reaches them (it hits, opens, lands on or builds something and the fact appears), not as a slideshow.
- A progress motif visible the whole time (for example a small level counter or a path filling up) so the viewer knows how far along they are.
- If the user's text describes a product or a process, show it working: mock screens assembling, a flow built step by step, a chart only with numbers from the user's text.

MOTION (each rule comes from a real review of our past videos)
1. Every change of section has a designed transition with a clear in and out (a camera move, a push, a wipe, a match cut, the subject crossing over). Never a plain cut and never a slow cross-fade alone.
2. Containers and shapes enter crisply: about 0.3 to 0.6 seconds with ease-out, staggered. Every drawn outline closes: no open corners, no half-drawn boxes.
3. Things that should be concentric are concentric: compute centres; a dot on a ring or a stop sits exactly on its centre.
4. Show a sequence as a sequence: line items up on one row or column, connect them with a line or arrow, reveal them in order.
5. Use the space: size the main element to the frame, and never let a label cross a line or a shape. Arrowheads touch their lines.
6. Build in the order of meaning: frame, then axes, then data, then labels.
7. Sound: original background music that fits the style, plus a sound effect on EVERY on-screen event: each jump, hit, reveal, text appearing, transition and the ending. Keep one list of event times at module level and use it in both renderFrame and renderAudio so picture and sound cannot drift.
8. Motion over stills: something meaningful moves in every second (the subject, the camera, a build step), but nothing jitters or moves at random.

READABILITY${scale}
- The main character or subject is at least 80 px tall.
- On-screen text is at least 36 px, high contrast, on a solid panel or a calm background. At most about 12 words on screen at once; hold each line at least 2.5 seconds. Use ctx.fillText with "monospace" or "sans-serif" (or draw your own pixel letters).
- No "|" separators in text; write separate lines or use commas. No em dashes and no en dashes in any on-screen text.${style}`;
}

/** Compatibility alias for the server's first placeholder import: the 16:9 prompt with no style shortcut. */
export const VIDEO_SYSTEM_PROMPT = buildVideoPrompt({ format: "16:9", vibe: null });
