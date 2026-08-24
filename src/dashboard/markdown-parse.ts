/**
 * Polishd — a small GitHub-flavored-markdown parser (pure, no dependencies).
 *
 * The Issues tab shows issue bodies that are real markdown: polishd writes
 * them (`issueBody` in `src/ai/issues.ts` emits headings, bold, code, link
 * lists, blockquotes) and humans edit them on GitHub afterwards. Rendering
 * that as a raw `<pre>` wastes the structure — but the package's rule is zero
 * runtime dependencies, so `react-markdown` and friends are off the table.
 *
 * This module is the answer: a bounded, hand-written parser for the subset of
 * GFM that actually appears in issues — headings, paragraphs, fenced code,
 * blockquotes, ordered/unordered/task lists (nested), tables, rules, and the
 * inline set (bold, italic, strikethrough, code, links, images, autolinks).
 * One GitHub-ism matters: inside a paragraph a single newline is a hard
 * break, the way issue comments render. Anything the parser doesn't
 * recognize degrades to plain paragraph text — never a crash, never dropped
 * content.
 *
 * Parsing is kept apart from rendering (`markdown.tsx`) so the grammar can be
 * pinned down by plain node:test files with no React in sight.
 */

// ── AST ──────────────────────────────────────────────────────────────────────

export type MdInline =
  | { kind: "text"; text: string }
  | { kind: "break" }
  | { kind: "code"; text: string }
  | { kind: "strong"; children: MdInline[] }
  | { kind: "em"; children: MdInline[] }
  | { kind: "del"; children: MdInline[] }
  | { kind: "link"; href: string; children: MdInline[] }
  | { kind: "image"; alt: string; src: string };

export interface MdListItem {
  /** Set only on task-list items: `- [x]` / `- [ ]`. */
  checked?: boolean;
  children: MdInline[];
  /** A nested list, when the item has deeper-indented list lines under it. */
  sub?: MdList;
}

export interface MdList {
  ordered: boolean;
  items: MdListItem[];
}

export type MdBlock =
  | { kind: "heading"; level: number; children: MdInline[] }
  | { kind: "paragraph"; children: MdInline[] }
  | { kind: "codeBlock"; lang: string; text: string }
  | { kind: "quote"; children: MdBlock[] }
  | { kind: "list"; list: MdList }
  | { kind: "rule" }
  | { kind: "table"; header: MdInline[][]; rows: MdInline[][][] };

// ── Inline parsing ───────────────────────────────────────────────────────────

type InlineMatch = { index: number; length: number; node: MdInline };

/**
 * Ordered by precedence for ties at the same index: code spans protect their
 * contents from everything else, images must beat links (shared `[` syntax),
 * and `**strong**` must beat `*em*`.
 */
const INLINE_RULES: { re: RegExp; make: (m: RegExpExecArray) => MdInline }[] = [
  { re: /`([^`\n]+)`/, make: (m) => ({ kind: "code", text: m[1] }) },
  {
    re: /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/,
    make: (m) => ({ kind: "image", alt: m[1], src: m[2] }),
  },
  {
    re: /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/,
    make: (m) => ({ kind: "link", href: m[2], children: parseInline(m[1]) }),
  },
  {
    re: /\*\*((?:[^*\n]|\*(?!\*))+)\*\*/,
    make: (m) => ({ kind: "strong", children: parseInline(m[1]) }),
  },
  {
    re: /__((?:[^_\n]|_(?!_))+)__/,
    make: (m) => ({ kind: "strong", children: parseInline(m[1]) }),
  },
  { re: /\*([^*\n]+)\*/, make: (m) => ({ kind: "em", children: parseInline(m[1]) }) },
  {
    re: /(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/,
    make: (m) => ({ kind: "em", children: parseInline(m[1]) }),
  },
  { re: /~~([^~\n]+)~~/, make: (m) => ({ kind: "del", children: parseInline(m[1]) }) },
  {
    re: /https?:\/\/[^\s<>]*[^\s<>.,;:!?)'"`]/,
    make: (m) => ({ kind: "link", href: m[0], children: [{ kind: "text", text: m[0] }] }),
  },
];

/** Plain text, with each newline becoming a hard break (GitHub issue style). */
function pushText(out: MdInline[], text: string): void {
  if (!text) return;
  const parts = text.split("\n");
  parts.forEach((part, i) => {
    if (i > 0) out.push({ kind: "break" });
    if (part) out.push({ kind: "text", text: part });
  });
}

