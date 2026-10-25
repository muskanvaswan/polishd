/**
 * Polishd — a tolerant reader for GitHub workflow files (pure).
 *
 * The Fix dispatch card needs a handful of facts out of `.github/workflows/*`:
 * which events a workflow listens for, which action a step uses, the inputs
 * it passes, and the job's `if:` condition. The package ships with no runtime
 * dependencies and that isn't worth a YAML library, so this is a line-based
 * reader of the subset workflow files are actually written in — nested
 * mappings, block and flow sequences, quoted and plain scalars, and `|` / `>`
 * block scalars (the `if:` condition in the stock workflow is one).
 *
 * It is tolerant on purpose: a line it doesn't understand becomes a string or
 * is skipped, never an exception. The analysis over the result treats
 * anything missing as "couldn't tell", which is what a hand-edited workflow
 * deserves — a guess dressed up as a verdict is how a setup card sends
 * someone off to fix the wrong thing. Anchors, aliases, tags and multi-line
 * flow collections are out of scope.
 */

export type YamlishValue = string | null | YamlishValue[] | YamlishMap;
export interface YamlishMap {
  [key: string]: YamlishValue;
}

interface Line {
  indent: number;
  /** The line with leading and trailing whitespace removed. */
  text: string;
  /** Empty, a comment, or a document marker: skipped by the structure walk. */
  blank: boolean;
  raw: string;
}

/** Parse one workflow file. Returns null for an empty document. */
export function parseWorkflowYaml(text: string): YamlishValue {
  const lines = toLines(text);
  return parseBlock(lines, 0, lines.length);
}

function toLines(text: string): Line[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map((raw) => {
    const expanded = raw.replace(/\t/g, "  ");
    const trimmedStart = expanded.replace(/^\s+/, "");
    const content = trimmedStart.replace(/\s+$/, "");
    return {
      indent: expanded.length - trimmedStart.length,
      text: content,
      blank: content.length === 0 || content.startsWith("#") || content === "---" || content === "...",
      raw,
    };
  });
}

function isSeqItem(text: string): boolean {
  return text === "-" || text.startsWith("- ");
}

function firstContent(lines: Line[], from: number, end: number): number {
  let i = from;
  while (i < end && lines[i].blank) i++;
  return i;
}

/** Parse the block of lines [start, end) as whatever its first line says it is. */
function parseBlock(lines: Line[], start: number, end: number): YamlishValue {
  const i0 = firstContent(lines, start, end);
  if (i0 >= end) return null;
  const base = lines[i0].indent;
  if (isSeqItem(lines[i0].text)) return parseSequence(lines, i0, end, base);
  if (splitKey(lines[i0].text)) return parseMapping(lines, i0, end, base);
  // A bare scalar (a sequence item's value, say), possibly folded over lines.
  const parts: string[] = [];
  for (let i = i0; i < end; i++) if (!lines[i].blank) parts.push(lines[i].text);
  return parseInline(parts.join(" "));
}

function parseSequence(lines: Line[], start: number, end: number, base: number): YamlishValue[] {
  const out: YamlishValue[] = [];
  let i = start;
  while (i < end) {
    const line = lines[i];
    if (line.blank || line.indent !== base || !isSeqItem(line.text)) {
      i++; // a stray line at the wrong depth: tolerate by ignoring it
      continue;
    }
    let j = i + 1;
    while (j < end && (lines[j].blank || lines[j].indent > base)) j++;
    const rest = line.text.slice(1);
    const content = rest.replace(/^\s+/, "");
    if (content === "") {
      out.push(parseBlock(lines, i + 1, j));
    } else {
      // "- key: value" opens a mapping whose other keys sit under the text
      // after the dash: re-read the item as if the dash were indentation.
      const virtual: Line = {
        indent: base + 1 + (rest.length - content.length),
        text: content,
        blank: false,
        raw: line.raw,
      };
      const sub = [virtual, ...lines.slice(i + 1, j)];
      out.push(parseBlock(sub, 0, sub.length));
    }
    i = j;
  }
  return out;
}

