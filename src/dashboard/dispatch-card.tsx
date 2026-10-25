"use client";

/**
 * Polishd — the Settings tab's Fix dispatch card.
 *
 * The fix loop hands filed issues to a coding agent the owner already runs on
 * the repo — Create fix on the Actionables tab (ai/fix-dispatch.ts) — and
 * follows it to a pull request linked to the issue. This card is what that
 * stands on: it says what the repo has and how a fix will start there, helps
 * set an agent up when there's none, proves the wiring with one live test,
 * and holds the owner's choices about what may be sent without asking.
 *
 * Five parts, top to bottom: the status line, what polishd found (read-only
 * rows from the pure judgement in ai/dispatch-readiness.ts), the live test,
 * the setup checklist (only when nothing was found), and the owner's choices
 * — the only editable fields, saved by the page's Save button with the rest
 * of the settings.
 *
 * The test is polled in short calls from here rather than awaited in one
 * long server action, so a page that's closed mid-test loses nothing: the
 * issue number is stored, and "Check again" picks the poll back up.
 */

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import {
  checkDispatchReadinessAction,
  pollDispatchTestAction,
  startDispatchTestAction,
} from "../ai/actions";
import {
  CLAUDE_APP_INSTALL_URL,
  CLAUDE_WORKFLOW_PATH,
  COPILOT_AGENT_DOCS_URL,
  DISPATCH_SECRET_NAME,
  DISPATCH_STATUS_LABEL,
  DISPATCH_TEST_FAILURE_CAUSES,
  actionsSecretUrl,
  copilotAgentSettingsUrl,
  isDispatchReady,
  newWorkflowFileUrl,
  recommendedWorkflow,
  type DispatchSecretChoice,
} from "../ai/dispatch-readiness";
import type {
  PolishdDispatchRow,
  PolishdDispatchState,
  PolishdDispatchStatus,
} from "../ai/types";
import {
  ArrowUpRightIcon,
  Callout,
  CheckCircleIcon,
  CheckIcon,
  Code,
  CopyIcon,
  SpinnerIcon,
  StatusPill,
  cardTitleCls,
  fieldHintCls,
  fieldLabelCls as labelCls,
  ghostBtn,
  inputCls,
  labelCls as quietLabelCls,
  primaryBtn,
  relTime,
  textLink,
  toneDot,
  type Tone,
} from "./ui";

/** How often the running test is looked at. */
const POLL_EVERY_MS = 8_000;

const STATUS_TONE: Record<PolishdDispatchStatus, Tone> = {
  "not-set-up": "neutral",
  "ready-claude": "ok",
  "ready-copilot": "ok",
  "needs-attention": "warn",
};

/** The owner's choices, as the settings form holds them before saving. */
export interface DispatchChoices {
  auto: boolean;
  label: string;
  cap: string;
  paused: boolean;
}

export interface DispatchCardProps {
  /** The connected repository, "owner/repo". */
  repo: string;
  initialState: PolishdDispatchState;
  choices: DispatchChoices;
  onChoices: (next: DispatchChoices) => void;
}

