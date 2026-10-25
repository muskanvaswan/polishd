"use client";

/**
 * Polishd — ignoring a finding: the summary's losses and the design review's
 * issues, as the actionable list shows them.
 *
 * Ignoring asks once — a small dialog with an optional reason — and happens
 * on its second Ignore, so a stray click on a row can't dismiss a finding. A
 * reason is worth giving: it's replayed to the model on every later run, so
 * "the second CTA is deliberate" stops the same finding coming back in
 * different words. It can be added or edited afterwards from the struck-out
 * row, which is all the "ignored" a row needs to say. Marking a finding fixed
 * is the same verdict with a different reason — done, the site changed —
 * stored and shown the same way, with a check for its mark.
 *
 * The dismissal is stored server-side immediately; the row stays put, struck
 * through with an undo, and only disappears on the next render. A dismissal
 * recorded elsewhere — from a coding agent's verdict block on the Overview —
 * arrives as `adopted`, and the row shows it the same way. `useDismissal` is
 * the hook form of the same state, for a component that owns one finding; the
 * actionable list drives the same shape from list-level state instead.
 */
import { useEffect, useState, useTransition, type ReactNode } from "react";

import type { IgnoreLossResult, PolishdIgnoredLoss, UnignoreLossResult } from "../ai/types";
import { CheckIcon, XIcon, microBtn } from "./ui";

/** The verdict buttons on a finding share their style with the shared microBtn. */
export const microLink =
  "text-[11px] font-medium text-fg-3 underline decoration-fg-4 underline-offset-2 transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";

/** A server action that threw: the token cookie expired, or the network dropped. */
export const UNREACHABLE = "Couldn't reach the server — reload the page and try again.";

export interface Dismissal {
  ignored: PolishdIgnoredLoss | null;
  pending: boolean;
  error: string | null;
  /** Dismiss, or re-save the reason; `fixed` marks it fixed rather than not a problem. */
  ignore: (reason?: string, fixed?: boolean) => void;
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
  dismiss: (reason?: string, fixed?: boolean) => Promise<IgnoreLossResult>;
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
  const ignore = (reason?: string, fixed?: boolean) =>
    start(async () => {
      setError(null);
      try {
        const res = await dismiss(reason, fixed);
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

/**
 * The "Ignore" button on a live finding. `onPress` is what a click does —
 * open the confirming dialog, where the list has one; the dismissal itself
 * otherwise.
 */
export function IgnoreButton({
  state,
  dataComponent,
  title,
  className = microBtn,
  onPress,
}: {
  state: Dismissal;
  dataComponent: string;
  title: string;
  /** The button's classes — a micro button by default. */
  className?: string;
  onPress?: () => void;
}) {
  return (
    <>
      <button
        type="button"
        data-component={dataComponent}
        onClick={onPress ?? (() => state.ignore())}
        disabled={state.pending}
        title={title}
        className={className}
      >
        {state.pending ? "Ignoring…" : "Ignore"}
      </button>
      {state.error && <span className="text-[12px] text-bad">{state.error}</span>}
    </>
  );
}

/**
 * A finding after it was ignored: struck through — which says "ignored" on
 * its own — with its reason in quiet text when one was given, and the two
 * follow-ups: give or edit the reason, or undo. `componentPrefix` names the
 * buttons for the dashboard's own telemetry (`actionable-ignore-reason`…).
 */
export function DismissedCard({
  issue,
  state,
  componentPrefix,
  readBy,
  noun,
  className,
  marker,
}: {
  issue: string;
  state: Dismissal;
  componentPrefix: string;
  /** What reads the reason: "summary" or "review". */
  readBy: string;
  /** What's being ignored, for the reason field's label: "loss", "issue". */
  noun: string;
  /** The `<li>`'s classes: the list row's, struck-out text included. */
  className: string;
  /** What leads the row — the finding's source icon, where the list has one; an ✕ otherwise. */
  marker?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ignored = state.ignored!;
  const fixed = ignored.fixed === true;

  // A saved reason replaces the entry; that's what closes the form. A failed
  // save leaves it open, with the error beside it.
  useEffect(() => setEditing(false), [ignored]);

  return (
    <li className={className}>
      <div className="flex gap-3">
        {/* Muted, like the text: the strike-through is what says ignored. A
            fix gets a check instead, which is the one thing that tells the two
            apart. */}
        <span aria-hidden className={`mt-[3px] inline-flex shrink-0 ${fixed ? "text-ok" : "text-fg-4"}`}>
          {fixed ? <CheckIcon size={13} /> : (marker ?? <XIcon size={13} />)}
        </span>
        <span className="line-through decoration-fg-4">{issue}</span>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-2.5">
        {!editing && ignored.reason && (
          <span className="text-[12px] italic leading-snug text-fg-3">&ldquo;{ignored.reason}&rdquo;</span>
        )}
        {editing ? (
          <ReasonForm
            draft={draft}
            setDraft={setDraft}
            pending={state.pending}
            label={fixed ? `What changed for this ${noun}` : `Reason for ignoring this ${noun}`}
            placeholder={fixed ? "What changed?" : "Why isn't this a problem?"}
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
              title={
                fixed
                  ? `Tell the model what changed — it reads this on every later ${readBy}`
                  : `Tell the model why this isn't a problem — it reads this on every later ${readBy}`
              }
              className={microLink}
            >
              {ignored.reason ? (fixed ? "Edit note" : "Edit reason") : fixed ? "Add a note" : "Add a reason"}
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
        {state.error && <span className="text-[11px] text-bad">{state.error}</span>}
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
  placeholder,
  onSubmit,
  onCancel,
}: {
  draft: string;
  setDraft: (v: string) => void;
  pending: boolean;
  label: string;
  placeholder: string;
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
        placeholder={placeholder}
        aria-label={label}
        className="h-7 w-full rounded-md border border-line-strong bg-canvas px-2 text-[12px] text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
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
