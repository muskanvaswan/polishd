/**
 * Polishd — script provenance: whose code actually threw.
 *
 * Pattern-matching error messages is guesswork that ages badly: every new
 * extension brings a new string, and the list only ever grows. There is a
 * better question the browser can answer directly — *did this document ever
 * fetch that script?*
 *
 * Resource Timing records every resource the page loaded, including the
 * lazily-imported chunks and CDN scripts added long after parse. Extension
 * code is not in it: the browser injects content scripts, the document never
 * requested them. So a stack frame pointing at a URL absent from that set is
 * code the site did not ship — whatever it happens to be called this month.
 *
 * That gives four verdicts instead of a yes/no, which matters because the
 * honest answer is sometimes "can't tell":
 *
 *   site       every frame is code this document loaded — a real bug
 *   extension  a frame names an extension URL scheme — never the site's
 *   foreign    a frame names a script the document never fetched — injected
 *   unknown    nothing attributable (opaque cross-origin, empty stack)
 *
 * Only `extension` is confident enough to drop. `foreign` and `unknown` are
 * kept and labeled, because a filter that silently eats what it can't identify
 * is how a real bug goes missing.
 */
import { isExtensionUrl } from "../shared/error-noise";

export type ErrorOrigin = "site" | "extension" | "foreign" | "unknown";

/** Every script URL this document is known to have fetched itself. */
const loadedScripts = new Set<string>();

let observing = false;

/** Drop the `:line:col` suffix and any trailing bracket a stack frame carries. */
function bareUrl(raw: string): string {
  return raw.replace(/[)\]]+$/, "").replace(/:\d+(?::\d+)?$/, "");
}

function record(entry: PerformanceEntry): void {
  const e = entry as PerformanceResourceTiming;
  // `script` covers <script src> and dynamic import(); `link` covers modulepreload.
  // Anything else on the page can't be the thing that threw.
  if (e.initiatorType !== "script" && e.initiatorType !== "link") return;
  loadedScripts.add(bareUrl(e.name));
}

/**
 * Begin recording which scripts this document loads.
 *
 * Called at init, which on Next runs before hydration — but `buffered: true`
 * means even the entries from before this point are replayed, so a script that
 * loaded during parse is still counted.
 */
export function startScriptProvenance(): void {
  if (observing || typeof PerformanceObserver === "undefined") return;
  observing = true;
  try {
    for (const entry of performance.getEntriesByType("resource")) record(entry);
    // The resource buffer is finite (250 entries by default) and a busy page
    // can overflow it, so we keep our own set rather than re-reading it later.
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record(entry);
    }).observe({ type: "resource", buffered: true });
  } catch {
    // No Resource Timing: every verdict below degrades to same-origin checks,
    // which still separates injected code from the site's own.
    observing = false;
  }
}

/**
 * True when `url` is code this page is responsible for.
 *
 * Three ways to qualify, in descending confidence: the document fetched it,
 * it shares the page's origin (covers inline scripts, which blame the document
 * URL), or it's a blob the page itself minted — `blob:` inherits its creator's
 * origin, so an extension's blob reads as `blob:chrome-extension://…` and
 * correctly fails this test.
 */
function isOurScript(url: string): boolean {
  if (loadedScripts.has(url)) return true;
  if (isExtensionUrl(url)) return false;
  try {
    const origin = location.origin;
    if (url.startsWith(`blob:${origin}`)) return true;
    return new URL(url, location.href).origin === origin;
  } catch {
    return false;
  }
}

// Stack formats differ per engine, so rather than parse frames, pull out
// anything shaped like an absolute URL and classify each one.
const URL_IN_STACK = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s)'"]+/g;

/**
 * Decide who owns an error, from the script URLs it can be attributed to.
 *
 * `source` is the browser's own blame (`ErrorEvent.filename`); `stack` is
 * searched too because injected code frequently presents with the page as its
 * top frame and the extension only further down — which is exactly how a
 * wallet's "failed to connect" surfaces.
 */
export function errorOrigin(source: string | undefined, stack: string | undefined): ErrorOrigin {
  const urls: string[] = [];
  if (source) urls.push(bareUrl(source));
  if (stack) for (const match of stack.match(URL_IN_STACK) ?? []) urls.push(bareUrl(match));

  if (urls.length === 0) return "unknown";
  if (urls.some(isExtensionUrl)) return "extension";
  // Every frame has to be ours for this to be the site's bug. One frame the
  // document never loaded means something else is on the stack — a third-party
  // script that qualifies (the page fetched it) still reads as "site", which is
  // right: you shipped it.
  return urls.every(isOurScript) ? "site" : "foreign";
}

/** Test seam: forget everything recorded so far. */
export function resetScriptProvenance(): void {
  loadedScripts.clear();
  observing = false;
}
