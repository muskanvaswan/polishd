"use client";

/**
 * Polishd — ignoring a finding, shared by every card that holds model
 * findings: the summary's losses and the design review's issues.
 *
 * Ignoring takes one click and no explanation — a reason is offered
 * afterwards, because the fast path is "this isn't a problem, stop showing me
 * it" and typing shouldn't be the toll for that. A reason is worth giving
 * though: it's replayed to the model on every later run, so "the second CTA is
 * deliberate" stops the same finding coming back in different words.
 *
 * The dismissal is stored server-side immediately; the card stays put, struck
 * through with an undo, and only disappears on the next render. A dismissal
 * recorded elsewhere — from a coding agent's verdict block on the Overview —
 * arrives as `adopted`, and the card shows it the same way.
 */
import { useEffect, useState, useTransition } from "react";

import type { IgnoreLossResult, PolishdIgnoredLoss, UnignoreLossResult } from "../ai/types";
import { railCard } from "./card-rail";
import { microBtn } from "./ui";

/** The verdict buttons on a finding share their style with the shared microBtn. */
export const microLink =
  "text-[10px] text-[#888] underline decoration-[#333] underline-offset-2 transition-colors hover:text-[#ccc] disabled:cursor-not-allowed disabled:opacity-40";

/** A server action that threw: the token cookie expired, or the network dropped. */
export const UNREACHABLE = "Couldn't reach the server — reload the page and try again.";

export interface Dismissal {
  ignored: PolishdIgnoredLoss | null;
  pending: boolean;
  error: string | null;
  ignore: (reason?: string) => void;
  undo: () => void;
}

/**
 * The ignore state of one finding. `dismiss` and `restore` are its server
 * actions; `onChange` hears every change that landed.
 */
export function useDismissal({
  dismiss,
  restore,
  onChange,
  adopted,
}: {
  dismiss: (reason?: string) => Promise<IgnoreLossResult>;
  restore: () => Promise<UnignoreLossResult>;
  onChange?: (ignored: boolean) => void;
  /** A dismissal recorded for this finding somewhere else. */
  adopted?: PolishdIgnoredLoss;
}): Dismissal {
  const [ignored, setIgnored] = useState<PolishdIgnoredLoss | null>(adopted ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (adopted) setIgnored(adopted);
  }, [adopted]);

  // A throw inside a transition is rethrown into the nearest error boundary,
  // and the dashboard has none: catch it here and say so on the card.
  const ignore = (reason?: string) =>
    start(async () => {
      setError(null);
      try {
        const res = await dismiss(reason);
        if (res.ok) {
          setIgnored(res.ignored);
          onChange?.(true);
        } else setError(res.message);
      } catch {
        setError(UNREACHABLE);
      }
    });

  const undo = () =>
    start(async () => {
      setError(null);
      try {
        const res = await restore();
        if (res.ok) {
          setIgnored(null);
          onChange?.(false);
        } else setError(res.message);
      } catch {
        setError(UNREACHABLE);
      }
    });

  return { ignored, pending, error, ignore, undo };
}

/** The "Ignore" button on a live finding. */
export function IgnoreButton({
  state,
  dataComponent,
  title,
}: {
  state: Dismissal;
  dataComponent: string;
  title: string;
}) {
  return (
    <>
      <button
        type="button"
        data-component={dataComponent}
        onClick={() => state.ignore()}
        disabled={state.pending}
        title={title}
        className={microBtn}
      >
        {state.pending ? "Ignoring…" : "Ignore"}
      </button>
      {state.error && <span className="text-[10px] text-red-400">{state.error}</span>}
    </>
  );
}

/**
 * A finding after it was ignored: struck through, with its reason, and the two
 * follow-ups — give or edit the reason, or undo. `componentPrefix` names the
 * buttons for the dashboard's own telemetry (`loss-ignore-reason`…).
 */
export function DismissedCard({
  issue,
  state,
  componentPrefix,
  readBy,
  noun,
}: {
  issue: string;
  state: Dismissal;
  componentPrefix: string;
  /** What reads the reason: "summary" or "review". */
  readBy: string;
  /** What's being ignored, for the reason field's label: "loss", "issue". */
  noun: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ignored = state.ignored!;

  // A saved reason replaces the entry; that's what closes the form. A failed
  // save leaves it open, with the error beside it.
  useEffect(() => setEditing(false), [ignored]);

  return (
    <li className={`${railCard} text-[#888]`}>
      <div className="flex gap-2">
        <span className="mt-px shrink-0 text-[#888]">✕</span>
        <span className="line-through decoration-[#3a3a3a]">{issue}</span>
      </div>
      <span className="mt-2 self-start rounded bg-[#1a1a1a] px-1.5 py-0.5 text-[10px] text-[#888]">
        Ignored{ignored.reason ? ` — ${ignored.reason}` : ""}
      </span>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
        {editing ? (
          <ReasonForm
            draft={draft}
            setDraft={setDraft}
            pending={state.pending}
            label={`Reason for ignoring this ${noun}`}
            onSubmit={() => state.ignore(draft.trim() || undefined)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <button
              type="button"
              data-component={`${componentPrefix}-ignore-reason`}
              onClick={() => {
                setDraft(ignored.reason ?? "");
                setEditing(true);
              }}
              disabled={state.pending}
              title={`Tell the model why this isn't a problem — it reads this on every later ${readBy}`}
              className={microLink}
            >
              {ignored.reason ? "Edit reason" : "Add a reason"}
            </button>
            <button
              type="button"
              data-component={`${componentPrefix}-ignore-undo`}
              onClick={state.undo}
              disabled={state.pending}
              title="Put this back — the model can report it again"
              className={microLink}
            >
              {state.pending ? "Undoing…" : "Undo"}
            </button>
          </>
        )}
        {state.error && <span className="text-[10px] text-red-400">{state.error}</span>}
      </div>
    </li>
  );
}

/** The optional half of ignoring: why it isn't a problem, in the owner's words. */
function ReasonForm({
  draft,
  setDraft,
  pending,
  label,
  onSubmit,
  onCancel,
}: {
  draft: string;
  setDraft: (v: string) => void;
  pending: boolean;
  label: string;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex w-full flex-wrap items-center gap-1.5"
    >
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        maxLength={240}
        placeholder="Why isn't this a problem?"
        aria-label={label}
        className="w-full rounded border border-[#2e2e2e] bg-[#0a0a0a] px-1.5 py-0.5 text-[10px] text-[#ddd] placeholder:text-[#888] focus:border-[#555] focus:outline-none"
      />
      <button type="submit" disabled={pending} className={microBtn}>
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onCancel} disabled={pending} className={microLink}>
        Cancel
      </button>
    </form>
  );
}
