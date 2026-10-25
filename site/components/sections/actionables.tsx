import {
  ArrowUpRightIcon,
  ChartIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  DropletIcon,
} from "@/components/dash/icons";
import { Pointer } from "@/components/dash/pointer";
import {
  Badge,
  GhostBtn,
  PrimaryBtn,
  card,
  cardHeader,
  cardTitleCls,
  eyebrowCls,
  labelCls,
  toneDot,
  type Tone,
} from "@/components/dash/ui";
import { Eyebrow, Heading, Sub, Wrap } from "@/components/ui";

/**
 * The Actionables tab: everything both reviews found worth fixing, in one
 * list, with what has become of each.
 *
 * The analytics summary's losses and the design review's issues used to sit
 * in rails under their own cards, and the issues filed from them on a tab of
 * their own. On the dashboard now they're one list: what still needs a
 * decision first, then what's in the tracker. Each row carries its source
 * mark (the Analytics chart in red, the Design droplet in blue), a status, a
 * picture of where a design value renders, the GitHub issue it's filed as,
 * and three verdicts on hover — Mark fixed, Ignore, File bug. A filed issue
 * also carries where its fix stands, once the coding agent has been asked for
 * one; the Fix section picks #42 up from here.
 *
 * Beside the list, the Overview's other move: one prompt that hands every
 * open problem to the coding agent working in the repo, and the paste box
 * that reads its verdicts back.
 *
 * Shown as the components themselves, at the tab's own density.
 */

const REPO = "fieldnote/slow-web";

type Source = "analytics" | "design";

type Row = {
  source: Source;
  title: string;
  status?: { text: string; tone: Tone };
  /** The GitHub issue it's filed as, and the tracker's line about it. */
  issue?: { number: number; meta: string };
  /** A design value's picture: where it renders. */
  pictured?: boolean;
  /** Shown as the pointer leaves it: the verdicts revealed. */
  hovered?: boolean;
  /** Decided: fixed or ignored, with the owner's note. */
  dismissed?: { fixed: boolean; reason: string };
};

const ROWS: Row[] = [
  {
    source: "analytics",
    title: "Readers rage-click post headings, mistaking the link styling for a link.",
    hovered: true,
  },
  {
    source: "design",
    title: "The byline grey fails on paper.",
    status: { text: "fix suggested", tone: "info" },
    pictured: true,
  },
  {
    source: "analytics",
    title: "The narration button throws on Safari: play() rejected without a gesture.",
    status: { text: "agent working", tone: "info" },
    issue: { number: 42, meta: "opened 2h ago · 2 comments" },
  },
  {
    source: "design",
    title: "A 21px subheading used three times stands in for the 28px step.",
    status: { text: "fix merged", tone: "violet" },
    issue: { number: 39, meta: "opened 3d ago · PR #40 merged yesterday" },
  },
  {
    source: "design",
    title: "Two rusts a hair apart split the accent.",
    dismissed: { fixed: true, reason: "Collapsed #c4400d into the --accent token." },
  },
  {
    source: "analytics",
    title: "Zero recorded scroll depth on one article — likely a viewport or script failure.",
    dismissed: { fixed: false, reason: "The page is an audio essay; its scroll container is the player." },
  },
];

const STATS: { label: string; value: number; tone?: Tone }[] = [
  { label: "To act on", value: 2, tone: "warn" },
  { label: "Filed on GitHub", value: 2 },
  { label: "Open there", value: 1, tone: "ok" },
  { label: "Closed", value: 1, tone: "violet" },
];

/** The agent's verdict block, read back against the findings it was given. */
const VERDICTS = [
  {
    id: "A1",
    verdict: "fixed",
    issue: "Readers rage-click post headings, mistaking the link styling for a link.",
    note: "Nothing to record — the next review shows whether the fix held.",
  },
  {
    id: "A2",
    verdict: "not real",
    issue: "Zero recorded scroll depth on one article — likely a viewport or script failure.",
    note: "Will be ignored — “The page is an audio essay; its scroll container is the player.”",
  },
  {
    id: "D1",
    verdict: "deliberate",
    issue: "Two rusts a hair apart split the accent.",
    note: "Will be ignored — “#c4400d is the pressed state of the primary button.”",
  },
];

const microLink = "text-[11px] font-medium text-fg-3 underline decoration-fg-4 underline-offset-2";

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

