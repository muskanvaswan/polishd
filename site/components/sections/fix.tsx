import type { ReactNode } from "react";

import {
  ArrowUpRightIcon,
  ChartIcon,
  CheckIcon,
  ChevronRightIcon,
  RunIcon,
  StepDoneIcon,
} from "@/components/dash/icons";
import {
  Badge,
  StatusPill,
  cardHeader,
  cardTitleCls,
  eyebrowCls,
  type Tone,
} from "@/components/dash/ui";
import { Eyebrow, Heading, StatusChip, Sub, Wrap } from "@/components/ui";

/**
 * The fix pipeline: a filed issue handed to the coding agent the repo
 * already runs, and followed to a pull request linked to it.
 *
 * Create fix on an actionable labels its GitHub issue and comments a brief
 * that opens with the trigger phrase. That comment is what starts the repo's
 * own Claude Code workflow on GitHub Actions — polishd runs nothing itself.
 * The agent scopes the issue, confirms it's real and that one focused pull
 * request can fix it, stopping at the first that fails; otherwise it pushes
 * a branch. Create PR opens the pull request from it with `Fixes #N` first,
 * and the agent's verdict is read back onto the row.
 *
 * Told three ways: the handoffs in order, with the tag the row carries after
 * each and the stretch that runs on Actions bracketed; the run as GitHub
 * Actions shows it, over the workflow that hears the comment; and the
 * actionable's drawer once the pull request is open.
 *
 * The issue is the Safari narration bug from the Actionables section, #42,
 * carried through. Values are illustrative; the wording is the dashboard's.
 */

const ISSUE = 42;
const PR = 43;
const OWNER = "fieldnote";
const BRANCH = "claude/issue-42-20261025-1803";

type Hop = {
  who: string;
  /** Runs on the repo's own GitHub Actions. */
  actions?: boolean;
  title: string;
  body: ReactNode;
  /** The tag the actionable's row carries once this step is done. */
  tag: { text: string; tone: Tone };
};

const HOPS: Hop[] = [
  {
    who: "Polishd",
    title: "Create fix",
    body: (
      <>
        Labels the issue and comments the brief, opening with <Code>@claude</Code>.
      </>
    ),
    tag: { text: "fix requested", tone: "info" },
  },
  {
    who: "GitHub Actions",
    actions: true,
    title: "The comment starts a run",
    body: (
      <>
        Your <Code>claude.yml</Code> hears <Code>issue_comment</Code> and runs the Claude Code
        Action on your runners.
      </>
    ),
    tag: { text: "agent working", tone: "info" },
  },
  {
    who: "GitHub Actions",
    actions: true,
    title: "Scope, confirm, fix",
    body: <>Claude checks the bug is real and fits one pull request, then pushes a branch.</>,
    tag: { text: "fix ready", tone: "ok" },
  },
  {
    who: "Polishd",
    title: "Create PR",
    body: (
      <>
        Opens the pull request from that branch, <Code>Fixes #{ISSUE}</Code> first. Only when you
        click.
      </>
    ),
    tag: { text: "PR open", tone: "ok" },
  },
  {
    who: "You",
    title: "Review and merge",
    body: <>Merging closes #{ISSUE} on GitHub, and the row reads it back.</>,
    tag: { text: "fix merged", tone: "violet" },
  },
];

/** The job, as the run page lists it. */
const STEPS: { name: string; uses?: string; time: string; brief?: boolean }[] = [
  { name: "Set up job", time: "2s" },
  { name: "Checkout repository", uses: "actions/checkout@v4", time: "1s" },
  { name: "Run Claude Code", uses: "anthropics/claude-code-action@v1", time: "6m 4s", brief: true },
  { name: "Complete job", time: "0s" },
];

