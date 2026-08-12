/**
 * Polishd — server-action authorization (server only).
 *
 * Next.js server actions are independently addressable POST endpoints: their
 * ids ship inside the public client bundle, so anyone can invoke one directly
 * with a `Next-Action` header. Gating the dashboard *page* therefore protects
 * only what renders — it does nothing for the actions behind it. Every action
 * this package exports must `await requirePolishdAuth()` before doing any work.
 *
 * `createPolishdPage()` records the host app's `authenticate` callback here when
 * the page module is evaluated, and the actions re-run it on each request. The
 * check is therefore made against the caller's own cookies every time; nothing
 * about the decision is trusted from the client.
 *
 * Fails closed: an action reached before any dashboard page has registered a
 * policy is denied.
 */

export type PolishdAuthPolicy =
  /** Deliberately public: dev, or an explicit `POLISHD_DASHBOARD_PUBLIC=true`. */
  | { mode: "open" }
  /** `createPolishdPage({ authenticate })` — re-checked per action call. */
  | { mode: "guarded"; authenticate: () => boolean | Promise<boolean> }
  /**
   * Production with no access decision made by the host at all. Denied like a
   * failed check rather than waved through.
   *
   * This mode has to exist at the *policy* level, not just as a screen the page
   * renders. The actions are independently addressable and re-check the policy
   * themselves, so a page that renders a lockout while still registering
   * `open` would leave every action — including the AI settings write, which
   * redirects the model base URL and spends the owner's key — wide open behind
   * a locked-looking door.
   */
  | { mode: "setup-required" };

let policy: PolishdAuthPolicy | null = null;

/** Record the dashboard's access policy. Called by `createPolishdPage()`. */
export function registerPolishdAuth(next: PolishdAuthPolicy): void {
  policy = next;
}

/**
 * Thrown when an action is invoked without authorization. Next replaces the
 * message with an opaque digest in production, so nothing leaks to the caller.
 */
export class PolishdUnauthorizedError extends Error {
  constructor() {
    super("[polishd] unauthorized");
    this.name = "PolishdUnauthorizedError";
  }
}

/**
 * Authorize the current server-action request, or throw. A callback that
 * itself throws is treated as a denial — an auth helper blowing up must never
 * open the gate.
 */
export async function requirePolishdAuth(): Promise<void> {
  // No dashboard page registered a policy in this runtime: deny rather than
  // guess. Reaching an action without the page module loaded is not a flow the
  // dashboard produces.
  if (!policy) throw new PolishdUnauthorizedError();
  if (policy.mode === "setup-required") throw new PolishdUnauthorizedError();
  if (policy.mode === "open") return;

  let ok = false;
  try {
    ok = await policy.authenticate();
  } catch (err) {
    console.warn(
      "[polishd] authenticate() threw during an action call, denying:",
      err instanceof Error ? err.message : err,
    );
    ok = false;
  }
  if (!ok) throw new PolishdUnauthorizedError();
}
