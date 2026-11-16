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
 * policy is denied. That includes an app which deletes `app/polishd/page.tsx`
 * while keeping the package installed — the actions remain routable but now
 * always deny, which is the right outcome and a confusing one to debug, so it
 * is called out in the docs.
 */
import { cookies, headers } from "next/headers";

/**
 * What an `authenticate` callback is handed.
 *
 * Without this a callback has to reach for `cookies()`/`headers()` itself,
 * which couples it to Next's request-scoped storage and makes it awkward to
 * unit test — you can only exercise it inside a request. Taking the request
 * state as an argument instead makes the callback an ordinary function of its
 * inputs, so a test can pass whatever it likes.
 *
 * Resolved once per check and shared between the page render and the action
 * guard, so both see exactly the same request.
 */
export interface PolishdAuthContext {
  cookies: Awaited<ReturnType<typeof cookies>>;
  headers: Awaited<ReturnType<typeof headers>>;
}

/**
 * A host's access check. The context argument is optional in practice — a
 * zero-argument callback is assignable here and keeps working unchanged.
 */
export type PolishdAuthenticate = (ctx: PolishdAuthContext) => boolean | Promise<boolean>;

/** Build the context handed to `authenticate`. */
export async function polishdAuthContext(): Promise<PolishdAuthContext> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return { cookies: c, headers: h };
}

/**
 * Whether a caller who may *see* the dashboard may also *change* it. `true`
 * makes it read-only for everyone; a callback decides per request, the same
 * way `authenticate` does — e.g. read-only unless the owner has signed in.
 */
export type PolishdReadOnly = boolean | PolishdAuthenticate;

export type PolishdAuthPolicy =
  /** Deliberately public: dev, or an explicit `POLISHD_DASHBOARD_PUBLIC=true`. */
  | { mode: "open"; readOnly?: PolishdReadOnly }
  /** `createPolishdPage({ authenticate })` — re-checked per action call. */
  | { mode: "guarded"; authenticate: PolishdAuthenticate; readOnly?: PolishdReadOnly }
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
 * Thrown when a read-only caller invokes an action that changes something.
 * The dashboard doesn't offer those actions in read-only mode, so reaching
 * this means a direct call, a stale page, or a host check that changed its
 * answer between render and click.
 */
export class PolishdReadOnlyError extends PolishdUnauthorizedError {
  constructor() {
    super();
    this.message = "[polishd] read-only";
    this.name = "PolishdReadOnlyError";
  }
}

/**
 * Resolve a read-only setting for one request. A callback that throws counts
 * as read-only: failing towards "can't change anything" is the safe side.
 */
export async function resolvePolishdReadOnly(
  readOnly: PolishdReadOnly | undefined,
  ctx?: PolishdAuthContext,
): Promise<boolean> {
  if (readOnly === undefined || readOnly === false) return false;
  if (readOnly === true) return true;
  try {
    return (await readOnly(ctx ?? (await polishdAuthContext()))) === true;
  } catch (err) {
    console.warn(
      "[polishd] readOnly() threw, treating the dashboard as read-only:",
      err instanceof Error ? err.message : err,
    );
    return true;
  }
}

/**
 * What an action does, for the read-only check. `read` actions only fetch
 * what the dashboard already shows (a snapshot image, a fix's status), so a
 * read-only viewer may still call them; everything else changes settings,
 * writes to the store or GitHub, or spends the model key.
 */
export type PolishdActionAccess = "read" | "write";

/**
 * Authorize the current server-action request, or throw. A callback that
 * itself throws is treated as a denial — an auth helper blowing up must never
 * open the gate. Actions are writes unless they say otherwise.
 */
export async function requirePolishdAuth(access: PolishdActionAccess = "write"): Promise<void> {
  await requireAccess();
  if (access === "write" && policy && policy.mode !== "setup-required") {
    if (await resolvePolishdReadOnly(policy.readOnly)) throw new PolishdReadOnlyError();
  }
}

/**
 * Whether the current request may only read. Server components use it to
 * skip work that writes or spends the key on a viewer's page load. False when
 * no policy is registered (no dashboard page) or access isn't decided yet.
 */
export async function isPolishdReadOnly(ctx?: PolishdAuthContext): Promise<boolean> {
  if (!policy || policy.mode === "setup-required") return false;
  return resolvePolishdReadOnly(policy.readOnly, ctx);
}

async function requireAccess(): Promise<void> {
  // No dashboard page registered a policy in this runtime: deny rather than
  // guess. Reaching an action without the page module loaded is not a flow the
  // dashboard produces.
  if (!policy) throw new PolishdUnauthorizedError();
  if (policy.mode === "setup-required") throw new PolishdUnauthorizedError();
  if (policy.mode === "open") return;

  let ok = false;
  try {
    ok = await policy.authenticate(await polishdAuthContext());
  } catch (err) {
    console.warn(
      "[polishd] authenticate() threw during an action call, denying:",
      err instanceof Error ? err.message : err,
    );
    ok = false;
  }
  if (!ok) throw new PolishdUnauthorizedError();
}
