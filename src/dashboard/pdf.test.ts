import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { test } from "node:test";

import { fitText, PdfDocument, textWidth, wrapText } from "./pdf.ts";

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/** Every object's byte offset, as the cross-reference table claims it. */
function xrefOffsets(pdf: string): number[] {
  const start = Number(pdf.match(/startxref\n(\d+)\n%%EOF\n$/)![1]);
  const table = pdf.slice(start);
  assert.ok(table.startsWith("xref\n0 "), "startxref points at the xref table");
  return [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
}

test("a document's cross-reference table points at every object", async () => {
  const doc = new PdfDocument();
  const page = doc.addPage(842, 595);
  page.rect(10, 10, 100, 50, { fill: [255, 0, 0], radius: 6 });
  page.text("Hello (world) \\ — “quoted” café", 20, 40, { size: 12, color: [0, 0, 0] });
  page.text("faint", 20, 60, { size: 9, color: [0, 0, 0], opacity: 0.5 });
  page.stencil({ width: 2, height: 2, alpha: new Uint8Array([0, 255, 255, 0]) }, 0, 0, 10, 10, [0, 0, 255]);
  page.link(20, 30, 50, 12, "https://example.com");
  doc.addPage(842, 595);

  const pdf = latin1(await doc.save({ title: "Acme — Brand kit" }));
  assert.ok(pdf.startsWith("%PDF-1.4\n"));
  const offsets = xrefOffsets(pdf);
  offsets.forEach((offset, i) => {
    assert.equal(pdf.slice(offset, offset + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1}`);
  });
  assert.match(pdf, /\/Type \/Pages \/Kids \[\d+ 0 R \d+ 0 R\] \/Count 2/);
  assert.match(pdf, /\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/);
  assert.match(pdf, /\/GS1 << \/Type \/ExtGState \/ca 0.5 \/CA 0.5 >>/);
  assert.match(pdf, /\/SMask \d+ 0 R/);
  assert.match(pdf, /\/URI \(https:\/\/example.com\)/);
});

test("text is escaped and set in WinAnsi, with what it can't encode dropped", async () => {
  const doc = new PdfDocument();
  doc.addPage(200, 200).text("a(b)c\\ — ₹5 café", 0, 100, { size: 10, color: [0, 0, 0] });
  const pdf = latin1(await doc.save({ title: "t" }));
  // The content stream is the last stream before the xref; find it and inflate.
  const streams = [...pdf.matchAll(/\/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)];
  const contents = streams.map((m) => {
    const at = m.index! + m[0].length;
    return inflateSync(Buffer.from(pdf.slice(at, at + Number(m[1])), "latin1")).toString("latin1");
  });
  const text = contents.find((c) => c.includes("Tj"))!;
  assert.match(text, /\(a\\\(b\\\)c\\\\ \\227 5 caf\\351\) Tj/);
  // Top-left coordinates flip into PDF space.
  assert.match(text, /0 100 Td/);
});

test("metrics wrap and fit with the faces' real widths", () => {
  assert.equal(textWidth("Hello", "sans", 10), 22.78);
  assert.equal(textWidth("Hello", "mono", 10), 30);
  assert.equal(fitText("Short", "sans", 10, 100), "Short");
  const cut = fitText("A much longer line of text than fits", "sans", 10, 60);
  assert.ok(cut.endsWith("…") && textWidth(cut, "sans", 10) <= 60);
  const lines = wrapText("one two three four five six seven", "sans", 10, 50);
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(textWidth(line, "sans", 10) <= 50, line);
  assert.equal(lines.join(" "), "one two three four five six seven");
});
