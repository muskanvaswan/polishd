/**
 * Polishd — how a filed issue is recognized as polishd's (pure).
 *
 * Every issue polishd files carries its evidence on a line of its own and
 * ends with the same footer. The title can differ between two attempts at one
 * report (the verification behind it is a model call), but those two lines
 * can't — so they're what finds an earlier filing again when its outcome was
 * never heard (the create request failed after GitHub had acted on it), and
 * what keeps that report from being filed twice.
 */

/** The kind of report and the citation it was filed from. */
export interface MarkedReport {
  kind: "loss" | "design";
  evidence: string;
}

/** The evidence line of a filed issue's body. */
export function evidenceLine(report: MarkedReport): string {
  const source = report.kind === "design" ? "from the design audit" : "from analytics";
  return `**Evidence (${source}):** \`${report.evidence}\``;
}

/** The start of the footer every polishd-filed issue ends with. */
export const FILED_FOOTER = "_Filed from the Polishd ";

/** Whether an issue body is polishd's filing of this report. */
export function filedFor(report: MarkedReport, body: string): boolean {
  return body.split("\n").includes(evidenceLine(report)) && body.includes(FILED_FOOTER);
}
