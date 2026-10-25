import assert from "node:assert/strict";
import { test } from "node:test";

import type { PolishdDesignIssue, PolishdFiledIssue, PolishdLossItem } from "../ai/types";
import {
  actionableEvidence,
  actionableTitle,
  buildActionables,
  groupActionables,
  isClosedOrUntracked,
  logKey,
  splitClosed,
} from "./actionable-model.ts";

const loss = (issue: string, evidence: string, extra: Partial<PolishdLossItem> = {}): PolishdLossItem => ({
  issue,
  evidence,
  verified: false,
  ...extra,
});
const design = (issue: string, evidence: string, extra: Partial<PolishdDesignIssue> = {}): PolishdDesignIssue => ({
  issue,
  evidence,
  ...extra,
});
const filed = (
  number: number,
  evidence: string,
  state: "open" | "closed" | null,
  createdAt: number,
  extra: Partial<PolishdFiledIssue> = {},
): PolishdFiledIssue => ({
  evidence: logKey(evidence),
  number,
  url: `https://github.com/o/r/issues/${number}`,
  filedAt: createdAt,
  detail:
    state === null
      ? null
      : {
          number,
          title: `Issue ${number}`,
          body: "",
          url: `https://github.com/o/r/issues/${number}`,
          state,
          labels: [],
          assignees: [],
          comments: 0,
          createdAt,
          updatedAt: createdAt,
        },
  ...extra,
});

test("findings join their filed issues by the log key, case and whitespace aside", () => {
  const losses = [loss("Dead clicks beside the toggle.", " Show # More ")];
  const issues = [design("Stray background.", "#FAFAFA")];
  const tracker = [filed(12, "show # more", "open", 2_000), filed(13, "#fafafa", "closed", 1_000)];
  const { open, tracked } = groupActionables(losses, issues, tracker);
  assert.equal(open.length, 0);
  assert.deepEqual(
    tracked.map((a) => [a.id, a.link?.number, a.filed?.number, a.finding?.source]),
    [
      ["loss: Show # More ", 12, 12, "analytics"],
      ["design:#FAFAFA\u0000Stray background.", 13, 13, "design"],
    ],
  );
  // Nothing filed is listed twice.
  assert.equal(buildActionables(losses, issues, tracker).length, 2);
});

test("what still needs deciding comes first, losses then design issues, in review order", () => {
  const losses = [loss("Second.", "b"), loss("First.", "a")];
  const issues = [design("Third.", "16px"), design("Fourth.", "#fafafa")];
  assert.deepEqual(
    buildActionables(losses, issues, []).map(actionableTitle),
    ["Second.", "First.", "Third.", "Fourth."],
  );
});

test("a finding's own link counts as filed even when the tracker wasn't read", () => {
  const [a] = buildActionables([loss("x", "e", { issueUrl: "https://github.com/o/r/issues/7", issueNumber: 7 })], [], []);
  assert.deepEqual(a.link, { url: "https://github.com/o/r/issues/7", number: 7 });
  assert.equal(a.filed, null);
});

test("older filings stay listed on their own, open before closed, newest first", () => {
  const tracker = [
    filed(1, "gone-a", "closed", 1_000),
    filed(2, "gone-b", "open", 2_000),
    filed(3, "gone-c", "open", 3_000),
    filed(4, "gone-d", null, 4_000, { claim: "Something we reported." }),
    filed(5, "current", "closed", 5_000),
  ];
  const all = buildActionables([loss("Still here.", "current")], [], tracker);
  assert.deepEqual(
    all.map((a) => [a.id, a.finding ? "finding" : "filed-only"]),
    [
      ["filed:3", "filed-only"],
      ["filed:2", "filed-only"],
      ["filed:4", "filed-only"],
      ["loss:current", "finding"],
      ["filed:1", "filed-only"],
    ],
  );
  // An unreadable issue falls back to the claim polishd kept, then its number.
  assert.equal(actionableTitle(all[2]), "Something we reported.");
  assert.equal(actionableTitle(buildActionables([], [], [filed(9, "z", null, 1)])[0]), "Issue #9");
  assert.equal(actionableEvidence(all[2]), "gone-d");
  assert.equal(actionableEvidence(all[3]), "current");
});

test("two design issues citing the same evidence are two actionables sharing one issue", () => {
  const issues = [design("Captions fail AA.", "#888888 on #0a0a0a"), design("Placeholders fail AA.", "#888888 on #0a0a0a")];
  const all = buildActionables([], issues, [filed(21, "#888888 on #0a0a0a", "open", 1)]);
  assert.equal(all.length, 2);
  assert.ok(all.every((a) => a.link?.number === 21));
  assert.notEqual(all[0].id, all[1].id);
});

test("closed and untracked issues are split off for the Closed menu, order kept", () => {
  const list = buildActionables(
    [loss("Export does nothing", "ExportButton"), loss("Hero looks clickable", "div.hero"), loss("Not filed yet", "div.x")],
    [],
    [
      filed(12, "ExportButton", "open", 3),
      filed(11, "div.hero", "closed", 2),
      // GitHub won't return it: deleted, transferred, or out of the token's reach.
      filed(9, "OldThing", null, 1),
      filed(8, "Older", "closed", 0),
    ],
  );
  const { current, closed } = splitClosed(list, (a) => a);
  assert.deepEqual(
    current.map((a) => actionableTitle(a)),
    ["Not filed yet", "Export does nothing"],
  );
  assert.deepEqual(
    closed.map((a) => a.link?.number),
    [9, 11, 8],
  );
  // An issue filed this session, or listed without its live state, isn't known to be either.
  const unread = buildActionables([loss("Just filed", "div.y", { issueUrl: "https://github.com/o/r/issues/20", issueNumber: 20 })], [], []);
  assert.equal(isClosedOrUntracked(unread[0]), false);
});