/** Parse one run of inline markdown into a token list. */
export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let rest = text;
  while (rest.length > 0) {
    let best: InlineMatch | null = null;
    for (const rule of INLINE_RULES) {
      const m = rule.re.exec(rest);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, length: m[0].length, node: rule.make(m) };
      }
    }
    if (!best) {
      pushText(out, rest);
      break;
    }
    pushText(out, rest.slice(0, best.index));
    out.push(best.node);
    rest = rest.slice(best.index + best.length);
  }
  return out;
}

// ── Block parsing ────────────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_RE = /^ {0,3}(```|~~~)\s*(\S*)\s*$/;
const QUOTE_RE = /^ {0,3}>\s?(.*)$/;
const LIST_RE = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/;
/** The `| --- | :--: |` row that promotes the line above it to a table header. */
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/** Does this line begin a block of its own, ending any open paragraph? */
function startsBlock(line: string): boolean {
  return (
    HEADING_RE.test(line) ||
    RULE_RE.test(line) ||
    FENCE_RE.test(line) ||
    QUOTE_RE.test(line) ||
    LIST_RE.test(line)
  );
}

/** `| a | b |` → ["a", "b"]. Outer pipes optional, cells trimmed. */
function splitCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

/** One list line, pre-chewed for the indent-driven tree build. */
type ListRow = { indent: number; ordered: boolean; text: string };

/** Fold rows into (possibly nested) items — deeper indent means a sublist. */
function buildList(rows: ListRow[], pos: { i: number }, level: number): MdList {
  const ordered = rows[pos.i].ordered;
  const items: MdListItem[] = [];
  while (pos.i < rows.length) {
    const row = rows[pos.i];
    if (row.indent < level) break;
    if (row.indent > level) {
      const sub = buildList(rows, pos, row.indent);
      if (items.length > 0) items[items.length - 1].sub = sub;
      else items.push({ children: [], sub });
      continue;
    }
    pos.i += 1;
    let text = row.text;
    let checked: boolean | undefined;
    const task = text.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      checked = task[1] !== " ";
      text = task[2];
    }
    items.push({ checked, children: parseInline(text) });
  }
  return { ordered, items };
}

/** Parse a whole markdown document into blocks. */
export function parseMarkdown(md: string): MdBlock[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i += 1;
      continue;
    }

    // Fenced code — verbatim until the closing fence (or the end of input).
    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // past the closing fence, harmless at end of input
      blocks.push({ kind: "codeBlock", lang: fence[2], text: body.join("\n") });
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        children: parseInline(heading[2]),
      });
      i += 1;
      continue;
    }

    if (RULE_RE.test(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    // Blockquote — strip the markers and parse the inside as its own document.
    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        inner.push((lines[i].match(QUOTE_RE) as RegExpMatchArray)[1]);
        i += 1;
      }
      blocks.push({ kind: "quote", children: parseMarkdown(inner.join("\n")) });
      continue;
    }

    // Table — a pipe row whose next line is the `---|---` separator.
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes("|")) {
      const header = splitCells(line).map(parseInline);
      i += 2;
      const rows: MdInline[][][] = [];
      while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) {
        rows.push(splitCells(lines[i]).map(parseInline));
        i += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    // List — collect the run of list lines (plus indented continuations),
    // then fold it into a tree by indent.
    if (LIST_RE.test(line)) {
      const rows: ListRow[] = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_RE);
        if (m) {
          rows.push({ indent: m[1].length, ordered: m[3] !== undefined, text: m[4] });
          i += 1;
          continue;
        }
        // A deeper-indented plain line continues the previous item's text.
        if (rows.length > 0 && /^\s{2,}\S/.test(lines[i])) {
          rows[rows.length - 1].text += `\n${lines[i].trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: "list", list: buildList(rows, { i: 0 }, rows[0].indent) });
      continue;
    }

    // Paragraph — everything up to a blank line or the start of another block.
    const para: string[] = [line];
    i += 1;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) {
      // A `---|---` line would turn the next line into a table header, not us.
      if (lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) break;
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "paragraph", children: parseInline(para.join("\n")) });
  }

  return blocks;
}
