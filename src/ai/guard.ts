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
  /** `createPolishdPage()` with no `authenticate` — deliberately public. */
  | { mode: "open" }
  /** `createPolishdPage({ authenticate })` — re-checked per action call. */
  | { mode: "guarded"; authenticate: () => boolean | Promise<boolean> };

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