export default function Actionables() {
  return (
    <section id="act" className="py-[76px] md:py-28">
      <Wrap>
        <Eyebrow>Live today · actionables</Eyebrow>
        <Heading>
          A bug, not a chart.
          <br />
          <span className="text-fg-4">File it, fix it, or hand it&nbsp;off.</span>
        </Heading>
        <Sub>
          Both reviews hand what they find to one list: the analytics losses and the design issues
          together, each with its evidence and, for a design value, a picture of where it renders.
          File one and it&apos;s verified against your source first. Mark one fixed, or ignore it
          with a reason the model reads back.
        </Sub>

        <div className="mt-[34px] grid grid-cols-1 gap-3 lg:grid-cols-[1.35fr_1fr]">
          {/* The tab: its counts, then the list. */}
          <div className="grid content-start gap-3">
            <div className="r font-chart grid grid-cols-2 gap-3 text-fg sm:grid-cols-4">
              {STATS.map((s) => (
                <div key={s.label} className={`${card} px-4 py-4`}>
                  <div className={`flex items-center gap-1.5 ${labelCls}`}>
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.tone ? toneDot[s.tone] : "bg-fg-4"}`}
                    />
                    <span className="leading-tight">{s.label}</span>
                  </div>
                  <div className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-fg">
                    {s.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="card font-chart r lift overflow-hidden text-fg" style={delay(60)}>
              <div className={cardHeader}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={cardTitleCls}>Actionables</span>
                  <Badge showFrom="sm">both reviews, one list</Badge>
                </div>
                <GhostBtn className="h-7 px-2.5 font-mono text-[11.5px]">
                  {REPO}
                  <ArrowUpRightIcon />
                </GhostBtn>
              </div>
              <ul>
                {ROWS.map((row) => (
                  <ActionableRow key={row.title} row={row} />
                ))}
              </ul>
            </div>

            {/* Where a filed issue goes next: the fix pipeline. */}
            <div className="r font-chart text-fg" style={delay(120)}>
              <Pointer tone="bg-ok" href="#fix" label="Create fix" className="">
                Filed issues go on to your coding agent, and come back as pull requests.
              </Pointer>
            </div>
          </div>

          {/* The Overview's move: every open problem, to the agent, and back. */}
          <div className="grid content-start gap-3">
            <div className="card font-chart r lift overflow-hidden text-fg" style={delay(90)}>
              <div className={cardHeader}>
                <span className={cardTitleCls}>Fix prompt</span>
                <FixPromptButton count={7} />
              </div>

              <pre className="whitespace-pre-wrap break-words px-4 py-4 font-mono text-[11.5px] leading-[1.7] text-fg-2 sm:px-5">
                <span className="text-fg">
                  # Fix the analytics and design problems Polishd found
                </span>
                {"\n\n"}
                <span className="text-fg">**A1.**</span> Readers rage-click post headings, mistaking
                the link styling for a link.
                {"\n"}
                {"  - Evidence: "}
                <span className="text-fg">`h2.post-title`</span> · 53 rage clicks · 31 sessions
                {"\n"}
                {"  - Source: "}
                <span className="text-ok">`app/posts/[slug]/page.tsx`</span>
                {"\n\n"}
                <span className="text-fg">**D1.**</span> The byline grey fails on paper.
                {"\n"}
                {"  - Evidence: `#a8a29e` on `#ffffff` at 13px (2.6:1)"}
                {"\n"}
                {"  - Where it renders: `#a8a29e` — 212 uses as text on 7 pages (pictured on /posts/the-slow-web)"}
                {"\n"}
                {"  - Suggested fix: Use `#57534e` for captions (7.4:1)."}
                {"\n"}
                <span className="text-fg-4">…</span>
                {"\n\n"}
                <span className="text-fg-3">
                  Finish with a fenced JSON verdict block, one entry for each of A1, A2, D1 …
                </span>
              </pre>

              <div className="border-t border-line px-4 py-4 sm:px-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className={eyebrowCls}>Paste verdicts</span>
                  <span className="text-[12px] text-fg-3">3 of 7 answered</span>
                </div>
                <ul className="space-y-2">
                  {VERDICTS.map((v) => (
                    <li key={v.id} className="flex gap-2 text-[12.5px] leading-snug text-fg-2">
                      <span className="w-7 shrink-0 font-mono text-[12px] text-fg-3">{v.id}</span>
                      <span className="w-[4.5rem] shrink-0 text-fg-3">{v.verdict}</span>
                      <span className="min-w-0">
                        {v.issue}
                        <span className="mt-0.5 block text-[12px] text-fg-3">{v.note}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3">
                  <PrimaryBtn>Ignore 2 findings</PrimaryBtn>
                </div>
              </div>
            </div>

          </div>
        </div>

        <p className="r mt-6 max-w-[68ch] text-[13px] leading-[1.35] text-fg-3" style={delay(180)}>
          A citation that isn&apos;t in the data is thrown away before anything is filed. Marking a
          finding fixed tells the model it was fixed, and on which day, so data from before the fix
          doesn&apos;t bring it back. A pasted verdict only ever matches the finding it was given.
        </p>
      </Wrap>
    </section>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/** Where an actionable came from, drawn the way its tab is in the rail. */
function SourceMark({ source, className = "" }: { source: Source; className?: string }) {
  return source === "analytics" ? (
    <span className={`inline-flex text-bad ${className}`}>
      <ChartIcon size={13} />
    </span>
  ) : (
    <span className={`inline-flex text-blue ${className}`}>
      <DropletIcon size={13} />
    </span>
  );
}

function ActionableRow({ row }: { row: Row }) {
  const rowCls = "border-t border-line px-4 py-4 first:border-t-0 sm:px-5";

  if (row.dismissed) {
    const { fixed, reason } = row.dismissed;
    return (
      <li className={`${rowCls} flex flex-col text-[13px] leading-snug text-fg-3`}>
        <div className="flex gap-3">
          <span aria-hidden className={`mt-[3px] inline-flex shrink-0 ${fixed ? "text-ok" : "text-fg-4"}`}>
            {fixed ? <CheckIcon size={13} /> : <SourceMark source={row.source} className="opacity-60" />}
          </span>
          <span className="line-through decoration-fg-4">{row.title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-2.5">
          <span className="text-[12px] italic leading-snug text-fg-3">&ldquo;{reason}&rdquo;</span>
          <span className={microLink}>{fixed ? "Edit note" : "Edit reason"}</span>
          <span className={microLink}>Undo</span>
        </div>
      </li>
    );
  }

  return (
    <li className={`${rowCls} ${row.hovered ? "bg-raised/40" : ""}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-[3px] shrink-0">
          <SourceMark source={row.source} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-[14px] font-medium leading-snug text-fg ${row.hovered ? "underline underline-offset-2" : ""}`}>
            {row.title}
          </p>
          {row.status && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone={row.status.tone} className="shrink-0 whitespace-nowrap rounded-full px-2">
                {row.status.text}
              </Badge>
            </div>
          )}
          {row.issue && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[12px] leading-snug text-fg-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex items-center gap-0.5 font-medium text-fg-2">
                  #{row.issue.number} on GitHub
                  <ArrowUpRightIcon size={11} />
                </span>
                <span aria-hidden>·</span>
              </span>
              <span>{row.issue.meta}</span>
            </p>
          )}
        </div>
        {row.pictured && <BylinePicture />}
        <span className="shrink-0 text-fg-3">
          <ChevronRightIcon size={15} />
        </span>
      </div>

      {/* The verdicts, revealed on hover: two quiet, File bug last as the one
          that produces something. */}
      {row.hovered && (
        <div className="flex flex-wrap items-center gap-2 pl-[1.125rem] pt-3">
          <GhostBtn>Mark fixed</GhostBtn>
          <GhostBtn>Ignore</GhostBtn>
          <PrimaryBtn>File bug</PrimaryBtn>
        </div>
      )}
    </li>
  );
}

/**
 * The value's picture, as the snapshot crops it: the element carrying the
 * flagged grey, ringed, with its surroundings — a post's headline and the
 * byline under it.
 */
function BylinePicture() {
  return (
    <span
      aria-hidden
      className="hidden h-14 w-[5.5rem] shrink-0 flex-col justify-center gap-1 overflow-hidden rounded-md border border-line bg-white px-2 sm:flex"
    >
      <span className="block h-[5px] w-[85%] rounded-[1px] bg-[#1c1917]" />
      <span className="block h-[5px] w-[60%] rounded-[1px] bg-[#1c1917]" />
      <span className="mt-0.5 block w-fit rounded-[2px] p-[2px] ring-[1.5px] ring-[#fbbf24]">
        <span className="block h-[3px] w-9 rounded-[1px] bg-[#a8a29e]" />
      </span>
      <span className="block h-[2px] w-[90%] rounded-[1px] bg-[#d6d3d1]" />
    </span>
  );
}

/** The Overview's one action, as a split button: copy the prompt, the rest of the loop behind the chevron. */
function FixPromptButton({ count }: { count: number }) {
  return (
    <span className="inline-flex shrink-0">
      <PrimaryBtn className="rounded-r-none">
        <CopyIcon size={13} />
        Copy fix prompt
        <span className="ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-accent-fg/12 px-1 text-[11px] font-semibold tabular-nums text-accent-fg/75">
          {count}
        </span>
      </PrimaryBtn>
      <PrimaryBtn className="rounded-l-none border-l border-accent-fg/15 px-2">
        <ChevronDownIcon size={13} />
      </PrimaryBtn>
    </span>
  );
}

