/**
 * Tests for recognizing an issue polishd already filed.
 *
 * Run with `npm test`. This is what stops a report being filed twice when the
 * create request failed after GitHub had already made the issue: the next
 * attempt finds it by these lines — whatever title that attempt gave it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { FILED_FOOTER, evidenceFromBody, evidenceLine, filedFor } from "./issue-marker.ts";

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

test("the citation is read back off the body as it was written", () => {
  const body = ["Visitors click Export and nothing happens", "", evidenceLine({ kind: "loss", evidence: "ExportButton" }), "", "---", `${FILED_FOOTER}analytics dashboard._`].join("\n");
  assert.deepEqual(evidenceFromBody(body), { evidence: "ExportButton", kind: "loss" });
  assert.deepEqual(evidenceFromBody(evidenceLine({ kind: "design", evidence: "#3b5bdb vs #3c5cdc" })), {
    evidence: "#3b5bdb vs #3c5cdc",
    kind: "design",
  });
  assert.equal(evidenceFromBody("no evidence here"), null);
});
