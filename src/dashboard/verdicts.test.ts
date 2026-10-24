/**
 * Tests for reading a coding agent's verdict block back into Polishd.
 *
 * Run with `npm test`. Agents wrap the block in prose and spell verdicts
 * loosely, so what's pinned is that the block is found wherever it sits, that
 * a verdict is never guessed at, and that ids resolve against the findings
 * the agent was shown.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { FixPromptFinding } from "./fix-prompt.ts";
import { dismissalReason, parseVerdicts, planVerdicts } from "./verdicts.ts";

const reply = `Done. Summary of changes:

- A1: the toggle now shows a pending state.

\`\`\`tsx
const config = ["not", "verdicts"];
\`\`\`

\`\`\`json
[
  { "id": "A1", "verdict": "fixed", "reason": "Added a pending state to the toggle.", "files": ["src/components/PlanToggle.tsx"] },
  { "id": "a2", "verdict": "Not Real", "reason": "FeatureCard has an onClick that opens the plan drawer.", "files": ["src/components/FeatureCard.tsx"] },
  { "id": "D1", "verdict": "deliberate", "reason": "15px is the dense table size from the theme.", "files": [] }
]
\`\`\`
`;

const findings: FixPromptFinding[] = [
  { id: "A1", source: "analytics", issue: "The toggle draws rage clicks.", evidence: "button.plan-toggle" },
  { id: "A2", source: "analytics", issue: "Feature cards look clickable but aren't.", evidence: "div.feature-card" },
  { id: "D1", source: "design", issue: "Body text uses two sizes.", evidence: "15px and 16px" },
];

test("the verdict block is found after prose and other code blocks", () => {
  const { verdicts, problems } = parseVerdicts(reply);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    verdicts.map((v) => [v.id, v.verdict]),
    [
      ["A1", "fixed"],
      ["A2", "not_real"],
      ["D1", "deliberate"],
    ],
  );
  assert.deepEqual(verdicts[1].files, ["src/components/FeatureCard.tsx"]);
});

test("a bare array, or an object holding one, also reads", () => {
  assert.equal(parseVerdicts('[{"id":"D1","verdict":"fixed"}]').verdicts.length, 1);
  assert.equal(parseVerdicts('{"verdicts":[{"id":"D1","verdict":"fixed"}]}').verdicts.length, 1);
});

test("bad entries are reported, never guessed at", () => {
  const { verdicts, problems } = parseVerdicts(
    '[{"id":"A1","verdict":"maybe"},{"id":"X9","verdict":"fixed"},{"id":"D1","verdict":"fixed"},{"id":"D1","verdict":"deliberate"}]',
  );
  assert.deepEqual(verdicts.map((v) => [v.id, v.verdict]), [["D1", "deliberate"]]);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /A1: "verdict" should be fixed, not_real or deliberate/);
  assert.match(problems[1], /Entry 2: "id"/);
  assert.match(problems[2], /D1 appears twice/);

  assert.match(parseVerdicts("no json here").problems[0], /No verdict block found/);
  assert.deepEqual(parseVerdicts("   "), { verdicts: [], problems: [] });
});

test("only not_real and deliberate verdicts become dismissals, with the agent's reason", () => {
  const plans = planVerdicts(
    [...parseVerdicts(reply).verdicts, { id: "D4", verdict: "deliberate", reason: "", files: [] }],
    findings,
  );
  assert.deepEqual(
    plans.map((p) => [p.verdict.id, p.action]),
    [
      ["A1", "none"],
      ["A2", "dismiss"],
      ["D1", "dismiss"],
      ["D4", "unknown"],
    ],
  );
  const a2 = plans[1];
  assert.ok(a2.action === "dismiss");
  assert.equal(a2.finding.evidence, "div.feature-card");
  assert.equal(
    a2.reason,
    "Not real, per the coding agent: FeatureCard has an onClick that opens the plan drawer. (src/components/FeatureCard.tsx)",
  );
  assert.equal(
    dismissalReason({ id: "D1", verdict: "deliberate", reason: "", files: [] }),
    "Deliberate, per the coding agent",
  );
});
