/**
 * Tests for recognizing an issue polishd already filed.
 *
 * Run with `npm test`. This is what stops a report being filed twice when the
 * create request failed after GitHub had already made the issue: the next
 * attempt finds it by these lines — whatever title that attempt gave it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { FILED_FOOTER, evidenceLine, filedFor } from "./issue-marker.ts";

const loss = { kind: "loss" as const, evidence: "Show # more" };
const body = (evidence: string, footer = `${FILED_FOOTER}analytics dashboard — observed in real user-behavior data._`) =>
  ["Dead clicks beside the toggle.", "", evidenceLine({ kind: "loss", evidence }), "", "---", footer].join("\n");

test("an earlier filing of the same report is recognized, whatever its title", () => {
  assert.equal(filedFor(loss, body("Show # more")), true);
});

test("a different citation, a design report, or a hand-written issue is not it", () => {
  assert.equal(filedFor(loss, body("Show # more items")), false, "the evidence must match exactly");
  assert.equal(filedFor({ kind: "design", evidence: "Show # more" }, body("Show # more")), false);
  assert.equal(filedFor(loss, body("Show # more", "Reported by a person.")), false);
  assert.equal(filedFor(loss, `I saw ${evidenceLine(loss)} somewhere\n${FILED_FOOTER}`), false, "the line must stand alone");
});
