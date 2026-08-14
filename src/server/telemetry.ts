/**
 * Polishd — dogfood telemetry state (server only).
 *
 * Polishd can report anonymous usage of its *own dashboard* back to the
 * polishd project, so the dashboard is improved by the same signals it
 * preaches. This module owns everything about whether that happens:
 *
 *   • Consent, stored in `polishd_meta` — asked once on the dashboard, opt-in,
 *     nothing is ever sent before the owner says yes.
 *   • The endpoint — the polishd site's `@polishd/next/telemetry` route,
 *     overridable for testing via `POLISHD_TELEMETRY_ENDPOINT`.
 *   • The kill switch — `POLISHD_TELEMETRY=off` (or 0/false/no) disables the
 *     whole feature, banner included, regardless of stored consent.
 *
 * The installation carries no id of its own: the collecting side names it by
 * the hostname in the request's Origin header, which the browser sets and the
 * consent prompt discloses. What gets sent is decided by the emitter
 * (`dashboard/telemetry.tsx`), and is only ever dashboard interaction — never
 * the host site's analytics, never its visitors' events.
 */
import { getMeta, setMeta, storeReady } from "./store";

/** Where telemetry lands: the polishd site's own installation. */
export const DEFAULT_TELEMETRY_ENDPOINT =
  "https://polishd.muskanvaswan.xyz/api/polishd-telemetry";

const CONSENT_KEY = "telemetry_consent";

export type PolishdTelemetryStatus =
  /** Owner said yes; the emitter runs. */
  | "granted"
  /** Owner said no; nothing runs, nothing asks again. */
  | "denied"
  /** Never asked — the dashboard shows the consent prompt. */
  | "unset"
  /** Env kill switch, or no writable store to keep consent in. */
  | "disabled";

export interface PolishdTelemetryState {
  status: PolishdTelemetryStatus;
  endpoint: string;
}

export function telemetryDisabledByEnv(): boolean {
  const v = process.env.POLISHD_TELEMETRY;
  return v !== undefined && /^(0|false|off|no)$/i.test(v.trim());
}

export function resolveTelemetryEndpoint(): string {
  return process.env.POLISHD_TELEMETRY_ENDPOINT || DEFAULT_TELEMETRY_ENDPOINT;
}

/** Record the owner's decision. Overwrites any previous one. */
export async function saveTelemetryConsent(granted: boolean): Promise<void> {
  await setMeta(
    CONSENT_KEY,
    JSON.stringify({ status: granted ? "granted" : "denied", at: Date.now() }),
  );
}

/** What the dashboard should do about telemetry on this render. */
export async function loadPolishdTelemetryState(): Promise<PolishdTelemetryState> {
  const endpoint = resolveTelemetryEndpoint();
  if (telemetryDisabledByEnv()) return { status: "disabled", endpoint };
  // Without a writable store there is nowhere to keep the answer, so asking
  // would mean asking on every single render. Stay quiet instead.
  if (!(await storeReady())) return { status: "disabled", endpoint };

  const raw = await getMeta(CONSENT_KEY);
  if (!raw) return { status: "unset", endpoint };
  try {
    const parsed = JSON.parse(raw) as { status?: unknown };
    if (parsed.status === "granted") return { status: "granted", endpoint };
    if (parsed.status === "denied") return { status: "denied", endpoint };
  } catch {
    // Unreadable record — treat as never asked rather than silently sending.
  }
  return { status: "unset", endpoint };
}
