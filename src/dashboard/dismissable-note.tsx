"use client";

/**
 * Polishd — a note that can be put away once read. The choice is kept in this
 * browser (localStorage), so it stays gone on later visits; nothing is stored
 * server-side. Renders nothing until the saved choice has been read, so a
 * dismissed note never flashes back in.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Callout, XIcon } from "./ui";

const PREFIX = "polishd:dismissed:";

export default function DismissableNote({
  id,
  tone,
  className = "",
  children,
}: {
  id: string;
  tone: "warn" | "bad" | "info" | "ok" | "neutral";
  className?: string;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    try {
      setShown(window.localStorage.getItem(PREFIX + id) !== "1");
    } catch {
      setShown(true);
    }
  }, [id]);

  if (!shown) return null;

  const dismiss = () => {
    setShown(false);
    try {
      window.localStorage.setItem(PREFIX + id, "1");
    } catch {
      /* storage blocked — hidden for this visit only */
    }
  };

  return (
    <div className={`relative ${className}`}>
      <Callout tone={tone} className="pr-10">
        {children}
      </Callout>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        title="Got it — don't show again"
        className="absolute right-3 top-3 rounded-md p-1 text-fg-3 hover:bg-raised hover:text-fg"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}