/** The brief's four steps, as the agent worked them. */
const BRIEF: { step: string; note: ReactNode }[] = [
  { step: "Scope it", note: <Code>components/narration-button.tsx</Code> },
  { step: "Confirm it's real", note: <>play() runs on mount, before any tap</> },
  { step: "Check it's feasible", note: <>one file, no new dependencies</> },
  {
    step: "Fix it",
    note: (
      <>
        pushed <Code>{BRANCH}</Code>
      </>
    ),
  },
];

/** What happened on the issue, newest first — the drawer's Activity on GitHub. */
const ACTIVITY: { who: string; did: ReactNode; badge?: { text: string; tone: Tone }; at: string; text?: string }[] = [
  { who: OWNER, did: <>linked pull request #{PR}</>, at: "3m ago" },
  {
    who: "claude",
    did: "commented",
    badge: { text: "agent", tone: "info" },
    at: "31m ago",
    text: `Claude finished @${OWNER}'s task in 6m 4s — View job · ${BRANCH} · Create PR ➔`,
  },
  {
    who: OWNER,
    did: "asked for a fix",
    badge: { text: "polishd", tone: "neutral" },
    at: "38m ago",
    text: `@claude polishd is asking you to fix #${ISSUE} — but only once you've confirmed it's real and can be fixed in one focused pull request.`,
  },
  {
    who: OWNER,
    did: (
      <>
        added <Chip>polishd-fix</Chip>
      </>
    ),
    at: "38m ago",
  },
];

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

export default function Fix() {
  return (
    <section id="fix" className="py-[76px] md:py-28">
      <Wrap>
        <Eyebrow>Just landed · fixes</Eyebrow>
        <Heading>
          Issue in, PR out.
          <br />
          <span className="text-fg-4">On the GitHub Actions you already&nbsp;run.</span>
        </Heading>
        <Sub>
          Create fix hands a filed issue to the coding agent your repo already runs — the Claude
          Code GitHub Action. It scopes the bug, proves it&apos;s real and pushes a fix; Polishd
          opens the pull request, linked to the issue, and reads the agent&apos;s verdict back onto
          the row.
        </Sub>

        {/* The handoffs, in order. */}
        <div className="r lift mt-[34px]">
          {/* Steps 02–03 bracketed: the part that runs on the repo's own Actions. */}
          <div className="hidden grid-cols-5 lg:grid" aria-hidden>
            <div className="col-span-2 col-start-2 px-4">
              <div className="flex items-center justify-center gap-1.5 pb-2 font-chart text-[12px] font-medium text-fg-2">
                <RunIcon size={13} />
                Runs on your repo&apos;s GitHub Actions
              </div>
              <div className="h-3 rounded-t-lg border-x border-t border-fg-4" />
            </div>
          </div>

          <div className="card font-chart overflow-hidden text-fg">
            <div className={cardHeader}>
              <span className={cardTitleCls}>Create fix, end to end</span>
              <div className="flex items-center gap-3">
                <span className="hidden text-[12px] text-fg-3 md:inline">
                  The tag on the row after each step
                </span>
                <StatusChip status="live" />
              </div>
            </div>

            <ol className="grid grid-cols-1 divide-y divide-line lg:grid-cols-5 lg:divide-x lg:divide-y-0">
              {HOPS.map((hop, i) => (
                <li
                  key={hop.title}
                  className={`relative flex flex-col gap-2 px-4 py-4 sm:px-5 lg:px-4 ${hop.actions ? "bg-raised/50" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-fg-3">0{i + 1}</span>
                    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-fg-2">
                      {hop.actions && <RunIcon size={12} />}
                      {hop.who}
                    </span>
                  </div>
                  <h3 className="text-[14px] font-semibold leading-snug text-fg">{hop.title}</h3>
                  <p className="text-[12.5px] leading-relaxed text-fg-3">{hop.body}</p>
                  <div className="mt-auto pt-1.5">
                    <Badge tone={hop.tag.tone} className="whitespace-nowrap rounded-full px-2">
                      {hop.tag.text}
                    </Badge>
                  </div>

                  {/* The handoff to the next step, on the hairline between them. */}
                  {i < HOPS.length - 1 && (
                    <span
                      aria-hidden
                      className="absolute top-1/2 -right-[9px] z-1 hidden h-[18px] w-[18px] -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-fg-3 lg:flex"
                    >
                      <ChevronRightIcon size={11} />
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* The run, on GitHub Actions, over the workflow that heard the comment. */}
          <div className="card font-chart r lift overflow-hidden text-fg" style={delay(60)}>
            <div className={cardHeader}>
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="text-fg-2">
                  <RunIcon size={15} />
                </span>
                <span className={cardTitleCls}>GitHub Actions</span>
                <Badge mono showFrom="sm">
                  claude.yml
                </Badge>
              </div>
              <StatusPill tone="ok">Success</StatusPill>
            </div>

            <div className="px-4 py-4 sm:px-5">
              <p className="text-[14px] font-medium leading-snug text-fg">
                Claude Code <span className="text-fg-3">· #{ISSUE}</span>
              </p>
              <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-fg-3">
                <span>
                  Triggered via <Code>issue_comment</Code>
                </span>
                <span>
                  {OWNER} commented on #{ISSUE}
                </span>
                <span className="tabular-nums">6m 31s</span>
              </p>
            </div>

            <div className="border-t border-line px-4 py-4 sm:px-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className={eyebrowCls}>Job · claude</span>
                <span className="font-mono text-[11px] text-fg-3">ubuntu-latest</span>
              </div>
              <ol className="space-y-3">
                {STEPS.map((s) => (
                  <li key={s.name} className="flex items-start gap-2.5">
                    <span className="mt-px text-ok">
                      <StepDoneIcon size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[13px] font-medium text-fg">{s.name}</span>
                        <span className="font-mono text-[11.5px] tabular-nums text-fg-3">{s.time}</span>
                      </div>
                      {s.uses && (
                        <div className="mt-0.5 break-all font-mono text-[11px] text-fg-3">
                          uses: <span className={s.brief ? "text-fg-2" : ""}>{s.uses}</span>
                        </div>
                      )}
                      {s.brief && (
                        <div className="mt-2.5 border-l border-line pl-3">
                          <p className="mb-1.5 text-[11.5px] text-fg-4">
                            Polishd&apos;s brief — it stops, changing nothing, at the first step
                            that fails
                          </p>
                          <ol className="space-y-1.5">
                            {BRIEF.map((b) => (
                              <li key={b.step} className="flex gap-2 text-[12.5px] leading-snug">
                                <span className="mt-[2px] text-ok">
                                  <CheckIcon size={11} />
                                </span>
                                <span className="min-w-0">
                                  <span className="text-fg-2">{b.step}</span>
                                  <span className="text-fg-3"> — {b.note}</span>
                                </span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="border-t border-line bg-sunken px-4 py-4 sm:px-5">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <span className={eyebrowCls}>The workflow it heard</span>
                <span className="text-[12px] text-fg-3">read, never written</span>
              </div>
              <pre className="overflow-x-auto rounded-lg border border-line bg-canvas px-3 py-[11px] font-mono text-[11.5px] leading-[1.7] text-fg-3">
                <span className="text-fg-4"># .github/workflows/claude.yml</span>
                {"\non:\n  "}
                <span className="text-fg">issue_comment</span>
                {":\n    types: [created]\njobs:\n  claude:\n    if: contains(github.event.comment.body, "}
                <span className="text-ok">&apos;@claude&apos;</span>
                {")\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: "}
                <span className="text-fg">anthropics/claude-code-action@v1</span>
              </pre>
            </div>
          </div>

          {/* Back on the Actionables tab: the issue's drawer, once the pull request is open. */}
          <div className="card font-chart r lift overflow-hidden text-fg" style={delay(120)}>
            <div className={cardHeader}>
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="inline-flex shrink-0 text-bad">
                  <ChartIcon size={13} />
                </span>
                <span className={`${cardTitleCls} truncate`}>The narration button throws on Safari</span>
              </div>
              <Badge tone="ok" className="shrink-0 whitespace-nowrap rounded-full px-2">
                PR open
              </Badge>
            </div>

            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-4 py-3.5 text-[12px] leading-snug text-fg-3 sm:px-5">
              <ExtLink>#{ISSUE} on GitHub</ExtLink>
              <span aria-hidden>·</span>
              <ExtLink>PR #{PR}</ExtLink>
              <span aria-hidden>·</span>
              <span>fix requested 38m ago</span>
            </p>

            <DrawerSection title="Fix and pull requests">
              <p className="text-[12.5px] leading-relaxed text-fg-2">
                Pull request <span className="text-fg underline decoration-fg-4 underline-offset-2">#{PR}</span>{" "}
                is open, opened by {OWNER}. It&apos;s linked: merging it closes this issue.
              </p>

              <div className="mt-3 rounded-lg border border-line bg-raised px-3 py-2 text-[12.5px] leading-relaxed text-fg-2">
                <span className="text-[12px] font-medium text-fg-3">Claude&apos;s verdict</span>{" "}
                <span className="font-medium text-fg">fixed</span>
                <span>
                  {" "}
                  — Narration now starts inside the tap handler; Safari rejects play() outside a
                  user gesture.
                </span>
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  <Chip mono>components/narration-button.tsx</Chip>
                  <Chip mono>components/narration-button.test.tsx</Chip>
                </span>
              </div>

              <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-line bg-canvas px-3 py-2">
                <Badge tone="ok" className="mt-px shrink-0">
                  open
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium leading-snug text-fg">
                    #{PR} fix: start narration on the first tap
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-fg-3">
                    {OWNER} · closes this issue · updated 3m ago ·{" "}
                    <span className="break-all font-mono text-[11.5px]">{BRANCH}</span>
                  </p>
                </div>
              </div>
            </DrawerSection>

            <DrawerSection title="Activity on GitHub">
              <ol className="flex flex-col gap-3">
                {ACTIVITY.map((e, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-fg-4" />
                    <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-fg-2">
                      <span className="font-medium text-fg">{e.who}</span> {e.did}
                      {e.badge && (
                        <Badge tone={e.badge.tone} className="ml-1.5 align-middle">
                          {e.badge.text}
                        </Badge>
                      )}{" "}
                      <span className="text-fg-3">· {e.at}</span>
                      {e.text && <p className="mt-0.5 line-clamp-2 break-words text-fg-3">{e.text}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </DrawerSection>
          </div>
        </div>

        <p className="r mt-6 max-w-[68ch] text-[13px] leading-[1.35] text-fg-3" style={delay(180)}>
          Polishd runs nothing itself: the agent runs in your repository, on your Actions minutes
          and your Claude plan or API key, with the token you already gave Polishd — no new
          permissions.
          Copilot&apos;s coding agent works too, assigned instead of mentioned. A bug that
          isn&apos;t real comes back as a verdict, not a diff, and nothing is written to a pull
          request without your click.
        </p>
      </Wrap>
    </section>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[11.5px] text-fg-2">{children}</code>;
}

/** A label, a path, a branch — the drawer's chip. */
function Chip({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return (
    <span
      className={`max-w-full break-all rounded-md border border-line-strong bg-raised px-1.5 py-0.5 text-[11px] font-medium text-fg-2 ${mono ? "font-mono" : ""}`}
    >
      {children}
    </span>
  );
}

/** A link out to GitHub, drawn as one. */
function ExtLink({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-0.5 font-medium text-fg-2">
      {children}
      <ArrowUpRightIcon size={11} />
    </span>
  );
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-line px-4 py-5 sm:px-5">
      <div className={`mb-3 ${eyebrowCls}`}>{title}</div>
      {children}
    </div>
  );
}
