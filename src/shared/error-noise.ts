/**
 * Polishd — browser-extension error noise.
 *
 * A page's `error` and `unhandledrejection` handlers hear everything that
 * throws in the tab, not just the site's own code. Extensions inject scripts
 * into the page context, and when they fail — a wallet that can't reach its
 * background worker, a content script whose port closed on navigation — the
 * throw surfaces on `window` exactly like a real bug would. "Failed to connect
 * to MetaMask" is the canonical one: nothing on the site can cause it, nothing
 * on the site can fix it, and left unfiltered it can be the loudest error the
 * dashboard shows.
 *
 * These are pure predicates, shared rather than client-local, so the browser
 * capture layer and the ingest endpoint apply the same rule — a cached bundle
 * can lag a config change by a full session, so the server keeps its own copy
 * of the decision (the same reasoning as the dashboard-path exclusion).
 */

/**
 * URL schemes that only ever belong to an extension or the browser itself.
 * If the failing script came from one of these, the site did not load it.
 */
const EXTENSION_SCHEMES = [
  "chrome-extension://",
  "moz-extension://",
  "safari-extension://",
  "safari-web-extension://",
  "ms-browser-extension://",
  "extension://", // unknown vendors, and the bare form some builds report
  "webkit-masked-url://", // Safari's opaque stand-in for injected scripts
  "resource://", // Firefox internals and legacy add-ons
  "chrome://", // browser-internal pages and resources
];

/**
 * Messages produced by extension plumbing running *in page context*, where the
 * filename is the page's own URL and the scheme check above can't help.
 *
 * Deliberately narrow: each of these is a string the extension messaging layer
 * itself emits, not something a site's code would produce. Broad matching here
 * (say, anything mentioning MetaMask) would swallow a dapp's genuine wallet
 * errors, which are real bugs worth seeing.
 */
const EXTENSION_MESSAGE_PATTERNS: RegExp[] = [
  /failed to connect to metamask/i,
  /could not establish connection\.\s*receiving end does not exist/i,
  /the message port closed before a response was received/i,
  /extension context invalidated/i,
  /^chrome\.runtime\b/i,
];

/**
 * The browser's placeholder for an error thrown by a cross-origin script it
 * won't describe: no message, no file, no line. Extensions and third-party
 * embeds are the usual sources, and either way there is nothing here to act
 * on — the event is a report that *something* failed, with every detail
 * stripped.
 */
function isOpaqueError(message: string, source: string): boolean {
  return /^script error\.?$/i.test(message.trim()) && !source;
}

/** True when `url` was served by an extension or the browser, not the site. */
export function isExtensionUrl(url: string): boolean {
  // `blob:` and `filesystem:` wrap the origin that minted them, so an
  // extension's blob reads as `blob:chrome-extension://…` — unwrap before
  // testing the scheme, or code an extension generated at runtime slips past.
  const u = url.trim().toLowerCase().replace(/^(?:blob|filesystem):/, "");
  if (!u) return false;
  return EXTENSION_SCHEMES.some((scheme) => u.startsWith(scheme));
}

/** The shape of an error, reduced to what both the client and ingest can see. */
export interface ErrorSignature {
  /** The thrown message, already stringified. */
  message: string;
  /** The failing script's URL, if the browser gave one. */
  source?: string;
  /** The stack, when available. Only the client has this. */
  stack?: string;
  /** Extra ignore patterns from the host app's config. */
  ignore?: readonly (string | RegExp)[];
}

/**
 * True when this error is noise the site's owner cannot act on.
 *
 * Checked in order of confidence: where the script came from, then what the
 * stack blames, then the small set of messages extension messaging emits, then
 * the opaque cross-origin case, then whatever the host app chose to ignore.
 */
export function isIgnorableError({ message, source = "", stack = "", ignore }: ErrorSignature): boolean {
  if (isExtensionUrl(source)) return true;
  // A stack is a list of frames, not a single URL, so this looks anywhere in
  // it: injected code often has the page as its top frame and the extension
  // further down.
  const lowerStack = stack.toLowerCase();
  if (lowerStack && EXTENSION_SCHEMES.some((scheme) => lowerStack.includes(scheme))) return true;
  if (EXTENSION_MESSAGE_PATTERNS.some((re) => re.test(message))) return true;
  if (isOpaqueError(message, source)) return true;
  if (ignore?.length) {
    for (const pattern of ignore) {
      if (typeof pattern === "string") {
        if (pattern && message.toLowerCase().includes(pattern.toLowerCase())) return true;
      } else if (pattern.test(message)) return true;
    }
  }
  return false;
}