export default function DispatchCard({ repo, initialState, choices, onChoices }: DispatchCardProps) {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [testing, startTest] = useTransition();
  const [polling, startPoll] = useTransition();

  const readiness = state.readiness;
  const status = readiness?.status;
  const test = state.test;
  const running = test?.status === "running";

  const check = () => {
    if (checking) return;
    setError(null);
    startCheck(async () => {
      const res = await checkDispatchReadinessAction();
      setState(res.state);
      if (!res.ok) setError(res.message);
    });
  };

  // A repo that has never been checked is checked on arrival — one round of
  // reads, stored, so the next visit renders from the store.
  const checkedOnce = useRef(false);
  useEffect(() => {
    if (checkedOnce.current || state.checkedAt !== undefined || state.checkError) return;
    checkedOnce.current = true;
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const poll = () => {
    if (polling) return;
    startPoll(async () => {
      const res = await pollDispatchTestAction();
      setState(res.state);
      setError(res.ok ? null : res.message);
    });
  };

  // While the test runs, look at it every few seconds. The server decides
  // when it's over (reply, closed elsewhere, or the three-minute deadline),
  // so a poll that keeps coming back "running" just keeps going.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      startPoll(async () => {
        const res = await pollDispatchTestAction();
        setState(res.state);
        setError(res.ok ? null : res.message);
      });
    }, POLL_EVERY_MS);
    return () => clearInterval(timer);
  }, [running]);

  const sendTest = () => {
    if (testing || running) return;
    setError(null);
    startTest(async () => {
      const res = await startDispatchTestAction();
      setState(res.state);
      if (!res.ok) setError(res.message);
    });
  };

  return (
    <div className="space-y-6">
      {/* ── 1. Status ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {status ? (
          <StatusPill tone={STATUS_TONE[status]} live={running}>
            {DISPATCH_STATUS_LABEL[status]}
          </StatusPill>
        ) : (
          <StatusPill tone="neutral">{checking ? "Checking…" : "Not checked"}</StatusPill>
        )}
        <span className="text-[12px] text-fg-3">
          {state.checkedAt !== undefined ? `Checked ${relTime(state.checkedAt)}` : "Never checked"}
          {" · "}
          <span className="font-mono">{repo}</span>
        </span>
        <button
          type="button"
          data-component="settings-dispatch-check"
          onClick={check}
          disabled={checking}
          className={`${ghostBtn} h-7 px-2.5 text-[12px]`}
        >
          {checking ? "Checking…" : "Re-check"}
        </button>
      </div>

      {(error || state.checkError) && (
        <Callout tone="bad">
          {error ?? state.checkError}
          {readiness && " Showing the last result that worked."}
        </Callout>
      )}

      {/* ── 2. What polishd found ─────────────────────────────────────── */}
      {readiness && (
        <section>
          <h3 className={cardTitleCls}>What polishd found</h3>
          <dl className="mt-2 divide-y divide-line border-y border-line">
            {readiness.rows.map((row) => (
              <FoundRow key={row.label} row={row} />
            ))}
          </dl>
          {readiness.warnings.length > 0 && (
            <Callout tone="warn" className="mt-3">
              <ul className="list-disc space-y-1 pl-4">
                {readiness.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Callout>
          )}
        </section>
      )}

      {/* ── 3. Live test ──────────────────────────────────────────────── */}
      {readiness && readiness.plan.agent !== "none" && (
        <section className="rounded-xl border border-line bg-sunken px-3.5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px] text-fg-3">
              <span className="font-medium text-fg">Live test</span>
              {!test && (
                <span className="max-w-lg">
                  Files an issue titled &ldquo;polishd dispatch test&rdquo; the way a dispatch would,
                  waits up to three minutes for the agent to answer, then closes it.
                </span>
              )}
              {test && running && (
                <span className="inline-flex items-center gap-1.5">
                  <SpinnerIcon size={12} />
                  Waiting for a reply on <IssueLink test={test} /> · sent {relTime(test.startedAt)}
                </span>
              )}
              {test && test.status === "passed" && (
                <span className="inline-flex items-center gap-1.5 text-ok">
                  <CheckCircleIcon size={13} />
                  <span>
                    Passed — {test.replyFrom ?? "the agent"} replied in{" "}
                    {secondsBetween(test.startedAt, test.repliedAt ?? test.startedAt)}s on{" "}
                    <IssueLink test={test} />
                    {test.closedAt !== undefined ? ", closed" : ""}
                  </span>
                </span>
              )}
              {test && test.status === "failed" && (
                <span>
                  {test.reason === "closed-elsewhere"
                    ? <>Issue <IssueLink test={test} /> was closed before the agent replied.</>
                    : test.reason === "copilot-manual"
                      ? <>Couldn&apos;t assign <IssueLink test={test} /> to Copilot through the API — Copilot&apos;s test is manual: assign any issue to Copilot on GitHub to try it.</>
                      : test.reason === "unreadable"
                        ? <>Couldn&apos;t read <IssueLink test={test} /> any more.</>
                        : <>No reply on <IssueLink test={test} /> within three minutes{test.closedAt !== undefined ? "; closed" : ""}.</>}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {running && (
                <button
                  type="button"
                  onClick={poll}
                  disabled={polling}
                  className={`${ghostBtn} h-7 px-2.5 text-[12px]`}
                >
                  {polling ? "Checking…" : "Check again"}
                </button>
              )}
              {!running && (
                <button
                  type="button"
                  data-component="settings-dispatch-test"
                  onClick={sendTest}
                  disabled={testing || checking}
                  className={`${primaryBtn} h-7 px-2.5 text-[12px]`}
                >
                  {testing ? "Filing…" : test ? "Send again" : "Send test issue"}
                </button>
              )}
            </div>
          </div>
          {test?.status === "failed" && test.reason === "timeout" && (
            <div className="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed text-fg-2">
              <p className="font-medium text-fg">Likely causes, most likely first</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-fg-3">
                {DISPATCH_TEST_FAILURE_CAUSES.map((cause) => (
                  <li key={cause}>{cause}</li>
                ))}
              </ol>
            </div>
          )}
          {test?.leftOpen && (
            <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-warn">
              polishd couldn&apos;t close <IssueLink test={test} /> — close it on GitHub so it
              doesn&apos;t sit in your tracker.
            </p>
          )}
        </section>
      )}

      {/* ── 4. Setup checklist ────────────────────────────────────────── */}
      {readiness && status === "not-set-up" && (
        <SetupChecklist repo={repo} branch={readiness.plan.defaultBranch} onRecheck={check} checking={checking} />
      )}

      {/* ── 5. The owner's choices ────────────────────────────────────── */}
      <section>
        <h3 className={cardTitleCls}>Your choices</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-fg-3">
          Create fix on a filed actionable sends it to the agent. These decide what may go without
          asking, and how much. Saved with the rest of the settings.
        </p>
        <div className="mt-4 space-y-4">
          <Toggle
            checked={choices.auto}
            onChange={(auto) => onChoices({ ...choices, auto })}
            title="Send fixes automatically"
            hint="Hand each issue the source confirmed to the agent as soon as it's filed, without pressing Create fix. Unverified filings still wait for you. Off until you turn it on."
          />
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>Label added to dispatched issues</span>
              <input
                value={choices.label}
                onChange={(e) => onChoices({ ...choices, label: e.target.value })}
                placeholder="polishd-fix"
                maxLength={50}
                className={`${inputCls} mt-1.5 font-mono`}
              />
            </label>
            <label className="block">
              <span className={labelCls}>Daily cap</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={1}
                value={choices.cap}
                onChange={(e) => onChoices({ ...choices, cap: e.target.value })}
                className={`${inputCls} mt-1.5 tabular-nums`}
              />
              <span className={`mt-1.5 block ${fieldHintCls}`}>
                Fixes sent in any 24 hours, by hand or not.
              </span>
            </label>
          </div>
          <Toggle
            checked={choices.paused}
            onChange={(paused) => onChoices({ ...choices, paused })}
            title="Pause dispatch"
            hint="Keeps every choice above and sends nothing until you unpause — Create fix waits too."
          />
        </div>
      </section>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

const ROW_TONE: Record<PolishdDispatchRow["tone"], Tone> = {
  ok: "ok",
  warn: "warn",
  bad: "bad",
  neutral: "neutral",
};

function FoundRow({ row }: { row: PolishdDispatchRow }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[160px_1fr] sm:gap-4">
      <dt className={`${quietLabelCls} sm:pt-0.5`}>{row.label}</dt>
      <dd className="min-w-0">
        <span className="flex items-start gap-2 text-[13px] font-medium text-fg">
          <span aria-hidden className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[ROW_TONE[row.tone]]}`} />
          <span className="min-w-0 break-words">{row.value}</span>
        </span>
        {row.detail && (
          <span className="mt-0.5 block pl-3.5 text-[12px] leading-snug text-fg-3">{row.detail}</span>
        )}
      </dd>
    </div>
  );
}

function IssueLink({ test }: { test: { issueNumber: number; issueUrl: string } }) {
  return (
    <a href={test.issueUrl} target="_blank" rel="noreferrer noopener" className={textLink}>
      #{test.issueNumber}
    </a>
  );
}

function secondsBetween(from: number, to: number): number {
  return Math.max(1, Math.round((to - from) / 1000));
}

/** One opt-in, as a checkbox row. */
function Toggle({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  title: string;
  hint: string;
}) {
  return (
    <label className="flex max-w-xl cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--pd-accent)]"
      />
      <span>
        <span className="block text-[13px] font-medium text-fg">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-fg-3">{hint}</span>
      </span>
    </label>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={`${textLink} inline-flex items-center gap-0.5`}>
      {children}
      <ArrowUpRightIcon size={11} />
    </a>
  );
}

const SECRET_CHOICES: { value: DispatchSecretChoice; label: string; cost: string; from: ReactNode }[] = [
  {
    value: "oauth-token",
    label: "Subscription token",
    cost: "Runs draw on your Claude plan's usage limits.",
    from: (
      <>
        Create it with <Code>claude setup-token</Code>.
      </>
    ),
  },
  {
    value: "api-key",
    label: "API key",
    cost: "Metered API usage — covered by a Max or Team plan's monthly credit when your Console organization is linked.",
    from: (
      <>
        Create it in the{" "}
        <ExternalLink href="https://console.anthropic.com/settings/keys">Anthropic Console</ExternalLink>.
      </>
    ),
  },
];

/**
 * What to do when nothing was found, least effort first: the one Claude Code
 * command that does all of it; otherwise the three links; and Copilot.
 */
function SetupChecklist({
  repo,
  branch,
  onRecheck,
  checking,
}: {
  repo: string;
  branch: string;
  onRecheck: () => void;
  checking: boolean;
}) {
  const [secret, setSecret] = useState<DispatchSecretChoice>("oauth-token");
  const [copied, setCopied] = useState(false);
  const yaml = recommendedWorkflow({ secret });
  const newFileUrl = newWorkflowFileUrl({ repo, branch, yaml });
  const choice = SECRET_CHOICES.find((c) => c.value === secret)!;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* the link still works */
    }
  };

  return (
    <section>
      <h3 className={cardTitleCls}>Set up an agent</h3>
      <p className="mt-1 text-[12.5px] leading-relaxed text-fg-3">
        Least effort first. Each step needs you on GitHub — polishd&apos;s token can file issues,
        not install apps or write workflows.
      </p>
      <ol className="mt-3 space-y-4">
        <Step n={1} title="If you use Claude Code">
          <p>
            Run <Code>claude</Code> in a terminal, in the repo, then <Code>/install-github-app</Code>{" "}
            there — it&apos;s a Claude Code terminal command and won&apos;t run from this dashboard or
            the desktop app. It installs the GitHub App, adds the secret, and opens a pull request with the workflow — merge it, then
            re-check.
          </p>
          <button
            type="button"
            onClick={onRecheck}
            disabled={checking}
            className={`${ghostBtn} mt-2 h-7 px-2.5 text-[12px]`}
          >
            {checking ? "Checking…" : "Re-check"}
          </button>
        </Step>

        <Step n={2} title="Otherwise, three links">
          <ol className="space-y-3">
            <li>
              <span className="font-medium text-fg">Install the Claude GitHub App</span> on this
              repository:{" "}
              <ExternalLink href={CLAUDE_APP_INSTALL_URL}>github.com/apps/claude</ExternalLink>
            </li>
            <li>
              <span className="font-medium text-fg">Add the secret.</span> Pick how runs are billed:
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {SECRET_CHOICES.map((c) => (
                  <label
                    key={c.value}
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition-colors ${
                      secret === c.value
                        ? "border-accent/70 bg-accent/[0.07]"
                        : "border-line-strong bg-raised hover:border-fg-4"
                    }`}
                  >
                    <input
                      type="radio"
                      name="polishd-dispatch-secret"
                      value={c.value}
                      checked={secret === c.value}
                      onChange={() => setSecret(c.value)}
                      className="mt-0.5 accent-[var(--pd-accent)]"
                    />
                    <span>
                      <span className="block text-[13px] font-medium text-fg">{c.label}</span>
                      <span className="mt-0.5 block text-[12px] leading-snug text-fg-3">{c.cost}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2">
                Name it <Code>{DISPATCH_SECRET_NAME[secret]}</Code>. {choice.from}{" "}
                <ExternalLink href={actionsSecretUrl(repo)}>Add a repository secret</ExternalLink>
              </p>
            </li>
            <li>
              <span className="font-medium text-fg">Add the workflow.</span> polishd&apos;s recommended
              workflow — the stock example, with the secret you chose and a turn cap — opens prefilled
              on GitHub; press Commit there.
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <a
                  href={newFileUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={`${primaryBtn} h-7 px-2.5 text-[12px]`}
                >
                  Create {CLAUDE_WORKFLOW_PATH} on GitHub
                  <ArrowUpRightIcon size={11} />
                </a>
                <button type="button" onClick={copy} className={`${ghostBtn} h-7 px-2.5 text-[12px]`}>
                  {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                  {copied ? "Copied" : "Copy workflow"}
                </button>
              </div>
            </li>
          </ol>
        </Step>

        <Step n={3} title="Or Copilot">
          <p>
            Turn on Copilot&apos;s coding agent — &ldquo;Copilot in the cloud&rdquo;, as GitHub now
            calls it — for this repository in{" "}
            <ExternalLink href={copilotAgentSettingsUrl(repo)}>its Copilot settings</ExternalLink>{" "}
            (<ExternalLink href={COPILOT_AGENT_DOCS_URL}>GitHub&apos;s docs</ExternalLink>). polishd
            then assigns issues to it instead.
          </p>
        </Step>
      </ol>
      <p className="mt-4 text-[11.5px] leading-relaxed text-fg-3">
        polishd could open the workflow pull request itself if its token were granted Contents (write)
        and Workflows (write). It doesn&apos;t today — nothing here writes to your repository but the
        test issue.
      </p>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold tabular-nums text-fg-2 ring-1 ring-inset ring-line-strong">
        {n}
      </span>
      <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-fg-2">
        <p className="text-[13px] font-medium text-fg">{title}</p>
        <div className="mt-1 space-y-1">{children}</div>
      </div>
    </li>
  );
}

export { isDispatchReady };
