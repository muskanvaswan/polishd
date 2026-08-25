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

export type PolishdAuthPolicy =
  /** Deliberately public: dev, or an explicit `POLISHD_DASHBOARD_PUBLIC=true`. */
  | { mode: "open" }
  /** `createPolishdPage({ authenticate })` — re-checked per action call. */
  | { mode: "guarded"; authenticate: PolishdAuthenticate }
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
 * The policy the environment alone determines, for runtimes where no page
 * module has registered one. On a serverless host that is a normal state, not
 * a broken flow: an action POST can be served by a fresh instance that loads
 * the action's module without ever evaluating the host's `page.tsx`, so
 * waiting for `createPolishdPage()` to register would deny the dashboard's
 * own legitimate calls. Everything the built-in modes need is in the
 * environment — the token gate reads `POLISHD_DASHBOARD_TOKEN` and a cookie,
 * and the public opt-out is an env var — so this derives exactly what
 * `resolvePolicy()` would have registered for them. A host's custom
 * `authenticate` callback is code and cannot be derived; without a token
 * alongside it, a production instance in this state still fails closed.
 */
async function envPolicy(): Promise<PolishdAuthPolicy> {
  const { polishdDashboardToken, polishdTokenAuth } = await import(
    "../dashboard/token-auth"
  );
  if (polishdDashboardToken()) {
    return { mode: "guarded", authenticate: polishdTokenAuth() };
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.POLISHD_DASHBOARD_PUBLIC !== "true"
  ) {
    return { mode: "setup-required" };
  }
  return { mode: "open" };
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
  // A registered policy wins — it may carry the host's own `authenticate`.
  // Without one (a fresh serverless instance serving an action POST before
  // anything evaluated the host's page module), fall back to what the
  // environment alone determines. See `envPolicy`.
  const effective = policy ?? (await envPolicy());
  if (effective.mode === "setup-required") throw new PolishdUnauthorizedError();
  if (effective.mode === "open") return;

  let ok = false;
  try {
    ok = await effective.authenticate(await polishdAuthContext());
  } catch (err) {
    console.warn(
      "[polishd] authenticate() threw during an action call, denying:",
      err instanceof Error ? err.message : err,
    );
    ok = false;
  }
  if (!ok) throw new PolishdUnauthorizedError();
}
