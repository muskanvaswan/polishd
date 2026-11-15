import { SectionHead, Wrap, d } from "@/components/kit";

/**
 * Where everything runs, and what can ever leave the app — each only when
 * the owner turns it on. A developer's second question after
 * "what is it" is "what does it send where", so it gets a picture.
 */

type Node = { x: number; y: number; w: number; h: number; title: string; lines: string[]; tone?: "app" | "out" | "you" };

const NODES: Record<string, Node> = {
  browser: { x: 20, y: 92, w: 200, h: 112, title: "Visitor's browser", lines: ["instrumentation-client.ts", "clicks · scrolls · vitals"], tone: "you" },
  route: { x: 316, y: 72, w: 196, h: 88, title: "/api/polishd", lines: ["ingest route", "mints the session cookie"], tone: "app" },
  db: { x: 556, y: 72, w: 196, h: 88, title: "Your database", lines: ["SQLite in dev", "Postgres in production"], tone: "app" },
  dash: { x: 436, y: 222, w: 196, h: 96, title: "/polishd", lines: ["your dashboard", "behind your auth"], tone: "app" },
  model: { x: 846, y: 40, w: 214, h: 92, title: "Your model provider", lines: ["a digest, not events", "your key, your bill"], tone: "out" },
  github: { x: 846, y: 178, w: 214, h: 80, title: "GitHub", lines: ["an issue, when you file it"], tone: "out" },
  agent: { x: 846, y: 304, w: 214, h: 92, title: "Your coding agent", lines: ["Claude Code Action · Copilot", "opens a pull request"], tone: "out" },
};

const WIRES: { id: string; d: string; label?: [number, number, string]; tone: "ok" | "out" }[] = [
  { id: "w1", d: "M220 148 H316", label: [268, 138, "events"], tone: "ok" },
  { id: "w2", d: "M512 116 H556", tone: "ok" },
  { id: "w3", d: "M654 160 V190 H560 V222", tone: "ok" },
  { id: "w4", d: "M632 248 C730 248 740 86 846 86", label: [742, 140, "digest"], tone: "out" },
  { id: "w5", d: "M632 280 C740 280 760 218 846 218", label: [760, 264, "issue"], tone: "out" },
  { id: "w6", d: "M953 258 V304", tone: "out" },
  { id: "w7", d: "M846 372 C700 420 600 420 534 318", label: [672, 422, "pull request → your repo"], tone: "out" },
];

export default function WhereItRuns() {
  return (
    <section id="runs" className="relative z-10 py-24 md:py-32">
      <Wrap>
        <SectionHead
          lead={<>Everything runs in your app.</>}
          title={<>Here&apos;s what ever leaves it.</>}
          sub="No Polishd account, no hosted analytics, no script from someone else's CDN. A few things can leave your server, and each only once you turn it on."
        />

        <div className="r card mt-14 overflow-hidden p-4 sm:p-8" style={d(80)}>
          {/* Wide screens: the diagram. */}
          <svg viewBox="0 0 1080 450" className="hidden w-full md:block" role="img" aria-label="Polishd's data flow: the visitor's browser sends events to your app's /api/polishd route, which writes to your database; your /polishd dashboard reads it, sends a digest to your model provider, files issues on GitHub, and your coding agent opens a pull request on your repo.">
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" fill="#5e5e5e" />
              </marker>
            </defs>

            {/* Your app's boundary. */}
            <rect x="290" y="16" width="490" height="330" rx="18" fill="rgba(74,222,128,.025)" stroke="rgba(74,222,128,.35)" strokeDasharray="5 6" />
            <text x="310" y="44" className="fill-ok font-mono text-[12px] uppercase tracking-[0.14em]">
              Your Next.js app · your infrastructure
            </text>

            {WIRES.map((w) => (
              <g key={w.id}>
                <path id={w.id} d={w.d} fill="none" stroke="#363636" strokeWidth="1.5" markerEnd="url(#arr)" />
                <path d={w.d} fill="none" stroke={w.tone === "ok" ? "rgba(74,222,128,.55)" : "rgba(201,176,143,.6)"} strokeWidth="1.5" className="wire" />
                <circle r="3.5" fill={w.tone === "ok" ? "#4ade80" : "#c9b08f"}>
                  <animateMotion dur={w.tone === "ok" ? "2.2s" : "3.4s"} repeatCount="indefinite" rotate="auto">
                    <mpath href={`#${w.id}`} />
                  </animateMotion>
                </circle>
                {w.label ? (
                  <text x={w.label[0]} y={w.label[1]} textAnchor="middle" className="fill-fg-3 font-mono text-[11.5px]">
                    {w.label[2]}
                  </text>
                ) : null}
              </g>
            ))}

            {Object.entries(NODES).map(([key, n]) => (
              <g key={key}>
                <rect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  rx="12"
                  fill={n.tone === "app" ? "#141414" : "#101010"}
                  stroke={n.tone === "app" ? "#363636" : "#262626"}
                />
                <text x={n.x + 16} y={n.y + 30} className="fill-fg font-chart text-[15px] font-semibold">
                  {n.title}
                </text>
                {n.lines.map((l, i) => (
                  <text key={l} x={n.x + 16} y={n.y + 54 + i * 20} className="fill-fg-3 font-mono text-[11.5px]">
                    {l}
                  </text>
                ))}
              </g>
            ))}
          </svg>

          {/* Phones: the same flow, top to bottom. */}
          <ol className="space-y-2 md:hidden">
            {[
              ["Visitor's browser", "clicks · scrolls · vitals", "you"],
              ["/api/polishd → your database", "SQLite in dev, Postgres in production", "app"],
              ["/polishd", "your dashboard, behind your auth", "app"],
              ["→ your model provider", "a digest, with your key", "out"],
              ["→ GitHub → your coding agent", "an issue, then a pull request", "out"],
            ].map(([t, s, tone], i) => (
              <li
                key={t}
                className={`rounded-xl border p-3.5 ${tone === "app" ? "border-ok/30 bg-ok/[0.03]" : "border-line bg-sunken"}`}
              >
                <div className="flex items-center gap-2 font-chart text-[14px] font-semibold text-fg">
                  <span className="font-mono text-[11px] text-fg-4">{i + 1}</span>
                  {t}
                </div>
                <div className="mt-1 pl-5 font-mono text-[11.5px] text-fg-3">{s}</div>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            {
              tone: "ok",
              k: "Stays in your app",
              v: "Every raw event and session, every design scan, the dashboard and its settings. Polishd's two tables can sit in the database you already have.",
            },
            {
              tone: "violet",
              k: "Leaves when you add a key",
              v: "A digest of the aggregates — a few hundred tokens for a whole site — to the model provider you pick (Anthropic, OpenAI, Gemini or any OpenAI-compatible endpoint), and for the design review, the first screen of your top pages. Regenerated when you ask, or daily or weekly if you choose.",
            },
            {
              tone: "violet",
              k: "Leaves only if you say so",
              v: "An issue, when you file one on your repo. Page screenshots, through Polishd's screenshot service, once you agree in the dashboard. Anonymous usage of the dashboard itself, if you opt in when it asks — never your site's analytics.",
            },
          ].map((c, i) => (
            <div key={c.k} className="r card p-5" style={d(120 + i * 70)}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${c.tone === "ok" ? "bg-ok" : "bg-violet"}`} />
                <h3 className="font-heading text-[16px] font-semibold text-fg">{c.k}</h3>
              </div>
              <p className="mt-2.5 font-chart text-[14px] leading-[1.6] text-fg-3">{c.v}</p>
            </div>
          ))}
        </div>
      </Wrap>
    </section>
  );
}
