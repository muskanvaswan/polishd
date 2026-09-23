/**
 * Tests for the issue-body markdown parser.
 *
 * Run with `npm test`. The grammar is exercised with the exact constructs
 * `issueBody()` in `src/ai/issues.ts` writes into filed issues — bold labels,
 * inline code, `##` headings, linked file lists, the inconclusive-verdict
 * blockquote, the `---` + italic footer — plus the things humans add on
 * GitHub afterwards: fenced code, tables, task lists, images, nested lists.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseInline, parseMarkdown, type MdBlock } from "./markdown-parse.ts";

function kinds(blocks: MdBlock[]): string[] {
  return blocks.map((b) => b.kind);
}

test("a filed-issue body parses into the expected block sequence", () => {
  const body = [
    "Users rage-click the pricing toggle.",
    "",
    "**Evidence (from analytics):** `PricingToggle`",
    "",
    "## Technical analysis",
    "The handler is only attached on desktop.",
    "",
    "**Verified against:**",
    "- [`src/pricing.tsx`](https://github.com/o/r/blob/main/src/pricing.tsx)",
    "",
    "---",
    "_Filed from the Polishd analytics dashboard._",
  ].join("\n");

  assert.deepEqual(kinds(parseMarkdown(body)), [
    "paragraph",
    "paragraph",
    "heading",
    "paragraph",
    "paragraph",
    "list",
    "rule",
    "paragraph",
  ]);
});

test("headings carry their level and inline content", () => {
  const [h] = parseMarkdown("## Suggested fixes");
  assert.equal(h.kind, "heading");
  if (h.kind === "heading") {
    assert.equal(h.level, 2);
    assert.deepEqual(h.children, [{ kind: "text", text: "Suggested fixes" }]);
  }
});

test("bold label followed by inline code parses in order", () => {
  const tokens = parseInline("**Evidence:** `#buy-button` on `/pricing`");
  assert.deepEqual(
    tokens.map((t) => t.kind),
    ["strong", "text", "code", "text", "code"],
  );
});

test("a linked file item nests code inside the link", () => {
  const tokens = parseInline("[`src/app/page.tsx`](https://github.com/o/r/blob/main/src/app/page.tsx)");
  assert.equal(tokens.length, 1);
  const link = tokens[0];
  assert.equal(link.kind, "link");
  if (link.kind === "link") {
    assert.equal(link.href, "https://github.com/o/r/blob/main/src/app/page.tsx");
    assert.deepEqual(link.children, [{ kind: "code", text: "src/app/page.tsx" }]);
  }
});

test("images beat links, autolinks stop before trailing punctuation", () => {
  const img = parseInline("![shot](https://x.test/a.png)")[0];
  assert.equal(img.kind, "image");

  const tokens = parseInline("see https://example.com/docs.");
  assert.equal(tokens[1].kind, "link");
  if (tokens[1].kind === "link") assert.equal(tokens[1].href, "https://example.com/docs");
  assert.deepEqual(tokens[2], { kind: "text", text: "." });
});

test("strong wins over em; underscores inside words stay literal", () => {
  assert.equal(parseInline("**bold**")[0].kind, "strong");
  assert.equal(parseInline("*em*")[0].kind, "em");
  assert.equal(parseInline("~~gone~~")[0].kind, "del");
  assert.deepEqual(parseInline("snake_case_name"), [
    { kind: "text", text: "snake_case_name" },
  ]);
});

test("single newlines inside a paragraph become hard breaks", () => {
  const [p] = parseMarkdown("line one\nline two");
  assert.equal(p.kind, "paragraph");
  if (p.kind === "paragraph") {
    assert.deepEqual(
      p.children.map((t) => t.kind),
      ["text", "break", "text"],
    );
  }
});

test("fenced code keeps its language and verbatim body", () => {
  const [b] = parseMarkdown("```ts\nconst a = 1;\n\n**not bold**\n```");
  assert.equal(b.kind, "codeBlock");
  if (b.kind === "codeBlock") {
    assert.equal(b.lang, "ts");
    assert.equal(b.text, "const a = 1;\n\n**not bold**");
  }
});

test("an unclosed fence swallows the rest instead of crashing", () => {
  const [b] = parseMarkdown("```\nno closing fence");
  assert.equal(b.kind, "codeBlock");
  if (b.kind === "codeBlock") assert.equal(b.text, "no closing fence");
});

test("blockquotes parse their inside as blocks", () => {
  const [q] = parseMarkdown("> **Note:** verification was inconclusive.\n> Second line.");
  assert.equal(q.kind, "quote");
  if (q.kind === "quote") {
    assert.equal(q.children.length, 1);
    assert.equal(q.children[0].kind, "paragraph");
  }
});

test("task lists and ordered lists carry their flags", () => {
  const [b] = parseMarkdown("- [x] done\n- [ ] todo");
  assert.equal(b.kind, "list");
  if (b.kind === "list") {
    assert.equal(b.list.ordered, false);
    assert.deepEqual(
      b.list.items.map((i) => i.checked),
      [true, false],
    );
  }

  const [o] = parseMarkdown("1. first\n2. second");
  assert.equal(o.kind === "list" && o.list.ordered, true);
});

test("deeper-indented list lines nest under the item above", () => {
  const [b] = parseMarkdown("- outer\n  - inner one\n  - inner two\n- outer two");
  assert.equal(b.kind, "list");
  if (b.kind === "list") {
    assert.equal(b.list.items.length, 2);
    assert.equal(b.list.items[0].sub?.items.length, 2);
    assert.equal(b.list.items[1].sub, undefined);
  }
});

test("pipe tables parse header and body rows", () => {
  const [t] = parseMarkdown("| Path | Clicks |\n| --- | ---: |\n| /pricing | 41 |");
  assert.equal(t.kind, "table");
  if (t.kind === "table") {
    assert.equal(t.header.length, 2);
    assert.deepEqual(t.rows[0][0], [{ kind: "text", text: "/pricing" }]);
  }
});

test("a lone --- is a rule, not a table separator", () => {
  assert.deepEqual(kinds(parseMarkdown("above\n\n---\n\nbelow")), [
    "paragraph",
    "rule",
    "paragraph",
  ]);
});

test("unrecognized text degrades to a paragraph, never throws", () => {
  const weird = "]] ** unbalanced `tick [link(no\n<not html>";
  const blocks = parseMarkdown(weird);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "paragraph");
  assert.deepEqual(parseMarkdown(""), []);
});
