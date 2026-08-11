/**
 * The loop, end to end.
 *
 * Four stages ship today; the last two are what "beta" means. The page never
 * blurs that line — every stage carries its own status.
 */
export type StageStatus = "live" | "coming";

export type Stage = {
  id: string;
  name: string;
  status: StageStatus;
  lead: string;
  body: string;
  tags?: string[];
};

export const STAGES: Stage[] = [
  {
    id: "01",
    name: "Track",
    status: "live",
    lead: "Watch what people actually do.",
    body: "Rage clicks, dead clicks, scroll depth, JS errors, web vitals — captured from real sessions, into your own database. Anonymous by design.",
    tags: ["rage click", "dead click", "scroll depth", "web vitals"],
  },
  {
    id: "02",
    name: "Measure",
    status: "live",
    lead: "Turn a feeling into a number.",
    body: "Events roll up per page, per component, per session — so “this page feels off” becomes a figure you can watch move.",
  },
  {
    id: "03",
    name: "Analyse",
    status: "live",
    lead: "What the numbers actually mean.",
    body: "A model reads a compact digest of the aggregates and writes the plain-English story of how your site is really being used.",
  },
  {
    id: "04",
    name: "Surface",
    status: "live",
    lead: "A bug, not a chart.",
    body: "Wins and losses, each cited to the exact page, selector or source file — and filed to GitHub in one click. Citations that aren’t in the data are thrown away.",
  },
  {
    id: "05",
    name: "Experiment",
    status: "coming",
    lead: "Fix it behind a flag.",
    body: "Ship the change to a slice of traffic and let the loop hold both versions side by side, measured the same way.",
  },
  {
    id: "06",
    name: "Verify",
    status: "coming",
    lead: "Did the signal actually move?",
    body: "If yes, deploy it. If not, the loop runs again — and keeps running until the answer is yes.",
  },
];
