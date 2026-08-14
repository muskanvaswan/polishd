/**
 * Polishd — dogfood telemetry state (server only).
 *
 * Polishd can report anonymous usage of its *own dashboard* back to the
 * polishd project, so the dashboard is improved by the same signals it
 * preaches. This module owns everything about whether that happens:
 *
 *   • Consent, stored in `polishd_meta` — asked once on the dashboard, opt-in,
 *     nothing is ever sent before the owner says yes.
 *   • The install id — a random UUID minted on first grant, meaning nothing
 *     and stable per installation, so the collecting side can tell
 *     installations apart without identifying anyone.
 *   • The endpoint — the polishd site's `@polishd/next/telemetry` route,
 *     overridable for testing via `POLISHD_TELEMETRY_ENDPOINT`.
 *   • The kill switch — `POLISHD_TELEMETRY=off` (or 0/false/no) disables the
 *     whole feature, banner included, regardless of stored consent.
 *
 * What gets sent is decided by the emitter (`dashboard/telemetry.tsx`), and is
 * only ever dashboard interaction — never the host site's analytics, never
 * its visitors' events.
 */
import { getMeta, setMeta, storeReady } from "./store";

/**
 * Where telemetry lands: the polishd landing site's own installation. One
 * constant on purpose — when the site moves to a real domain, this is the
 * single line to change.
 */
export const DEFAULT_TELEMETRY_ENDPOINT =
  "https://polishd-lac.vercel.app/api/polishd-telemetry";

const CONSENT_KEY = "telemetry_consent";
const INSTALL_ID_KEY = "install_id";

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
  /** Set only when status is "granted" — the emitter needs it, nobody else. */
  installId: string | null;
  endpoint: string;
}

export function telemetryDisabledByEnv(): boolean {
  const v = process.env.POLISHD_TELEMETRY;
  return v !== undefined && /^(0|false|off|no)$/i.test(v.trim());
}

export function resolveTelemetryEndpoint(): string {
  return process.env.POLISHD_TELEMETRY_ENDPOINT || DEFAULT_TELEMETRY_ENDPOINT;
}

/**
 * The stable anonymous id of this installation, minted on first use. Returns
 * null when the store can't persist it — an id that changes every restart
 * would be worse than none, inflating the install count on the other end.
 */
async function getInstallId(): Promise<string | null> {
  const existing = await getMeta(INSTALL_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  return (await setMeta(INSTALL_ID_KEY, id)) ? id : null;
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
  const off: PolishdTelemetryState = { status: "disabled", installId: null, endpoint };
  if (telemetryDisabledByEnv()) return off;
  // Without a writable store there is nowhere to keep the answer, so asking
  // would mean asking on every single render. Stay quiet instead.
  if (!(await storeReady())) return off;

  const raw = await getMeta(CONSENT_KEY);
  if (!raw) return { status: "unset", installId: null, endpoint };
  try {
    const parsed = JSON.parse(raw) as { status?: unknown };
    if (parsed.status === "granted") {
      const installId = await getInstallId();
      return installId
        ? { status: "granted", installId, endpoint }
        : off;
    }
    if (parsed.status === "denied") return { status: "denied", installId: null, endpoint };
  } catch {
    // Unreadable record — treat as never asked rather than silently sending.
  }
  return { status: "unset", installId: null, endpoint };
}
