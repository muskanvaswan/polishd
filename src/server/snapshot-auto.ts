/**
 * Polishd — whether site snapshots are taken on their own, and how the last
 * try went (server only).
 *
 * By default a site that has allowed the screenshot service is captured once
 * a week in the background (snapshot-background.ts). The owner can turn that
 * off on the Design tab; `POLISHD_SNAPSHOT_AUTO=off` turns it off for the
 * deployment and takes the switch away. This is the small record both sides
 * read: the dashboard to show the switch, the ingest route to decide whether
 * a capture is due.
 *
 * It lives in the store rather than `polishd.defaults.json` because the
 * route that acts on it never loads that file — the dashboard page does.
 */
import { getMeta, setMeta } from "./store";

export type SnapshotAutoMode = "weekly" | "off";

/** What the store keeps. Every field is optional: nothing is written until something happens. */
export interface SnapshotAutoState {
  /** The owner's choice on the Design tab. Unset: the default, weekly. */
  mode?: SnapshotAutoMode;
  /** When a background capture was last asked for, whether or not it came back. */
  lastAttemptAt?: number;
  /** When one last finished and joined the gallery. */
  lastFinishedAt?: number;
  /** Why the last one didn't, or ended early. Cleared by the next attempt. */
  lastError?: string;
}

/** What the dashboard is told. */
export interface SnapshotAuto {
  mode: SnapshotAutoMode;
  /** True when the environment decides, so the dashboard has no switch to offer. */
  locked: boolean;
  lastFinishedAt: number | null;
  lastError: string | null;
}

const AUTO_KEY = "snapshot_auto";

export async function loadSnapshotAutoState(): Promise<SnapshotAutoState> {
  const raw = await getMeta(AUTO_KEY);
  if (!raw) return {};
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...(p.mode === "weekly" || p.mode === "off" ? { mode: p.mode } : {}),
      ...(typeof p.lastAttemptAt === "number" ? { lastAttemptAt: p.lastAttemptAt } : {}),
      ...(typeof p.lastFinishedAt === "number" ? { lastFinishedAt: p.lastFinishedAt } : {}),
      ...(typeof p.lastError === "string" && p.lastError ? { lastError: p.lastError.slice(0, 300) } : {}),
    };
  } catch {
    return {};
  }
}

export async function saveSnapshotAutoState(state: SnapshotAutoState): Promise<boolean> {
  return setMeta(AUTO_KEY, JSON.stringify(state));
}

/** The deployment's own answer, when it has one. */
function envMode(env: string | undefined): SnapshotAutoMode | null {
  const value = env?.trim().toLowerCase();
  if (value === "off" || value === "false" || value === "0") return "off";
  if (value === "weekly") return "weekly";
  return null;
}

/** The mode in force: the environment's, else the owner's, else weekly. */
export function resolveSnapshotAuto(
  state: SnapshotAutoState,
  env: string | undefined = process.env.POLISHD_SNAPSHOT_AUTO,
): SnapshotAuto {
  const fromEnv = envMode(env);
  return {
    mode: fromEnv ?? state.mode ?? "weekly",
    locked: fromEnv !== null,
    lastFinishedAt: state.lastFinishedAt ?? null,
    lastError: state.lastError ?? null,
  };
}

/** Record the owner's choice, keeping what's known about past attempts. */
export async function saveSnapshotAutoMode(mode: SnapshotAutoMode): Promise<SnapshotAuto | null> {
  const next = { ...(await loadSnapshotAutoState()), mode };
  return (await saveSnapshotAutoState(next)) ? resolveSnapshotAuto(next) : null;
}