function parseMapping(lines: Line[], start: number, end: number, base: number): YamlishMap {
  const map: YamlishMap = {};
  let i = start;
  while (i < end) {
    const line = lines[i];
    if (line.blank || line.indent !== base) {
      i++;
      continue;
    }
    const kv = splitKey(line.text);
    if (!kv) {
      i++;
      continue;
    }
    const { key, rest } = kv;
    // The key's value runs over every deeper line — and, when the key has no
    // inline value, over a sequence written at the key's own depth, which
    // YAML allows ("steps:" followed by "- uses:" in the same column).
    let j = i + 1;
    while (
      j < end &&
      (lines[j].blank ||
        lines[j].indent > base ||
        (rest === "" && lines[j].indent === base && isSeqItem(lines[j].text)))
    ) {
      j++;
    }
    if (rest === "") {
      map[key] = parseBlock(lines, i + 1, j);
    } else if (/^[|>][+-]?\d*$/.test(stripComment(rest).trim())) {
      map[key] = blockScalar(lines, i + 1, j, stripComment(rest).trim());
    } else {
      // A plain scalar may continue on deeper lines, folded with spaces.
      const parts = [rest];
      for (let k = i + 1; k < j; k++) if (!lines[k].blank) parts.push(lines[k].text);
      map[key] = parseInline(parts.join(" "));
    }
    i = j;
  }
  return map;
}

const KEY_RE = /^(?:"([^"]*)"|'([^']*)'|([^"'\s#][^:]*?))\s*:(?:\s+(.*)|$)/;

/** "key: rest" → both parts, or null when the line isn't a mapping entry. */
function splitKey(text: string): { key: string; rest: string } | null {
  const m = KEY_RE.exec(text);
  if (!m) return null;
  const key = m[1] ?? m[2] ?? m[3];
  if (key === undefined || key.trim() === "") return null;
  return { key: key.trim(), rest: (m[4] ?? "").trim() };
}

/** Drop a trailing " # comment" that isn't inside quotes. */
function stripComment(s: string): string {
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i);
    }
  }
  return s;
}

/** Split "a, b, c" at the commas that aren't inside quotes or brackets. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "[" || ch === "{") {
      depth++;
      cur += ch;
    } else if (ch === "]" || ch === "}") {
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== "") out.push(cur);
  return out.map((p) => p.trim()).filter((p) => p !== "");
}

function unquote(s: string): string | null {
  const t = s.trim();
  if (t === "" || t === "~" || t === "null") return null;
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

/** One inline value: a flow sequence, a flow mapping, or a scalar. */
function parseInline(raw: string): YamlishValue {
  const s = stripComment(raw).trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    return splitTopLevel(s.slice(1, -1)).map((p) => parseInline(p));
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    const map: YamlishMap = {};
    for (const part of splitTopLevel(s.slice(1, -1))) {
      const kv = splitKey(part);
      if (kv) map[kv.key] = parseInline(kv.rest);
      else map[part] = null;
    }
    return map;
  }
  return unquote(s);
}

/** A `|` or `>` block: the deeper lines that follow, with their indent removed. */
function blockScalar(lines: Line[], start: number, end: number, indicator: string): string {
  const body = lines.slice(start, end);
  let min = Infinity;
  for (const l of body) if (l.text !== "") min = Math.min(min, l.indent);
  if (!Number.isFinite(min)) return "";
  const rows = body.map((l) => (l.raw.replace(/\t/g, "  ").trim() === "" ? "" : l.raw.replace(/\t/g, "  ").slice(min)));
  while (rows.length && rows[rows.length - 1] === "") rows.pop();
  const text = indicator.startsWith(">")
    ? rows
        .map((r) => r.trim())
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .trim()
    : rows.join("\n");
  return indicator.includes("+") ? `${text}\n` : text;
}

// ── Helpers for reading the parsed tree ──────────────────────────────────────

export function asMap(v: YamlishValue | undefined): YamlishMap | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
}

export function asList(v: YamlishValue | undefined): YamlishValue[] | null {
  return Array.isArray(v) ? v : null;
}

export function asString(v: YamlishValue | undefined): string | null {
  return typeof v === "string" ? v : null;
}
