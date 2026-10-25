/**
 * Polishd — the published practice a fix is built on, by kind of bug (pure).
 *
 * Two kinds: an interaction bug (something users do fails) and a design bug
 * (something users see is wrong), each with the guidance a fix for it should
 * lean on. Both places that tell a model how to fix something read it from
 * here — the Suggest a fix panel's prompt (fix.ts) and the brief a coding
 * agent gets with Create fix (fix-brief.ts) — so the two never drift apart.
 */

export type BugClass = "interaction" | "design";

export const BUG_CLASSES: Record<BugClass, { what: string; practice: string }> = {
  interaction: {
    what:
      "something users DO fails or frustrates — rage/dead clicks, broken or missing handlers, unresponsive or inaccessible controls, confusing flows",
    practice:
      "Nielsen Norman's usability heuristics (visibility of system status, error prevention and recovery), the WAI-ARIA Authoring Practices for correct interactive semantics and keyboard support, and touch-target guidance (WCAG 2.5.8 / the 44px platform minimums)",
  },
  design: {
    what: "something users SEE is wrong — contrast, visual hierarchy, spacing, typography, layout shift",
    practice:
      "WCAG 2.2 (1.4.3 text contrast, 1.4.11 non-text contrast), a consistent spacing rhythm and type scale, and the web-vitals guidance on layout stability (CLS)",
  },
};
