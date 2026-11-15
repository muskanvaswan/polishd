/**
 * Queuebird's bugs, and the fix for each. A fix is a CSS variant in
 * app/globals.css (`fx-palette:`, `fx-copy:` …): naming it in `data-fix` on
 * <html> switches every element that carries it to the fixed value. The demo
 * bar lists these and turns them on one at a time, or all at once.
 *
 * The numbers are what Polishd's dashboard reported for the site as
 * generated (see README.md); the live dashboard moves with real traffic.
 */
export const FIXES = [
  { id: "copy", kind: "Behaviour", title: "The copy icons don't copy", seen: "24 rage clicks" },
  { id: "billing", kind: "Behaviour", title: "The Yearly switch doesn't switch", seen: "30 rage clicks" },
  { id: "tabs", kind: "Behaviour", title: "The code tabs don't switch", seen: "23 rage clicks" },
  { id: "links", kind: "Behaviour", title: "“Changelog” and “Learn more” go nowhere", seen: "46 dead clicks" },
  { id: "contrast", kind: "Design", title: "Text too dim to read", seen: "12 pairs fail AA" },
  { id: "palette", kind: "Design", title: "Two grey scales, seven purples", seen: "33 colours" },
  { id: "type", kind: "Design", title: "A font size for every heading", seen: "18 sizes" },
  { id: "radii", kind: "Design", title: "Corners that disagree", seen: "7 radii" },
  { id: "space", kind: "Design", title: "Hand-typed padding", seen: "5 off the scale" },
] as const;

export type FixId = (typeof FIXES)[number]["id"];
export const FIX_IDS = FIXES.map((f) => f.id) as FixId[];

const KEY = "polishd-demo-fixes";
const isFix = (x: string): x is FixId => (FIX_IDS as string[]).includes(x);

/** The fixes that are on right now. */
export function readFixes(): FixId[] {
  return (document.documentElement.dataset.fix ?? "").split(" ").filter(isFix);
}

/** Turn exactly these fixes on. `morph` eases the change in. */
export function writeFixes(on: FixId[], morph = true) {
  const html = document.documentElement;
  if (morph) {
    html.dataset.morph = "";
    window.clearTimeout(Number(html.dataset.morphTimer || 0));
    html.dataset.morphTimer = String(window.setTimeout(() => delete html.dataset.morph, 900));
  }
  // Kept in the list's order, so the attribute reads the same however you got there.
  const next = FIX_IDS.filter((id) => on.includes(id));
  if (next.length) html.dataset.fix = next.join(" ");
  else delete html.dataset.fix;
  try {
    if (next.length) window.sessionStorage.setItem(KEY, next.join(" "));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the fixes still apply, they just won't survive a reload.
  }
}

/**
 * Runs before the page paints, so a reload or a new page in the same tab
 * keeps the fixes you turned on. `?polish=1` opens the site with all of them.
 */
export const BOOT_SCRIPT = `try{var f=new URLSearchParams(location.search).get("polish")==="1"?${JSON.stringify(FIX_IDS.join(" "))}:sessionStorage.getItem(${JSON.stringify(KEY)});if(f)document.documentElement.dataset.fix=f}catch(e){}`;
