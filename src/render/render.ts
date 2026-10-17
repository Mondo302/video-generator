// Pure scene renderer: the same (t, plan, vibe) always gives the same pixels.
// Type-only imports keep zod out of the client bundle.
import type { Plan, Scene, Vibe } from "@/lib/plan";

export const W = 1280;
export const H = 720;
const LW = 320;
const LH = 180;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Scheme = { bg: string; fg: string; dim: string; acc: string };
type VibeStyle = Scheme & {
  head: string;
  body: string;
  tr: number; // transition length, centred on each scene change
  lead: number; // entrances start this much before their delay
  inDur: number;
  stagger: number;
  low: boolean; // retro: draw at 320x180, 4 colours, stepped time
  fps?: number;
  pal?: string[];
  schemes?: Scheme[];
};
export type TimedScene = Scene & { start: number; end: number };
export type Cue = { t: number; kind: "change" | "pop" };

const RETRO_PAL = ["#10141f", "#2e4a7a", "#e8a33d", "#f2ecd8"];
export const VIBE_STYLES: Record<Vibe, VibeStyle> = {
  calm: {
    bg: "#0f1c22", fg: "#e7efe9", dim: "#93aaa1", acc: "#86cdb0",
    head: '600 {s}px Georgia,"Times New Roman",serif', body: '400 {s}px "Segoe UI",system-ui,sans-serif',
    tr: 0.8, lead: 0.35, inDur: 0.9, stagger: 0.18, low: false,
  },
  punchy: {
    bg: "#0a0a0a", fg: "#ffffff", dim: "#d0d0d0", acc: "#ffd400",
    schemes: [
      { bg: "#0a0a0a", fg: "#ffffff", dim: "#d0d0d0", acc: "#ffd400" },
      { bg: "#ffd400", fg: "#0a0a0a", dim: "#2a2a2a", acc: "#0a0a0a" },
      { bg: "#f4f4f4", fg: "#0a0a0a", dim: "#333333", acc: "#ffd400" },
    ],
    head: '900 {s}px "Arial Black",Impact,"Segoe UI",sans-serif', body: '700 {s}px "Segoe UI",Arial,sans-serif',
    tr: 0.36, lead: 0, inDur: 0.38, stagger: 0.09, low: false,
  },
  retro: {
    bg: RETRO_PAL[0], fg: RETRO_PAL[3], dim: RETRO_PAL[2], acc: RETRO_PAL[2], pal: RETRO_PAL,
    head: '700 {s}px "Courier New",monospace', body: '700 {s}px "Courier New",monospace',
    tr: 0.6, lead: 0, inDur: 0.5, stagger: 0.25, low: true, fps: 12,
  },
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const outBack = (x: number) => 1 + 2.9 * Math.pow(x - 1, 3) + 1.9 * Math.pow(x - 1, 2);
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function planDuration(plan: Plan): number {
  return plan.scenes.reduce((s, x) => s + x.duration_s, 0);
}
export function timeline(plan: Plan): TimedScene[] {
  let a = 0;
  return plan.scenes.map((s) => {
    const o = { ...s, start: a, end: a + s.duration_s };
    a += s.duration_s;
    return o;
  });
}

// Entrance delays (seconds into a scene), shared by the drawing and the sound cues.
const D = { titleBody: 0.45, rule: 0.25, textBody: 0.45, listItem0: 0.25, statLabel: 0.3, statBody: 0.5 };
const listItemDelay = (V: VibeStyle, k: number) => D.listItem0 + k * V.stagger * 1.6;

/** Every on-screen event with its time: scene changes and element entrances (one sound each). */
export function cues(plan: Plan, vibe: Vibe): Cue[] {
  const V = VIBE_STYLES[vibe];
  const out: Cue[] = [];
  const at = (s: TimedScene, d: number) => Math.max(s.start, s.start + d - V.lead);
  timeline(plan).forEach((s, i) => {
    out.push(i > 0 ? { t: s.start, kind: "change" } : { t: 0, kind: "pop" });
    if (s.type === "title" && s.body) out.push({ t: at(s, D.titleBody), kind: "pop" });
    if (s.type === "text" && s.body) out.push({ t: at(s, D.textBody), kind: "pop" });
    if (s.type === "list") (s.items ?? []).slice(0, 4).forEach((_, k) => out.push({ t: at(s, listItemDelay(V, k)), kind: "pop" }));
    if (s.type === "stat") {
      out.push({ t: at(s, D.statLabel), kind: "pop" });
      if (s.body) out.push({ t: at(s, D.statBody), kind: "pop" });
    }
  });
  const total = planDuration(plan);
  return out.filter((c) => c.t < total - 0.05);
}

type Scratch = { c: OffscreenCanvas | HTMLCanvasElement; g: Ctx };
const cache: Record<string, Scratch> = {};
function scratch(key: string, w: number, h: number): Scratch {
  if (!cache[key]) {
    const c: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const g = c.getContext("2d", { willReadFrequently: true }) as Ctx | null;
    if (!g) throw new Error("2D canvas is not available");
    cache[key] = { c, g };
  }
  return cache[key];
}
const font = (tpl: string, s: number) => tpl.replace("{s}", String(Math.round(s)));
function wrap(g: Ctx, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    const t = line ? line + " " + w : w;
    if (g.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
/** Same line count as a greedy wrap, at the narrowest width that keeps it: no word left alone. */
function wrapBalanced(g: Ctx, text: string, maxW: number): string[] {
  const n = wrap(g, text, maxW).length;
  if (n < 2) return wrap(g, text, maxW);
  let lo = maxW * 0.3;
  let hi = maxW;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(g, text, mid).length > n) lo = mid;
    else hi = mid;
  }
  return wrap(g, text, hi);
}
const schemeFor = (V: VibeStyle, i: number): Scheme => (V.schemes ? V.schemes[i % V.schemes.length] : V);

function enter(g: Ctx, V: VibeStyle, lt: number, delay: number, fn: (raw: number) => void, u: number) {
  const raw = clamp01((lt + V.lead - delay) / V.inDur);
  if (raw <= 0) return;
  g.save();
  if (V.low) g.translate(0, Math.round((1 - raw) * 40 * u));
  else if (V.schemes) {
    g.translate((1 - outBack(raw)) * -140 * u, 0);
    g.globalAlpha = clamp01(raw * 5);
  } else {
    const e = outCubic(raw);
    g.translate(0, (1 - e) * 26 * u);
    g.globalAlpha = e;
  }
  fn(raw);
  g.restore();
}

function drawBg(g: Ctx, w: number, h: number, V: VibeStyle, S: Scheme, t: number, u: number) {
  g.fillStyle = S.bg;
  g.fillRect(0, 0, w, h);
  if (!V.low && !V.schemes) {
    const cx = w * (0.72 + 0.05 * Math.sin(t * 0.35));
    const cy = h * (0.3 + 0.04 * Math.cos(t * 0.27));
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 620 * u);
    gr.addColorStop(0, "rgba(134,205,176,0.13)");
    gr.addColorStop(1, "rgba(134,205,176,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  if (V.low && V.pal) {
    const b = 8;
    g.fillStyle = V.pal[1];
    for (let x = 0; x < w; x += b * 2) g.fillRect(x + (Math.floor(t * 4) % 2) * b, h - b * 2, b, b);
    g.fillRect(0, h - b, w, b);
  }
}

function drawScene(g: Ctx, w: number, h: number, sc: TimedScene, i: number, lt: number, V: VibeStyle, t: number) {
  const u = h / 720;
  const S = schemeFor(V, i);
  drawBg(g, w, h, V, S, t, u);
  g.textBaseline = "top";
  g.textAlign = "left";
  const L = 120 * u;
  const ch = V.low ? h - 16 : h; // retro keeps clear of the brick band
  const sz = (smooth: number, retro: number) => (V.low ? retro : smooth) * u;
  if (sc.type === "title") {
    const fs = sz(92, 84), bs = sz(32, 44), lh = fs * 1.12;
    g.font = font(V.head, fs);
    const lines = wrapBalanced(g, sc.heading, w * 0.8);
    const blockH = lines.length * lh + 32 * u + (sc.body ? 34 * u + bs : 0);
    let y = (ch - blockH) / 2;
    g.textAlign = "center";
    lines.forEach((ln, k) =>
      enter(g, V, lt, k * V.stagger, () => {
        g.font = font(V.head, fs);
        g.fillStyle = S.fg;
        g.fillText(ln, w / 2, y + k * lh);
      }, u),
    );
    y += lines.length * lh + 26 * u;
    enter(g, V, lt, D.rule, (raw) => {
      const rw = 180 * u * (V.low ? raw : outCubic(raw));
      g.fillStyle = S.acc;
      g.fillRect(Math.round(w / 2 - rw / 2), y, rw, Math.max(1, 6 * u));
    }, u);
    const body = sc.body;
    if (body) enter(g, V, lt, D.titleBody, () => { g.font = font(V.body, bs); g.fillStyle = S.dim; g.fillText(body, w / 2, y + 34 * u); }, u);
  } else if (sc.type === "text") {
    const fs = sz(68, 60), bs = sz(36, 46), lh = fs * 1.12, blh = bs * 1.4;
    g.font = font(V.head, fs);
    const hl = wrapBalanced(g, sc.heading, w - 2 * L);
    g.font = font(V.body, bs);
    const bl = sc.body ? wrapBalanced(g, sc.body, V.low ? w - 2 * L : w * 0.62) : [];
    const blockH = 40 * u + hl.length * lh + (bl.length ? 40 * u + bl.length * blh : 0);
    let y = (ch - blockH) / 2 + 40 * u;
    enter(g, V, lt, 0, (raw) => { g.fillStyle = S.acc; g.fillRect(L, y - 34 * u, 70 * u * (V.low ? raw : outCubic(raw)), Math.max(1, 6 * u)); }, u);
    hl.forEach((ln, k) => enter(g, V, lt, k * V.stagger, () => { g.font = font(V.head, fs); g.fillStyle = S.fg; g.fillText(ln, L, y + k * lh); }, u));
    y += hl.length * lh + 40 * u;
    bl.forEach((ln, k) => enter(g, V, lt, D.textBody + k * V.stagger * 0.5, () => { g.font = font(V.body, bs); g.fillStyle = S.dim; g.fillText(ln, L, y + k * blh); }, u));
  } else if (sc.type === "list") {
    const fs = sz(60, 60), is = sz(42, 46), step = 96 * u;
    const items = (sc.items ?? []).slice(0, 4);
    const blockH = fs * 1.12 + 50 * u + Math.max(0, items.length - 1) * step + is * 1.2;
    const y0 = (ch - blockH) / 2;
    enter(g, V, lt, 0, () => { g.font = font(V.head, fs); g.fillStyle = S.fg; g.fillText(sc.heading, L, y0); }, u);
    items.forEach((it, k) => {
      const y = y0 + fs * 1.12 + 50 * u + k * step;
      enter(g, V, lt, listItemDelay(V, k), () => {
        g.fillStyle = S.acc;
        if (V.low) { g.font = font(V.body, is); g.fillText(">", L, y); }
        else if (V.schemes) g.fillRect(L, y + 6 * u, 30 * u, 30 * u);
        else { g.beginPath(); g.arc(L + 12 * u, y + is * 0.55, 8 * u, 0, Math.PI * 2); g.fill(); }
        g.font = font(V.body, is);
        g.fillStyle = S.fg;
        g.fillText(it, L + 60 * u, y);
      }, u);
    });
  } else {
    const m = /^(\D*)(\d+(?:\.\d+)?)(.*)$/.exec(sc.value ?? "");
    const vs = sz(230, 200), cy = ch * 0.45;
    g.textAlign = "center";
    enter(g, V, lt, 0, (raw) => {
      const cnt = V.low ? Math.floor(clamp01(raw * 1.6) * 6) / 6 : outCubic(clamp01(raw * 1.4));
      let txt = sc.value ?? "";
      if (m) {
        const dec = (m[2].split(".")[1] ?? "").length;
        txt = m[1] + (parseFloat(m[2]) * Math.min(1, cnt)).toFixed(dec) + m[3];
      }
      g.font = font(V.head, vs);
      g.fillStyle = V.schemes && i % 3 !== 0 ? S.fg : S.acc;
      g.fillText(txt, w / 2, cy - vs * 0.55);
    }, u);
    enter(g, V, lt, D.statLabel, () => { g.font = font(V.head, sz(44, 48)); g.fillStyle = S.fg; g.fillText(sc.heading, w / 2, cy + vs * 0.55); }, u);
    const body = sc.body;
    if (body) enter(g, V, lt, D.statBody, () => { g.font = font(V.body, sz(30, 40)); g.fillStyle = S.dim; g.fillText(body, w / 2, cy + vs * 0.55 + 66 * u); }, u);
  }
}

// Every scene change has a transition: calm crossfade, punchy colour-bar slam, retro stepped block wipe.
function composite(g: Ctx, w: number, h: number, A: Scratch, B: Scratch, p: number, V: VibeStyle, k: number) {
  const u = h / 720;
  if (V.low) {
    const cs = 20, cols = Math.ceil(w / cs), rows = Math.ceil(h / cs), max = cols + rows - 2;
    g.drawImage(A.c, 0, 0);
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++)
        if (p * 1.08 > (cx + cy) / max) g.drawImage(B.c, cx * cs, cy * cs, cs, cs, cx * cs, cy * cs, cs, cs);
  } else if (V.schemes) {
    const sA = schemeFor(V, k), sB = schemeFor(V, k + 1);
    const bar = sA.bg === "#ffd400" || sB.bg === "#ffd400" ? "#0a0a0a" : "#ffd400";
    if (p < 0.5) {
      const q = p / 0.5;
      g.drawImage(A.c, -50 * u * q * q, 0);
      const x = Math.floor(w * (1 - q * q));
      g.fillStyle = bar;
      g.fillRect(x, 0, w - x, h);
    } else {
      g.drawImage(B.c, 0, 0);
      const bw = Math.round(w * (1 - outCubic(clamp01((p - 0.5) / 0.4)))); // gone before the window ends
      if (bw >= 1) { g.fillStyle = bar; g.fillRect(0, 0, bw, h); }
    }
  } else {
    const e = inOut(p);
    g.drawImage(A.c, 0, 0);
    g.save();
    g.globalAlpha = e;
    g.drawImage(B.c, 0, 16 * u * (1 - e));
    g.restore();
  }
}

