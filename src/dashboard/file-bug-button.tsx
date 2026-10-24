"use client";

/**
 * Polishd — the "file bug" micro-button, shared by every card that can turn a
 * model finding into a GitHub issue: the summary's losses and the design
 * review's issues.
 *
 * One click runs the caller's verify-and-file server action. The server checks
 * the report against the repository's source first: confirmed reports become
 * issues with the technical analysis and fix suggestions, disproved ones come
 * back as `not-a-bug` with the reasoning — shown here instead of a link.
 * Findings whose issue already exists (auto-filed, or filed on an earlier
 * generation) render as the link straight away via `filed`.
 */
import { useState, useTransition } from "react";

import type { CreateIssueResult } from "../ai/types";
import { ArrowUpRightIcon, Badge, IssueIcon, microBtn } from "./ui";

export interface FileBugButtonProps {
  /** The issue already filed for this finding, when known at render time. */
  filed: { url: string; number: number } | null;
  /** The verify-and-file server action for this finding. */
  file: () => Promise<CreateIssueResult>;
  /** Telemetry name for the button (see the data-component note in summary.tsx). */
  dataComponent: string;
  /** Told when this click files the issue — the Overview's prompt cites it. */
  onFiled?: (filed: { url: string; number: number }) => void;
}

export function FileBugButton({ filed, file, dataComponent, onFiled }: FileBugButtonProps) {
  const [created, setCreated] = useState(filed);
  const [failed, setFailed] = useState<{ notABug: boolean; message: string } | null>(null);
  const [pending, startFile] = useTransition();

  if (created) {
    return (
      <a
        href={created.url}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex h-6 items-center gap-1 rounded-md bg-ok/10 px-2 text-[11px] font-medium text-ok ring-1 ring-inset ring-ok/20 transition-colors hover:bg-ok/15"
      >
        <IssueIcon size={11} />
        Issue #{created.number}
        <ArrowUpRightIcon size={11} />
      </a>
    );
  }

  if (failed?.notABug) {
    return (
      <Badge tone="warn" title={failed.message}>
        Checked the source — not an actual bug: {failed.message}
      </Badge>
    );
  }

  const run = () =>
    startFile(async () => {
      setFailed(null);
      const res = await file();
      if (res.ok) {
        setCreated({ url: res.url, number: res.number });
        onFiled?.({ url: res.url, number: res.number });
      } else setFailed({ notABug: res.error === "not-a-bug", message: res.message });
    });

  return (
    <>
      <button
        type="button"
        data-component={dataComponent}
        onClick={run}
        disabled={pending}
        title="Verify this problem against the source code, then create a GitHub issue with the technical details"
        className={microBtn}
      >
        {pending ? "Verifying…" : "File bug"}
      </button>
      {failed && <span className="text-[11px] text-bad">{failed.message}</span>}
    </>
  );
}
