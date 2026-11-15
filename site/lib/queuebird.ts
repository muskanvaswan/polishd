/**
 * Queuebird's first screen, drawn for the hero: a 1400×784 page laid out in
 * absolute pixels, so every annotation can point at an exact spot. It's the
 * live demo (demo/ in this repo) at desktop width — same copy, same classes'
 * values — once as generated and once with every fix applied. Neither has
 * a gradient or a glow: Polishd doesn't measure those, so the generated page
 * carries only flaws it does measure, and the polished one differs only by
 * their fixes. The headline keeps its size.
 *
 * The strings are trusted, static markup — no user input reaches them.
 */

export const PAGE_W = 1400;
export const PAGE_H = 784;
export const CHROME_H = 46;

const SANS = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";

const ICONS = [
  // Retries, cron, workflows — the first three feature cards.
  '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>',
  '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M10 6.5h3.5a2 2 0 0 1 2 2V14"/>',
];
const icon = (i: number, size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[i]}</svg>`;

const CARDS = [
  { title: "Durable retries", body: "Every job is persisted before it runs. Failures retry with exponential backoff.", tone: ["rgba(16,185,129,.1)", "#34d399", "rgba(16,185,129,.2)"] },
  { title: "Cron, in code", body: "Schedules live next to the function they run, typed and versioned with your app.", tone: ["rgba(14,165,233,.1)", "#38bdf8", "rgba(14,165,233,.2)"] },
  { title: "Multi-step workflows", body: "Chain steps that each retry on their own. Sleep for days between them.", tone: ["rgba(245,158,11,.1)", "#fbbf24", "rgba(245,158,11,.2)"] },
];
const LOGOS = ["Northwind", "Contoso", "Globex", "Initech", "Vandelay", "Acme"];

/** The page, as generated (`p` false) or polished (`p` true). */
function page(p: boolean): string {
  const fg = "#ffffff";
  const line = p ? "#27272a" : "rgba(255,255,255,.1)";
  const y = p
    ? { h1: 164, h2: 240, sub: 336, cta: 424, inst: 492, trust: 562, logos: 590, cards: 662 }
    : { h1: 160, h2: 238, sub: 336, cta: 428, inst: 504, trust: 572, logos: 602, cards: 668 };

  const cards = CARDS.map((c, i) => {
    const x = 80 + i * 420;
    return p
      ? `<div style="left:${x}px;top:${y.cards}px;width:400px;height:200px;border-radius:12px;border:1px solid #27272a;background:#111113;padding:24px">
          <div style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:8px;background:#18181b;box-shadow:inset 0 0 0 1px #27272a;color:#a78bfa">${icon(i, 20)}</div>
          <div style="margin-top:20px;font:600 16px ${SANS};color:#fff">${c.title}</div>
          <div style="margin-top:8px;font:400 14px/1.6 ${SANS};color:#a1a1aa">${c.body}</div>
        </div>`
      : `<div style="left:${x}px;top:${y.cards}px;width:400px;height:200px;border-radius:16px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.02);padding:22px">
          <div style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:12px;background:${c.tone[0]};box-shadow:inset 0 0 0 1px ${c.tone[2]};color:${c.tone[1]}">${icon(i, 20)}</div>
          <div style="margin-top:20px;font:600 18px ${SANS};color:#fff">${c.title}</div>
          <div style="margin-top:8px;font:400 14px/1.6 ${SANS};color:#737373">${c.body}</div>
        </div>`;
  }).join("");

  return `
  <div style="inset:0;background:${p ? "#09090b" : "#000"}"></div>
  <div style="inset:0;background-image:linear-gradient(to right,rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,.05) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse 70% 60% at 50% 0%,#000 60%,transparent 100%);mask-image:radial-gradient(ellipse 70% 60% at 50% 0%,#000 60%,transparent 100%)"></div>

  <div style="left:0;top:0;width:1400px;height:64px;border-bottom:1px solid ${line}"></div>
  <div style="left:56px;top:16px;width:32px;height:32px;border-radius:${p ? 8 : 10}px;background:${p ? "#7c3aed" : "#8b5cf6"}"></div>
  <div style="left:98px;top:${p ? 20 : 19}px;font:600 ${p ? 20 : 19}px ${SANS};letter-spacing:-.02em;color:${fg}">queuebird</div>
  <div style="left:250px;top:23px;font:400 ${p ? 14 : 15}px ${SANS};color:#a1a1aa">Docs</div>
  <div style="left:314px;top:23px;font:400 ${p ? 14 : 15}px ${SANS};color:#a1a1aa">Pricing</div>
  <div style="left:392px;top:23px;font:400 ${p ? 14 : 15}px ${SANS};color:#a1a1aa">Changelog</div>
  <div style="left:1178px;top:24px;font:400 14px ${SANS};color:${p ? "#a1a1aa" : "#a3a3a3"}">Sign in</div>
  <div class="btn" style="left:1244px;top:14px;width:112px;height:36px;border-radius:${p ? 8 : 18}px;background:${fg};color:${p ? "#09090b" : "#000"};font:500 14px ${SANS}">Get started</div>

  <div class="btn" style="left:502px;top:104px;width:396px;height:30px;gap:8px;border-radius:999px;border:1px solid ${p ? "#27272a" : "rgba(139,92,246,.3)"};background:${p ? "#111113" : "rgba(139,92,246,.1)"};font:400 ${p ? 14 : 13}px ${SANS};color:${p ? "#a1a1aa" : "#c4b5fd"}">
    <span style="display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;background:${p ? "#7c3aed" : "#8b5cf6"};color:${fg};font:600 ${p ? 12 : 11}px ${SANS}">New</span>
    Queuebird 2.0 — multi-step workflows are here →
  </div>

  <div style="left:0;top:${y.h1}px;width:1400px;text-align:center;font:700 72px/76px ${SANS};letter-spacing:-.025em;color:${fg}">Background jobs that</div>
  <div style="left:0;top:${y.h2}px;width:1400px;text-align:center;font:700 72px/76px ${SANS};letter-spacing:-.025em">
    <span style="color:${p ? "#a78bfa" : "#c084fc"}">just work.</span>
  </div>
  <div style="left:380px;top:${y.sub}px;width:640px;text-align:center;font:400 20px/1.6 ${SANS};color:${p ? "#a1a1aa" : "#71717a"}">Durable queues, retries, cron and multi-step workflows for TypeScript. No Redis to run, no workers to babysit — just functions.</div>

  <div class="btn" style="left:${p ? 530 : 524}px;top:${y.cta}px;width:${p ? 172 : 178}px;height:${p ? 44 : 48}px;border-radius:${p ? 8 : 12}px;background:${p ? "#7c3aed" : "#6366f1"};color:${fg};font:600 16px ${SANS}">Start building →</div>
  <div class="btn" style="left:${p ? 714 : 718}px;top:${y.cta}px;width:${p ? 156 : 158}px;height:${p ? 44 : 48}px;border-radius:8px;border:1px solid #27272a;background:${p ? "#111113" : "rgba(24,24,27,.6)"};color:${p ? "#fff" : "#d4d4d8"};font:500 16px ${SANS}">Read the docs</div>

  <div style="left:588px;top:${y.inst}px;width:224px;height:${p ? 40 : 38}px;border-radius:${p ? 8 : 10}px;border:1px solid ${p ? "#27272a" : "#262626"};background:${p ? "#111113" : "#171717"}"></div>
  <div style="left:604px;top:${y.inst + (p ? 11 : 10)}px;font:400 14px ${MONO};color:${p ? "#fff" : "#d4d4d4"}"><span style="color:${p ? "#8b8b95" : "#525252"}">$ </span>npm i queuebird</div>
  <div style="left:780px;top:${y.inst + (p ? 12 : 11)}px;color:${p ? "#a1a1aa" : "#737373"}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></div>

  <div style="left:0;top:${y.trust}px;width:1400px;text-align:center;font:400 14px ${SANS};color:${p ? "#8b8b95" : "#71717a"}">Trusted by engineering teams at</div>
  <div style="left:250px;top:${y.logos}px;width:900px;display:flex;justify-content:space-between;font:600 ${p ? 20 : 22}px ${SANS};letter-spacing:-.02em;color:${p ? "#8b8b95" : "#3f3f46"}">${LOGOS.map((l) => `<span>${l}</span>`).join("")}</div>

  ${cards}`;
}

export const QB_ROUGH = page(false);
export const QB_POLISHED = page(true);

// ── Where the rough edges sit on the generated page ──────────────────────────

/** Colours the page paints, and a spot where each shows. [hex, x, y] */
export const SWATCHES: [string, number, number][] = [
  ["#8b5cf6", 72, 32],
  ["#a1a1aa", 264, 32],
  ["#a3a3a3", 1201, 32],
  ["#c4b5fd", 640, 119],
  ["#c084fc", 700, 277],
  ["#6366f1", 552, 452],
  ["#27272a", 866, 452],
  ["#262626", 598, 523],
  ["#34d399", 124, 712],
  ["#38bdf8", 544, 712],
  ["#fbbf24", 964, 712],
];

/** [x, y, w, h, radius] — a different radius on each. */
export const RADII: [number, number, number, number, number][] = [
  [1244, 14, 112, 36, 18],
  [524, 428, 178, 48, 12],
  [718, 428, 158, 48, 8],
  [588, 504, 224, 38, 10],
  [500, 668, 400, 140, 16],
];

/** Hand-typed paddings off the scale. [x, y, label] */
export const PADS: [number, number, string][] = [
  [470, 507, "py 7px"],
  [912, 106, "pr 13px"],
];

/** Font sizes. [x, y, label] */
export const TYPES: [number, number, string][] = [
  [262, 178, "72px"],
  [300, 344, "20px"],
  [250, 46, "15px"],
  [98, 46, "19px"],
  [404, 106, "13px"],
  [250, 558, "22px"],
];

/** The logo row: text too dark to read. */
export const CONTRAST = { x: 238, y: 594, w: 924, h: 44, tag: [48, 601] as [number, number], label: "2.0:1 · fails AA" };
/** The copy icon: clicked again and again, wired to nothing. */
export const RAGE = { x: 788, y: 523, tag: [824, 507] as [number, number] };
/** "Changelog": styled like the links beside it, and not one. */
export const DEAD = { x: 384, y: 17, w: 88, h: 32, tag: [482, 20] as [number, number] };
