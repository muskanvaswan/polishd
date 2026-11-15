/**
 * The findings the landing page shows. All of it is Queuebird, the live demo
 * (demo/ in this repo): numbers and flags copied from Polishd's own dashboard
 * for it. demo/README.md says how the traffic was recorded. The two AI reviews
 * and the pull request in the walkthrough are labelled examples: the numbers
 * were captured without a model connected.
 */
export type FindingSource = "Design" | "Analytics";

export type FindingPreview = {
  source: FindingSource;
  title: string;
  /** Where it lives: a source file, or a page and selector. */
  cite: string;
};

/** The hero's card: what Polishd flagged on the page the hero shows. */
export const FINDINGS_PREVIEW: FindingPreview[] = [
  { source: "Design", title: "33 colours, zinc and neutral mixed", cite: "every page · #a1a1aa ≈ #a3a3a3" },
  { source: "Design", title: "7 corner radii where 2–4 would do", cite: "4 · 6 · 8 · 10 · 12 · 16 · 24px" },
  { source: "Design", title: "18 font sizes where 5–8 would do", cite: "11 · 13 · 13.5 · 15 · 19px …" },
  { source: "Design", title: "12 text pairs fail WCAG AA", cite: "#3f3f46 on #000000 · 2.0:1" },
  { source: "Analytics", title: "The copy icons don't copy", cite: "/ and /docs · 24 rage, 72 dead" },
  { source: "Analytics", title: "“Changelog” goes nowhere", cite: "/ · nav span · 23 dead" },
];

type Tone = "bad" | "warn" | "neutral";

/** The dashboard panels in "How it works", filled with the demo's numbers. */
export const WALKTHROUGH = {
  design: {
    palette: [
      "#ffffff", "#f4f4f5", "#e4e4e7", "#d4d4d8", "#d4d4d4", "#a3a3a3", "#a1a1aa", "#737373", "#71717a", "#525252",
      "#52525b", "#3f3f46", "#27272a", "#262626", "#18181b", "#171717", "#141118", "#131316", "#0d0d10", "#000000",
      "#c4b5fd", "#a78bfa", "#c084fc", "#8b5cf6", "#9333ea", "#818cf8", "#6366f1", "#f472b6", "#34d399", "#38bdf8",
      "#fbbf24", "#f59e0b", "#fb7185",
    ],
    paletteNote: "33 colours · 3 near-duplicate greys · 7 purples",
    /** The brand kit Polishd's Overview reads off the pages. */
    kit: [
      ["Primary", "#ffffff"],
      ["Secondary", "#27272a"],
      ["Accent", "#8b5cf6"],
    ] as [string, string][],
    typeScale: [72, 60, 48, 42, 36, 30, 24, 22, 20, 19, 18, 16, 15, 14, 13.5, 13, 12, 11],
    radii: [4, 6, 8, 10, 12, 16, 24],
    flags: [
      { tone: "bad" as Tone, title: "Text pairs fail WCAG AA", value: "8" },
      { tone: "bad" as Tone, title: "Near-duplicate greys: zinc and neutral", value: "#737373 ≈ #71717a" },
      { tone: "warn" as Tone, title: "Font sizes, where 5–8 would do", value: "18" },
      { tone: "warn" as Tone, title: "Corner radii, where 2–4 would do", value: "7" },
      { tone: "warn" as Tone, title: "Padding off the scale", value: "13 · 7 · 11 · 17 · 15" },
    ],
  },
  behaviour: {
    metrics: [
      { label: "Sessions", value: "200", note: "2 weeks", tone: "neutral" as Tone },
      { label: "Rage clicks", value: "77", note: "on 3 elements", tone: "bad" as Tone },
      { label: "Dead clicks", value: "188", note: "on 6 elements", tone: "warn" as Tone },
      { label: "On mobile", value: "26.5%", note: "of sessions", tone: "neutral" as Tone },
    ],
    struggle: [
      { label: "span “Yearly -#%” · the billing switch", value: "rage ×30", tone: "bad" as Tone, share: 100 },
      { label: "div > svg · the copy icons", value: "dead ×72", tone: "warn" as Tone, share: 100 },
      { label: "span “Next.js” · a code tab", value: "rage ×23", tone: "bad" as Tone, share: 77 },
    ],
  },
  analyse: {
    reviews: [
      {
        title: "Analytics review",
        tone: "bad" as Tone,
        body: "77 rage clicks land on three things that look like controls and aren't: the Yearly switch (30), the install command's copy icon (24) and the code tabs (23). The copy icons take 72 dead clicks between / and /docs.",
      },
      {
        title: "Design review",
        tone: "neutral" as Tone,
        body: "33 colours, with Tailwind's zinc and neutral greys used side by side and seven purples, and 12 text pairs under AA — the copyright line is 2.0:1. 18 font sizes and 7 radii where a scale would do.",
      },
    ],
    promptNote: "one prompt for your coding agent · every issue, cited",
  },
  fix: {
    rows: [
      { source: "Analytics" as FindingSource, title: "The Yearly switch doesn't switch", cite: "/pricing · span.flex" },
      { source: "Analytics" as FindingSource, title: "The copy icons don't copy", cite: "/ and /docs · div > svg" },
      { source: "Design" as FindingSource, title: "33 colours, zinc and neutral mixed", cite: "components/site/hero.tsx" },
    ],
    issue: 42,
    pr: 43,
    prTitle: "fix: make the Yearly switch a real switch",
    prFiles: "1 file",
    plus: 18,
    minus: 6,
    diff: [
      ["-", '<span className="flex cursor-pointer items-center gap-2 px-4 py-1.5 …">'],
      ["-", "  Yearly"],
      ["+", '<button role="radio" aria-checked={yearly} onClick={() => setYearly(true)} …>'],
      ["+", "  Yearly"],
    ] as ["-" | "+", string][],
  },
};
