// Music + sound cues for a plan, rendered offline into one AudioBuffer (48 kHz stereo).
// Preview and export use the same buffer. No compressor: its lookahead put every sound ~6 ms late,
// so the mix is peak-normalised after rendering instead (no delay, no clipping).
import type { Plan, Vibe } from "@/lib/plan";
import { cues, planDuration, timeline, type Cue } from "./render";

export const SAMPLE_RATE = 48000;
const CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 64]];
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function noiseBuf(ac: BaseAudioContext): AudioBuffer {
  const n = ac.sampleRate;
  const b = ac.createBuffer(1, n, ac.sampleRate);
  const d = b.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    d[i] = s / 2147483648 - 1;
  }
  return b;
}

function tone(ac: BaseAudioContext, dest: AudioNode, type: OscillatorType, f: number, t: number, dur: number, g: number, a = 0.004, r = 0.05, f2?: number) {
  const o = ac.createOscillator();
  const e = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  e.gain.setValueAtTime(0, t);
  e.gain.linearRampToValueAtTime(g, t + a);
  e.gain.setValueAtTime(g, Math.max(t + a, t + dur - r));
  e.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(e).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function hit(ac: BaseAudioContext, dest: AudioNode, buf: AudioBuffer, t: number, dur: number, g: number, type: BiquadFilterType, f: number, f2?: number, q = 1) {
  const s = ac.createBufferSource();
  const fl = ac.createBiquadFilter();
  const e = ac.createGain();
  s.buffer = buf;
  fl.type = type;
  fl.Q.value = q;
  fl.frequency.setValueAtTime(f, t);
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  e.gain.setValueAtTime(g, t);
  e.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(fl).connect(e).connect(dest);
  s.start(t);
  s.stop(t + dur + 0.01);
}

function music(ac: BaseAudioContext, out: AudioNode, plan: Plan, vibe: Vibe, nb: AudioBuffer) {
  const tl = timeline(plan);
  const total = planDuration(plan);
  const chordAt = (x: number) => CHORDS[Math.max(0, tl.findIndex((s) => x < s.end)) % 4];
  if (vibe === "calm") {
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1300;
    lp.connect(out);
    tl.forEach((s, i) => {
      const a = Math.max(0, s.start - 0.3), b = Math.min(total, s.end + 0.5);
      for (const m of CHORDS[i % 4]) {
        tone(ac, lp, "triangle", mtof(m) * 1.002, a, b - a, 0.045, 0.8, 0.9);
        tone(ac, lp, "sine", mtof(m - 12) * 0.998, a, b - a, 0.05, 0.8, 0.9);
      }
    });
  } else if (vibe === "punchy") {
    for (let bt = 0, n = 0; bt < total - 0.01; bt += 0.5, n++) {
      tone(ac, out, "sine", 150, bt, 0.2, 0.55, 0.002, 0.15, 42);
      if (n % 2 === 1) hit(ac, out, nb, bt, 0.16, 0.28, "bandpass", 1900, undefined, 0.8);
      hit(ac, out, nb, bt + 0.25, 0.04, 0.1, "highpass", 7000);
      const root = chordAt(bt)[0] - 24;
      tone(ac, out, "square", mtof(root), bt, 0.2, 0.05, 0.004, 0.06);
      tone(ac, out, "square", mtof(root), bt + 0.25, 0.2, 0.05, 0.004, 0.06);
    }
  } else {
    for (let x = 0, n = 0; x < total - 0.01; x += 0.1, n++) {
      const ch = chordAt(x);
      tone(ac, out, "square", mtof(ch[n % 4] + 12), x, 0.08, 0.04, 0.002, 0.02);
      if (n % 4 === 0) tone(ac, out, "triangle", mtof(ch[0] - 12), x, 0.36, 0.16, 0.003, 0.05);
    }
  }
}

function cue(ac: BaseAudioContext, out: AudioNode, vibe: Vibe, c: Cue, nb: AudioBuffer, change: number) {
  const t = c.t;
  if (c.kind === "change") {
    if (vibe === "calm") {
      const r = CHORDS[change % 4][0] + 24;
      tone(ac, out, "sine", mtof(r), t, 1.2, 0.16, 0.003, 1.15);
      tone(ac, out, "sine", mtof(r + 7), t + 0.06, 1.0, 0.08, 0.003, 0.95);
    } else if (vibe === "punchy") {
      tone(ac, out, "sine", 95, t, 0.5, 0.7, 0.002, 0.4, 34);
      hit(ac, out, nb, t, 0.35, 0.5, "lowpass", 4000, 200);
    } else {
      tone(ac, out, "square", 400, t, 0.14, 0.1, 0.002, 0.02, 1600);
      tone(ac, out, "square", 800, t + 0.15, 0.1, 0.08, 0.002, 0.02, 1600);
    }
  } else if (vibe === "calm") tone(ac, out, "sine", mtof(84), t, 0.18, 0.08, 0.003, 0.16);
  else if (vibe === "punchy") {
    tone(ac, out, "sine", 700, t, 0.07, 0.18, 0.001, 0.05, 300);
    hit(ac, out, nb, t, 0.03, 0.12, "highpass", 5000);
  } else tone(ac, out, "square", 1200, t, 0.05, 0.05, 0.001, 0.01, 1500);
}

/** probe: music and pops muted, scene-change cues only (for sync measurement). */
export async function renderAudio(plan: Plan, vibe: Vibe, { probe = false } = {}): Promise<AudioBuffer> {
  const len = Math.round(planDuration(plan) * SAMPLE_RATE);
  const ac = new OfflineAudioContext(2, len, SAMPLE_RATE);
  const nb = noiseBuf(ac);
  const master = ac.createGain();
  master.gain.value = 0.8;
  master.connect(ac.destination);
  if (!probe) music(ac, master, plan, vibe, nb);
  let change = 0;
  for (const c of cues(plan, vibe)) {
    if (c.kind === "change") change++;
    if (probe && c.kind !== "change") continue;
    cue(ac, master, vibe, c, nb, change);
  }
  const buf = await ac.startRendering();
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const v of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.89) for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); const k = 0.89 / peak; for (let i = 0; i < d.length; i++) d[i] *= k; }
  return buf;
}
