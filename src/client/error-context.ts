/**
 * Polishd — what a `js_error` needs beyond its message to be diagnosable.
 *
 * A message, a source URL and a line number name an error but rarely place
 * it: a production bundle is one line long, and Next replaces the message of
 * every Server Components failure with the same sentence. Three more facts
 * close most of that gap, each small enough to ride on every error:
 *
 *   digest   Next's `error.digest`, the key that matches a redacted production
 *            error to the full one in the server's logs.
 *   frame    the top stack frame as `file:line:col`, which in a minified
 *            bundle is the column that actually places the throw.
 *   after    the click within the last two seconds, if any: its
 *            `data-component`, else its label, else its selector — with
 *            `afterMs`, how long before the error it was, and `afterSelector`
 *            when `after` is a name rather than the selector itself.
 *   handle   a greppable path to the element involved (target.ts
 *            `handleOf`): the element that failed to load, else the one
 *            clicked just before.
 *
 * `afterMs` is rounded to the nearest 100ms. The recent-errors query groups
 * rows by their whole `meta`, and an exact delay would make every occurrence
 * of the same error a group of its own; to the tenth of a second it still
 * tells a throw inside the click handler (0) from one after a fetch (300).
 *
 * Every key is optional — absent when there's nothing to say — so older
 * events, which have none of them, read the same. Every value is capped well
 * inside ingest's per-value limit (500 chars). Import-free so `node --test`
 * can load it directly.
 */

/** A click older than this before the error is not what caused it. */
export const ERROR_INTERACTION_WINDOW_MS = 2000;

const MAX_DIGEST_LEN = 120;
const MAX_FRAME_LEN = 200;
const MAX_SELECTOR_LEN = 300;
const MAX_AFTER_LEN = 120;
const MAX_HANDLE_LEN = 200;

/** The last click the capture layer saw. */
export interface InteractionLike {
  ts: number;
  component?: string;
  label?: string;
  selector?: string;
  /** Its handle, computed on demand — only an error needs one. */
  handle?: () => string | undefined;
}

/** Where a throw happened when the error carries no stack, and what failed. */
export interface ErrorLocation {
  source?: string;
  line?: number;
  col?: number;
  /** Handle of the element whose load failed, for a resource error. */
  handle?: string;
}

/**
 * `file:line:col` in a frame, with the file an absolute URL or a path. It must
 * start the line or follow a space, `(` or `@`, so a Firefox function name
 * like `Foo/<` isn't read as a path; inside the file, `@` and parentheses are
 * allowed (`node_modules_@scope_pkg.js`, `webpack-internal:///(app-pages-browser)/…`).
 */
const FRAME_LOCATION = /(?:^|[\s(@])((?:[a-zA-Z][a-zA-Z0-9+.-]*:\/{2,3}|\/)\S*?):(\d+):(\d+)/;

/**
 * Shorten a frame's file: drop the scheme and host (every frame shares them)
 * and any query or hash (cache busters). Past the cap, keep the end — the
 * file name is the part that identifies the chunk.
 */
const trimFrame = (file: string, line: string | number, col: string | number): string => {
  // `scheme://host` — `file:///` and `webpack-internal:///` have an empty host.
  const path = file.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/, "").replace(/[?#].*$/, "");
  const frame = `${path || file}:${line}:${col}`;
  return frame.length > MAX_FRAME_LEN ? `…${frame.slice(-(MAX_FRAME_LEN - 1))}` : frame;
};

/**
 * The top frame of a stack, as `file:line:col`. Handles V8 (`    at fn (url)`),
 * Firefox and Safari (`fn@url`); the message line V8 puts first is skipped,
 * since a message can contain a URL of its own.
 */
export function topStackFrame(stack: unknown): string | undefined {
  if (typeof stack !== "string") return undefined;
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    if (!/^at\s/.test(line) && !line.includes("@") && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\//.test(line)) {
      continue;
    }
    const m = FRAME_LOCATION.exec(line);
    if (m) return trimFrame(m[1], m[2], m[3]);
  }
  return undefined;
}

/** Next's `digest` on a thrown or rejected value, when it has one. */
export function errorDigest(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const digest = (value as { digest?: unknown }).digest;
  return typeof digest === "string" && digest ? digest.slice(0, MAX_DIGEST_LEN) : undefined;
}

export interface ErrorContext {
  digest?: string;
  frame?: string;
  after?: string;
  afterMs?: number;
  afterSelector?: string;
  handle?: string;
}

/**
 * The extra `meta` keys for a `js_error`: digest, top frame, and the click
 * that preceded it. `value` is the thrown error or rejection reason; `at` is
 * the browser's own blame, used for the frame when there's no stack (a
 * cross-origin "Script error." has neither). Never throws: it runs inside the
 * error listener, and a throw there would lose the error being reported.
 */
export function errorContextMeta(
  value: unknown,
  last: InteractionLike | null,
  now: number,
  at: ErrorLocation = {},
): ErrorContext {
  const meta: ErrorContext = {};
  try {
    const digest = errorDigest(value);
    if (digest) meta.digest = digest;

    const stack = value && typeof value === "object" ? (value as { stack?: unknown }).stack : undefined;
    const frame =
      topStackFrame(stack) ?? (at.source ? trimFrame(at.source, at.line ?? 0, at.col ?? 0) : undefined);
    if (frame) meta.frame = frame;

    const ago = last ? now - last.ts : -1;
    const after = last && (last.component || last.label || last.selector);
    if (last && after && ago >= 0 && ago <= ERROR_INTERACTION_WINDOW_MS) {
      meta.after = after.slice(0, MAX_AFTER_LEN);
      meta.afterMs = Math.round(ago / 100) * 100;
      if (last.selector && last.selector !== after) {
        meta.afterSelector = last.selector.slice(0, MAX_SELECTOR_LEN);
      }
    }

    const handle = at.handle ?? (meta.after && last?.handle ? last.handle() : undefined);
    if (handle) meta.handle = handle.slice(0, MAX_HANDLE_LEN);
  } catch {
    /* an exotic thrown value: report the error without its context */
  }
  return meta;
}