function quantize(sc: Scratch, pal: string[]) {
  const rgb = pal.map((hx) => [1, 3, 5].map((o) => parseInt(hx.slice(o, o + 2), 16)));
  const im = sc.g.getImageData(0, 0, sc.c.width, sc.c.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    let best = 0, bd = 1e9;
    for (let j = 0; j < 4; j++) {
      const dr = d[i] - rgb[j][0], dg = d[i + 1] - rgb[j][1], db = d[i + 2] - rgb[j][2];
      const dd = dr * dr + dg * dg + db * db;
      if (dd < bd) { bd = dd; best = j; }
    }
    d[i] = rgb[best][0]; d[i + 1] = rgb[best][1]; d[i + 2] = rgb[best][2]; d[i + 3] = 255;
  }
  sc.g.putImageData(im, 0, 0);
}

export function renderFrame(ctx: Ctx, time: number, plan: Plan, vibe: Vibe): void {
  const V = VIBE_STYLES[vibe];
  const tl = timeline(plan);
  const total = tl[tl.length - 1].end;
  let t = Math.max(0, Math.min(time, total));
  if (V.low && V.fps) t = Math.floor(t * V.fps + 1e-6) / V.fps;
  const w = V.low ? LW : W, h = V.low ? LH : H;
  const out = scratch("out" + w, w, h);
  let k = -1;
  for (let i = 0; i < tl.length - 1; i++) if (Math.abs(t - tl[i].end) < V.tr / 2) { k = i; break; }
  out.g.setTransform(1, 0, 0, 1, 0, 0);
  out.g.globalAlpha = 1;
  if (k < 0) {
    let i = tl.findIndex((s) => t < s.end);
    if (i < 0) i = tl.length - 1;
    drawScene(out.g, w, h, tl[i], i, t - tl[i].start, V, t);
  } else {
    const A = scratch("A" + w, w, h), B = scratch("B" + w, w, h);
    drawScene(A.g, w, h, tl[k], k, t - tl[k].start, V, t);
    drawScene(B.g, w, h, tl[k + 1], k + 1, t - tl[k + 1].start, V, t);
    composite(out.g, w, h, A, B, (t - (tl[k].end - V.tr / 2)) / V.tr, V, k);
  }
  if (V.low && V.pal) quantize(out, V.pal);
  ctx.save();
  ctx.imageSmoothingEnabled = !V.low;
  ctx.drawImage(out.c, 0, 0, W, H);
  ctx.restore();
}

/** renderFrame plus the test-only sync marker: white for 0.1 s from each scene change. */
export function drawFrame(ctx: Ctx, t: number, plan: Plan, vibe: Vibe, probe = false): void {
  renderFrame(ctx, t, plan, vibe);
  if (probe && timeline(plan).slice(0, -1).some((s) => t >= s.end - 1e-9 && t < s.end + 0.1)) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
  }
}
