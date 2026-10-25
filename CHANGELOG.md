# Changelog

## Unreleased

### Snapshots spend fewer shots

- **One page per dynamic route.** Pages that read as instances of one route —
  `/posts/hello-world`, `/posts/launch-week`, `/tags/react` — are shot once,
  as the most visited of them, in gallery and review captures alike. A slug is
  read from the URL: a number, UUID or `@handle` anywhere; below the top level,
  hyphenated words or a token with digits; anything under a collection such as
  `/blog`, `/tags` or `/products`. Top-level pages (`/privacy-policy`) keep
  their names.
- **The landing page's phone view goes first, light then dark.** When the two
  render the same, the site has one look, and the rest of the run skips every
  dark rendering instead of shooting pictures the finish would throw away —
  13 shots instead of 24 for six pages with no dark mode. The gallery
  also leads with `/`, so the route cap never cuts it.

### A Fix dispatch card on the Settings tab

polishd is building toward handing the issues it verifies to a coding agent
the repo already runs — the Claude Code GitHub Action first, Copilot's coding
agent second — and reading the verdict back. None of that is wired yet. This
is the card it will stand on, at the bottom of the Settings tab once a
repository is connected.

- **What polishd found.** Every workflow under `.github/workflows/` on the
  default branch is read with the token the owner already gave (no new
  permissions) through a small line-based reader — the package still has no
  runtime dependencies, so no YAML library — and judged: the agent (a
  workflow using `anthropics/claude-code-action`, its pinned version and
  path; or Copilot's agent, checked through GitHub's `suggestedActors`
  query, degrading to "couldn't ask" when the token can't run GraphQL; or
  none), how it fires (new issues → the trigger phrase goes in the issue
  body; comments only → polishd comments after filing), the trigger phrase
  (a `trigger_phrase` input, else the job's `if:` condition, else `@claude`),
  the billing path (which of `claude_code_oauth_token` or
  `anthropic_api_key` the step names — subscription limits or metered usage —
  never a value), and the token user's write access, which the Action
  requires of whoever triggers it. Warnings for automation mode (a `prompt`
  input: every filed issue would start a run), a workflow sitting in an
  unmerged pull request, one read off a non-default branch, and a workflow
  that hears neither issues nor comments. What no token can read — the
  Claude GitHub App being installed, the secret existing — is shown as
  verified by the last live test, with its date, or not yet tested.
- **Live test.** *Send test issue* files "polishd dispatch test" the way a
  dispatch would (phrase in the body or in a comment after; an assignment
  through `replaceActorsForAssignable` for Copilot, or a note that
  Copilot's test is manual when that can't run), watches for a comment from
  a bot login containing "claude" for up to three minutes in short polls the
  card repeats, then closes the issue with a comment saying why. The issue
  number is stored the moment it exists, so *Check again* resumes a poll the
  page didn't live to see; a test issue is never left open silently. Success
  shows the reply time; failure lists the likely causes in order.
- **Setup checklist**, when nothing is found, least effort first: `claude`
  then `/install-github-app`; otherwise the App install link, the secret
  with a radio between subscription token (`CLAUDE_CODE_OAUTH_TOKEN`) and
  API key (`ANTHROPIC_API_KEY`) that switches the name shown and a one-line
  cost note, and the workflow through GitHub's new-file page prefilled with
  polishd's recommended `claude.yml` (the stock example with the chosen
  secret line and a `--max-turns` cap) plus a copy button; then Copilot's
  repository setting and docs.
- **Your choices**, the only editable fields, saved with the settings and
  stored only: send fixes automatically (off), the label on dispatched issues
  (`polishd-fix`), a daily cap (5), and a pause switch. No key or token for
  the Action is ever stored.
- The Actionables tab carries a one-line pointer to the card until it says
  Ready.

### Actionables: one list of what to fix, and design issues that show where

The summary's losses, the design review's issues and the GitHub issues filed
from them used to be three places: a rail under each review card, and an
**Issues** tab that only appeared once a repository was connected. They are
one list now.

- **The Issues tab is the Actionables tab.** It lists every problem both
  reviews found — what still needs a decision first, then what's already in
  the tracker, open before closed — with **File bug** and **Ignore** on each
  row. It's always shown; without GitHub it lists the findings and says that
  filing needs a repository. `?tab=issues` still lands on it.
- **Mark fixed** is a third verdict beside File bug and Ignore. It works like
  Ignore — the finding leaves every later review, with an optional note — but
  the model is told it was fixed, and on which day, so data from before the
  fix doesn't bring it back. A fixed row shows a check where an ignored one
  shows its source mark.
- **The review cards are the story and what's working.** The *Losses* and
  *Breaking the system* rails are gone from the summary and design review
  cards; each card ends with how many of its findings are waiting on the
  Actionables tab.
- **A filed issue stays linked on its actionable**, from the moment it's filed
  and with the tracker's live state on the next load. A filed issue whose
  finding the current reviews no longer hold stays listed on its own, as the
  Issues tab listed it.
- **Design issues show where their values render.** Each color, size or
  padding a design issue cites is looked up in the measurements — how much of
  the UI it covers, on which pages, how many declarations chose it, whether
  one hand-typed it — and in the newest site snapshot that pictured it. The
  picture shows on the actionable's row and in its drawer, goes into the issue
  body when it's filed (embedded when the image is in a public Vercel Blob
  store GitHub can fetch, named otherwise), into the verification prompt, and
  into the fix prompt as a *Where it renders* line.
- `PolishdDashboard`'s `showIssues` prop is accepted and ignored; the
  `PolishdDashboardTab` type names the tab `actionables`.
- `POLISHD_GITHUB_API` points the GitHub client at a GitHub Enterprise
  Server's REST base instead of `api.github.com`.

### The Overview is a board of the site

The Overview opened on four audience numbers and the two review cards stacked
one above the other, with the newest snapshot as a strip at the bottom. It
now reads as a board: one row of the site as it renders and the system it
renders with, then one column of the story and the numbers.

- **Site snapshots** are a small bento of the site's top pages rather than a
  strip: the homepage hero largest, the homepage on a phone beside it, and
  the heroes of the two most visited other pages under them — four pictures,
  with no heading over them and no device or theme toggles in front. Pages
  are ranked by the traffic the analytics saw. A click still opens the
  full-height shot; the rest of the capture is one link away on the Design
  tab. In the lightbox, phone shots now open at phone width instead of being
  blown up to desktop width, and Escape closes it.
- **The brand** sits in the same card, beside the snapshots: the system the
  pages actually ship, curated the way the brand kit is (one-offs left out),
  as two hierarchies and no labels. The palette: Primary largest, Secondary
  and Accent beside it, the neutrals as one scale from light to dark — not
  every color the site paints. The type: the words "Title", "Subtitle",
  "Body" and "Caption", each set in its own face at the size the site really
  uses that style.
- **The paragraph**, captioned Overview, is written by the model. The analytics summary
  and the design review are handed to the same provider, model and key the
  owner configured, with instructions to fold them into a single story — the
  overall picture, the one or two things most worth fixing, what to protect —
  and to say nothing the two reviews don't. It's cached under the reviews'
  hash, goes stale when either changes, and is rewritten when the Overview
  opens on a missing or stale paragraph. One refresh regenerates the summary,
  the review and then the paragraph from them. The losses and the design
  issues — and the ignore and file-bug controls that act on them — are on
  the Actionables tab.
- **Visitors** — sessions, page views and the share on mobile — stack in a
  narrow column beside the paragraph; views per session and the friction
  counts stay on the Analytics tab. Colors the paragraph cites render as the Design tab's
  copyable chips.

**Copy fix prompt** and **Paste verdicts** are unchanged: the prompt still
carries every problem both reviews found, built from the latest summary and
review the page has, and a pasted verdict drops its finding from the next
copy.

### The design review sees the pages

The aesthetic review read the measured tokens and nothing else. It could tell
that 28px was used once, not whether that was a hero or a slip.

- **A capture of its own, when you generate.** Generating a review first
  shoots the first screen of the three most-visited pages (ranked like the
  Top pages table: distinct sessions, then page views), desktop, in light and
  dark — a site with no dark mode drops the dark shots — and pictures the
  flagged values in place from the light rendering: the element carrying
  each, ringed, with its surroundings. It runs through the snapshot machinery
  (the service in production, this machine's browser in development) but
  stays out of the gallery, and each review's capture replaces the last.
  Nothing is captured for the gallery that wasn't before.
- **Chosen with care.** Failing contrast pairs are looked for first, then
  one-off type styles, colors and radii in turn, and off-grid padding only to
  fill the last of at most six pictures — a pixel of padding isn't something a
  scaled screenshot can show. With the first screens that's a dozen small
  images at most, each labelled for the model with its page or value and the
  capture date. The prompt says the shots are scaled down and are context, not
  evidence: an issue still cites a measured token. Works with Anthropic,
  OpenAI and Google models alike; a model or endpoint that won't take images
  gets the metrics alone, with a note in the server log.
- **The card says what happened.** A review made with screenshots lists the
  pages and the number of values it was shown (the values themselves on
  hover), and the fix prompt's design section names them too. One made from
  the metrics alone says why: snapshots off here, the service not yet allowed
  (the consent dialog opens, as it does from the Site snapshots card), or a
  capture that failed. The button reports the capture's progress.
- **The screenshot service learns `viewport`.** A request may ask for the
  first screen instead of the full page; the local engine honours it too. A
  deployed service that predates the option returns the full page and the
  dashboard crops it to the viewport before storing. Snapshot captures are
  unchanged.

### Dead clicks are judged by what happened, and errors say where they came from

A dead click used to mean "a click on something that isn't a button or a
link". Anything wired with a React `onClick` (a modal backdrop, a clickable
card) counted as dead on every press, even when the press worked.

- **Judged by outcome.** A click on something that isn't recognisably a
  control is held for a second. It records as a dead click only if nothing
  happened: no DOM change, no navigation, no focus move. If the page
  responded, it's an ordinary click. An element with a React `onClick` (on
  the clicked element or its parent) counts as a control straight away,
  except a handler that only stops propagation, like a modal panel's.
- **A click that worked is never reported dead.** The judge works in tiers,
  and the first two never ask whether the page was busy anyway:
  1. Any change to the clicked element or inside it, or to the element
     carrying its click handler, counts. So does either one being removed or
     hidden.
  2. A dialog or modal surface counts at any point in the hold: added, or one
     already in the page shown or hidden, a fade-in included.
  3. Otherwise a change counts if it's related to the click and isn't the
     page's own churn:
     - on the nearest ancestors;
     - within 64px of the click point or of the clicked element's box, such
       as the details a card reveals under itself or an accordion panel
       opening or closing;
     - a menu, or a toast near the click or within 300ms.
- **Background activity doesn't hide real dead clicks** in that third tier.
  - The page's churn is learned continuously and per container. Every slide
    of a carousel feeds one `aria-hidden` history, but clickable dots don't
    share `class` history with each other.
  - A container is background only while it has changed at least twice in
    the ten seconds before the click. A list rendered once is never
    background to its own cards, and neither is a card that infinite scroll
    just appended.
  - Learning pauses for the second after a press or click, and for typing in
    the focused element, never for scrolling.
  - What the pointer moves onto after the click is hover, and the next click,
    key press or scroll takes the credit for what follows it.
  - Polishd's own UI is ignored.
- **Known limits.** Each of these is a deliberate trade toward never reporting
  a working click as dead.
  - Anything that keeps changing the clicked element on its own credits clicks
    on it: an autoplay carousel swapping out the slide you clicked, a hover
    animation on the clicked card. A click on a page-sized wrapper is credited
    by any change inside it.
  - Rotations inside a focused carousel aren't learned as background.
  - A plain div whose only effect is far from it, and isn't a dialog, reads
    as dead.
  - A hover card marked `role="dialog"` that opens as the pointer moves on
    credits the click.
  - The first change a busy region ever makes has no history yet, and a region
    that changes less than twice in ten seconds (a slow carousel) never
    becomes background.
  - Class-only carousels and dots don't share history between siblings.
  - Details revealed 100–130px from the clicked element read as dead.
  - A hover menu that opens within 300ms of the click credits it.
  - A second of steady clicking pauses learning.
  - `showPopover()` and CSS-only effects leave no DOM change to see.
- **Near misses.** A dead click beside a control names it in `meta.near`: a
  full-width row whose button is only its text, or the gap next to a tab. The
  click no longer carries the button's text as its own label, so it reads as
  "clicks beside Show # more", not "Show # more doesn't respond".
- **Counts in labels fold to `#`.** "Show 9 more" and "Show 12 more" are one
  control now, not a row each. Ingest applies the same rule to clicks sent by
  older clients.
- **Errors are diagnosable.** Each `js_error` carries Next's `digest` when
  there is one, which is the key to the full error in your server logs when
  production redacts the message. It also carries the top stack frame
  (`frame`, `file:line:col`) and the click from the two seconds before it:
  `after` (its component, label or selector), `afterMs` (how long before,
  to the nearest 100ms) and `afterSelector`.
- **Selectors stay stable; handles find the element in the source.** The
  `selector` every event carries is still each level's first class, so element
  stats keep their history. It now skips Tailwind variants (`lg:sticky`),
  arbitrary values and generated ids, and never ends in an empty class (`a.`).
  Rage, dead and near-miss clicks and errors also carry `meta.handle`, a path
  you can grep for: it stops at the nearest `data-component` or id, and names
  each level by its most distinctive class rather than a generic utility. A
  near miss adds `meta.nearHandle` for the control it missed.
- **Rage clicks count hits on the same control**, not on the exact node
  clicked. A like button that gains `liked` as it's clicked, or an icon toggle
  whose `<svg>` is re-created on every click, still adds up to a burst. A fake
  button (a plain div) counts hits on its selector, as before.
- **The dashboard reads the new context.** The errors list keeps one entry per
  error however its context varies. Before, a frequent error whose throws
  differed by `afterMs` filled the list and pushed the others off. Each error
  carries its latest digest, frame and preceding click. Session journeys order
  steps by when they happened, so a held dead click no longer shows up after
  the page view that followed it. A near miss with no label of its own reads
  as "beside “Show # more”" in journeys and element stats.
- **Dashboard telemetry reports its version.** The once-per-session
  `install_state` event now includes the polishd `version`, and reports again
  when a tab reloads onto a newer one.

All of this applies to both your site's capture and the dashboard's own
telemetry, which now share one click-capture module.

### The design review counts decisions, not copies

The Design tab's metrics read repeated copies and framework-standard values
as drift. A badge class rendered on 38 table rows counted as 38 uses of an
off-grid 9px padding. Tailwind's own `1.5` and `2.5` steps (6px, 10px) were
flagged off the 4px grid. Loading skeletons added near-duplicate greys to the
palette. And the real systemic problem, every color hand-typed with no token
layer, was never stated.

- **Declarations beside uses.** The scan groups elements by class string (or,
  for an unclassed element, its tag path). Each font, color, radius and
  padding value now reports both uses and distinct declarations. Inherited
  font and text color are credited to the ancestor that set them, so text
  inside one `text-[#555]` wrapper counts as one declaration. One-offs still
  have to be rare in uses, under the same per-category shares as before, and
  now must also be declared exactly once. A rare value chosen in two places is a
  pattern, not a stray, and repeated copies never promote anything into a
  one-off. The off-grid share counts declarations too.
- **Tailwind-aware grid.** When the class names are mostly Tailwind
  utilities, values on its default spacing scale (1px, 2px, 6px, 10px, 14px,
  scaled to the root font size) count as on-grid.
- **Hand-typed values.** Arbitrary-value classes (`text-[#555]`,
  `bg-[#111]`, `rounded-[2px]`, `p-[13px]`, `text-[11px]`) are counted per
  category. When more than half of a category's declarations are hand-typed,
  a new finding says so: *"91% of color declarations (20 of 22) are
  hand-typed arbitrary values … — there is no color token layer."* A site on
  theme tokens with a few deliberate arbitrary values stays quiet. So does a
  site whose arbitrary values are built on tokens: `bg-[hsl(var(--card))]`
  and `rounded-[calc(1rem-var(--inset))]` count as token references. The scan
  measures the page at rest, so an arbitrary class counts only when its value
  is what renders: `hover:text-[#fff]` never does, and `sm:p-[13px]` counts
  only when the element renders 13px. Inline `style=""` values aren't
  counted. At runtime `style={{ color: theme.fg }}` and
  `style={{ color: "#555" }}` produce the same literal, so the DOM can't
  tell a token from a hand-typed value there.
- **Transient states left out.** Subtrees that are `aria-busy`, pulse at
  rest (bare `animate-pulse`, or behind `motion-safe:`, a breakpoint or
  `dark:` when the computed animation confirms it, never behind `hover:`),
  carry a skeleton class (`skeleton`, `skeleton-line`,
  `MuiSkeleton-root`, not `no-skeleton-here`), are `display: none`, or are
  closed overlays at opacity 0 are skipped. The scan waits up to three 1.5s
  beats for visible loading states to clear before measuring.
- The AI review's digest carries all of this: uses and declarations per
  value, a hand-typed share per category, and whether Tailwind's scale applies.
- **Older installs keep working.** Scans from earlier package versions carry
  no declarations or class-name readings. They aggregate as before: counts
  kept, declarations unknown, the per-use one-off rule and the plain 4px
  grid. This holds row by row: an old page's uses count as decisions beside
  newer pages' declarations, so one page nobody has revisited since an
  upgrade doesn't change how the rest is read. Malformed rows are skipped. The bigger payload still fits ingest's
  32,000-character cap: the worst page the scan can describe is about 30KB,
  and serializing drops the declaration ids first (to about 19KB), then the
  least-used values, instead of dropping the scan.

### The fix prompt carries what a coding agent needs to judge a finding

A fix prompt gave the agent each finding's claim and citation, and little to
weigh them by. Working through one, an agent couldn't tell how many visitors
were behind a finding, couldn't find the element when no file was matched, and
didn't know the design review was 70 days older than the analytics. Prompts
now carry:

- **Volume.** Each analytics problem shows the count behind it when the
  summary recorded one: *23 dead clicks across 9 sessions on `/pricing`*.
- **How it was detected, and the blind spot.** One line per kind of finding
  present. A dead click is a click on something with no interactive tag, role
  or inline `onclick`, so a `div` with a React `onClick` counts as one; the
  agent is told to check for a handler first. Rage clicks, JS errors,
  page-level signals, component engagement and design measurements have
  lines of their own.
- **Search handles.** Read off the citation: a component name's
  `data-component`, a label's visible text, a selector's meaningful class
  names and ids (utility and generated classes are skipped; a CSS-module
  class names its `.module.*` file), or a page's route file. Design values
  are listed in px and rem.
- **How current it is.** A note up front when the two reviews are two weeks
  or more apart, when either is a month old, or when the design measurements
  have changed since the review. A review that's stale only because of a
  dismissal or a settings change gets a neutral note (or none, when the
  measurements are known not to have moved), never a claim of new data.
- **A verdict block.** The agent is asked to finish with fenced JSON, one
  entry per problem: `{ "id": "A1", "verdict": "fixed" | "not_real" |
  "deliberate", "reason": "…", "files": [] }`.

### Verdicts come back, and design issues can be ignored

**Paste verdicts** on the Overview reads that block back. Each verdict is
shown against the finding it refers to, matched by the prompt as last copied,
and findings marked `not_real` or `deliberate` are ignored with the agent's
reason. Before, the agent's "left it, it's deliberate" stayed in its chat and
the next review reported the same thing again. The paste is untrusted input:
only `id`, `verdict`, `reason` and `files` are read, a verdict counts only
for a finding still in the current summary or review (checked again on the
server, which takes the finding's wording from its own copy), reasons are
flattened and clipped to 200 characters, and blocks are capped at 20 entries.
Dismissal reasons, the owner's and the agent's alike, are now quoted in later
prompts as notes about the site, never instructions.

Design review issues now have the **Ignore** control the summary's losses
have: an ignored issue leaves every later review, its reason is replayed into
the review prompt, and the cached review is marked stale. The model rewords
design evidence on every regenerate, so a dismissed issue is recognised by
what it's about and the values it cites, never the pages it mentions, with
wording read only to name a category outright, break a tie or rule a match
out: "#444444 on #0a0a0a (2.03:1 at 11px)" and "#444 text on #0A0A0A" are the
same issue. Two colors joined by "on" are a contrast pair, colors
alone a palette issue, and px values are whatever the wording names outright
(radius, padding, font size), or else whichever part of the measured design
holds them, so an 11px caption and an 11px radius stay apart. Where it's
unclear, a dismissed issue is allowed back rather than a real one hidden: a
color's role must agree, a contrast failure's sizes must be the same when
both state them (dismissing it at 11px doesn't hide it at 16px), and of two
issues citing identical evidence, a dismissal hides only the one worded
closest to it. Each dismissed issue keeps its own entry and reason. Ignoring, undoing or
recording verdicts after the dashboard session expires shows an error in
place instead of crashing the page.

### The design review stops redesigning the site

The review was asked whether the site read as "one deliberate brand, or an
accumulation of one-off decisions", allowed up to five issues, and was shown
"collapse 15px and 17px into 16px" as the model fix. It took that as licence to
consolidate everything, proposing palettes and type scales the code never had.
It now judges the site's own system on its own terms, raises at most three
issues and none for a coherent system, and fixes outliers with values the site
already uses.

Its suggestions are also checked once parsed. One that clearly removes a
value the same review lists as a strength is withheld, with the reason shown
on the card and in the fix prompt. That covers replacing it with a different
value of the same kind ("collapse 22px into 20px"), dropping it, and
proposing a scale that spans it but skips it. A review once praised 22px and
28px headings, then proposed a 12/14/16/20/24px scale. The check is
deliberately narrow: only values written with a unit or `#` count as praised,
and a fix that changes something about a praised value without replacing it
("change the 16px body text color", "convert 16px to rem") or an ordinary fix
such as 9px → 10px is never touched. A value a suggestion introduces that the
site doesn't render yet is labelled as new.

### Analytics findings stop overstating, and point at the right file

The summary model was told dead and rage clicks were genuine friction on
things that looked actionable. They aren't always. A dead click is a structural
guess: a drawer backdrop that closes on click counts as dead, because React's
handler leaves no trace in the DOM. A click on the bar beside a small button
reads as that button not responding. The prompt now explains how each signal
is detected and what it can't see. Findings are written as hypotheses tied to
the numbers, and say when a pattern looks like a backdrop or a near miss.

- **The digest shows more of what happened.** It shows sessions behind each
  count and the element that was actually clicked (`<div.flex>`, not just the
  button text inside it). It also flags text-less positioned layers as possible
  backdrops. When capture records them, it adds where dead clicks landed and
  what came just before an error, with its stack frame and digest.
- **Each finding carries its volume.** `signal` (event kind, count, sessions,
  pages) is the cited digest line's own numbers, looked up after the model
  answers and never taken from its prose. The kind follows what the finding is
  about: a bounce on `/pricing` gets the page's views, not its one dead click.
  Only a citation that is exactly one printed line gets a signal. One that
  merely contains a line's name, or could mean two lines, gets none.
- **Source matching stopped guessing.** It used to match any token of four
  letters or more. A backdrop cited as `div.fixed>div.absolute` was "verified"
  against whichever file first said `fixed`. Matching now searches only for
  names the author chose: component names, routes (`/pricing` →
  `app/pricing/page.tsx`, even when a component is also called `pricing`), ids
  and custom classes, and visible labels, numbers included (`Show 9 more` finds
  `` `Show ${hidden} more` ``). Short labels like "Log in" match only as exact
  JSX text. Utility classes, tag names and comments never match. Only what a
  finding cites outright can verify it. A shorter label inside the citation
  ("Export" in "Export CSV") gives candidates at most, and so does a label
  that happens to spell a path segment. When several files match equally, the
  loss lists them as `candidates` and stays unverified instead of picking one.
- **Matching works on Vercel.** When the source isn't on disk, findings are
  matched against the connected GitHub repo. Before, every finding came back
  "not matched to source". The read is bounded by a file budget, a timeout on
  each request and on the whole match. Repeat reads come from a cache keyed by
  commit and blob. If any file couldn't be read, only routes verify. If
  GitHub cut the listing short, nothing verifies. The summary is saved before
  matching starts, so a slow repo can't cost the model's answer.
- **No duplicate issues from a lost reply.** Creating an issue no longer
  aborts on a timer. Before filing, Polishd looks for an issue it already
  filed for the same evidence, in case an earlier attempt succeeded but the
  reply was lost.

### The dashboard is redesigned

Every tab keeps its content and layout. Each one is redrawn from a single set
of design tokens instead of hex values repeated across thirty files.

- **Ink, in light and dark.** Pure neutral greys with no tint. The accent is
  the text colour itself, so the only colour on the page is status: green for
  healthy, amber for dead clicks, red for rage clicks and errors. Dark is
  the default; a muted sun/moon icon at the foot of the sidebar (beside the
  wordmark on narrow screens) switches to light and back. The choice is remembered in a `polishd_theme` cookie scoped to the
  dashboard's path, so the server renders it on the next load with no flash
  of the other theme. Nothing is drawn with a gradient.
- **The landing site's wordmark.** The sidebar and the lock screens carry the
  hero's "polishd": the letters in its highway face, and for the h the
  halftone polish bottle, its dots shimmering. It ships as SVG outlines, so
  there's no font to load for it. The shimmer is scoped to the bottle, stops
  under `prefers-reduced-motion`, and links to the Overview from the sidebar.
- **The brand's type.** Body text is Open Sauce One, page and section titles
  are Nohemi, and code is JetBrains Mono. The font files ship with the package
  under private family names and load from the host's own origin. There's no
  font CDN request, no CSP change, and no collision with a host loading the
  same families itself. Licences are in `dist/fonts/LICENSE.md`.
- **Readable at a glance.** Section headings are sentence case, not tracked
  capitals. Stat tiles lead with their label, and numbers use tabular
  figures. Secondary text clears WCAG AA (≥5:1) on every surface in both
  modes, where the old `#555`/`#444` greys sat near 2.5:1. The faintest grey
  is kept for rules, dots and struck-out marks, never for text, even an
  em-dash. In light mode the green, amber and red are a step darker, so a
  status badge's text still clears 4.5:1 on its own tint.
- **Keyboard-visible.** Every control shows one focus ring, and the "how is
  this calculated" tips open on focus as well as hover. Text glyphs used as
  icons (`✕`, `›`, `⏱`, `●`) are now SVG, and motion collapses under
  `prefers-reduced-motion`.
- **Nothing reaches the host.** Colour and font tokens are `--pd-*` custom
  properties declared on `.polishd-root` only, so a host's own Tailwind theme
  variables are never overwritten. The scoped reset now also covers `label`
  and `legend`, so a host's global `label { font-weight: 600 }` no longer
  bolds the dashboard's form fields.
- **A smaller stylesheet.** The build scans only the dashboard's own source for
  utilities. It used to scan the whole repository, landing site included, and
  ship those classes too.

No host changes are needed: the stylesheet import is the same. Its fonts sit
beside it in `dist/fonts`, and the host's bundler picks them up from the
stylesheet's relative URLs.

### Runtime JavaScript errors are captured again

Uncaught runtime errors never reached the dashboard. A runtime throw fires its
`error` event on `window`, and the capture listener read that target as an
element to find its component. That threw a `TypeError` of its own
(`node.getAttribute is not a function`, in the browser console), and the
original error was lost. Only unhandled promise rejections and failed resource
loads were being recorded. Runtime errors now store with no component, and a
failed `<img>` or `<script>` is still attributed to the component it sits in.

### Download the Design tab as a brand kit

The Design tab reverse-engineers a site's design system, drift and all. A new
**Brand kit** button in its header hands the same system over the other way
round: curated into a guideline and downloaded as a PDF.

- **One-offs stay out.** Anything the tab badges one-off is left out, and
  padding gets the same test (a sliver of the tallies, on one page).
  Near-duplicate colors fold into the one used more, and fluid type sizes a few
  percent apart (30px and 30.7px) count as one step. The last page lists what
  was left out.
- **Everything is named.** Colors by hue and lightness on the familiar 50–950
  steps (`Red 600`, `Neutral 100`), with the two most used brand colors as
  Primary and Secondary. Type steps run outward from body text (`Display`,
  `Heading 1`, `Body L`, `Body`, `Caption`). Radii are `sm`–`xl` plus `full`,
  spacing is `space-1` upward, and `next/font` aliases like `__Inter_d65c78`
  read as "Inter".
- **The PDF** (A4 landscape) opens on a cover in the site's own background,
  text color and display face, then covers the palette, the text/background
  pairings that pass WCAG AA, a specimen for each typeface, the type scale in
  the site's own copy, and radii and spacing drawn to scale. It ends with the
  kit as CSS custom properties, named to also work in Tailwind v4's
  `@theme`.
- **Specimens are in the site's real fonts.** The PDF is built in the browser,
  which has them loaded, so type is drawn in its own face while labels,
  values and code stay selectable text. A face the dashboard page never
  loaded falls back to Helvetica, and the kit says so.
- No new dependencies: the PDF writer is a small in-house module.

The Design header's **Refresh metrics** button is now an icon button, and
the header stacks on phones instead of squeezing the title.

### An Overview tab, with a fix prompt for your coding agent

The dashboard now opens on an **Overview**: sessions, page views, views per
session and the share on mobile; the AI summary and the design review, one
above the other; and the newest site snapshot, when there is one. A bare
`/polishd` lands here; `?tab=analytics` still goes straight to Analytics.

- **Copy fix prompt** copies every problem both reviews found as one prompt
  for the coding agent working in your repo, and each review's **Copy
  prompt** copies just its half. Every problem comes with its evidence, the
  source file it was matched to, the suggested fix and any GitHub issue filed
  for it, plus instructions to verify against the code before changing it.
- The review cards are the same ones the Analytics and Design tabs render, so
  regenerate, ignore and file-bug all work here, and the prompt follows them:
  it's built at the click from what the cards show.
- The scheduled summary refresh (daily/weekly cadence) now also runs when the
  Overview loads, not only the Analytics tab.
- Dashboard telemetry labels a tab-less visit `/~polishd/overview` (it was
  `/~polishd/analytics`).

### Tables no longer scroll on a white scrollbar

The dashboard never told the browser it was dark, so any table wide enough to
scroll sideways — **Most-used features** and **Interactions by element** among
them — drew a light-theme scrollbar, a white bar across the bottom of a dark
card. Every scroll container in the dashboard now gets a dark thumb on a
transparent track, and native `<select>` menus and checkboxes follow the dark
theme too.

### AI findings sit in a scrolling row of cards

The summary's **Losses** and the design review's **Breaking the system** were
a column beside the wins, and every finding carries evidence, a source
location and its own buttons, so half a dozen of them made the list longer than
the rest of the card. The things you're meant to act on were the things you
had to scroll past.

- **Each finding is now a card in its own row** under the wins (or what's
  working), scrolling sideways, so the AI card stays the same height however
  many findings there are. Evidence sits at the top of each card and **File bug** /
  **Ignore** at the bottom, lined up across the row.
- The row shows a count, fades whichever edge has more, and gets arrow
  buttons once it overflows. It snaps card by card and can be scrolled with
  the keyboard. On a phone the next card peeks in from the edge.
- Ignoring a loss, giving a reason and undoing it all happen inside the
  card, as before.

### The codebase scan reads your GitHub repo, and comes after connecting it

The one-time codebase scan only ever read source from disk, so on a deployed
dashboard — any serverless host, where the bundle ships without its source
tree — it had nothing to read and failed every time. And setup asked for the
scan *before* GitHub, the one thing that could have given it the code.

- **Where the source isn't on disk, the scan reads the connected repo**: one
  tree listing of the default branch, then only the files the budget picks
  (the same ranking and caps as the disk scan, planned from file sizes before
  anything is downloaded). Local dev still scans the disk first, so it sees
  uncommitted work and costs no API calls.
- **Monorepos are handled.** The scan finds the Next.js app's folder in the
  repo, preferring the one whose `package.json` installs `@polishd/next`, so
  a repo with a library at its root and the site in `site/` scans the site.
  **Source folders** stay relative to the app.
- **Setup clubs GitHub and the scan into one step**, now four steps instead of
  five. Connect the repo, then choose **Scan the codebase** and **Create
  issues automatically** separately; each unlocks once what it needs is there
  (any source to read; a repo with issues enabled). Where the source *is* on
  disk, the scan can still run without GitHub. A failed scan stays on the step
  with GitHub's reason, to retry or switch off.
- The settled Settings tab lists GitHub above Codebase, its scan button
  works with a connected repo, and a profile read from GitHub says which repo
  it came from. The summary card's nudge points to connecting GitHub when
  there's nothing on disk to scan.

### Site snapshots are shot by Polishd's screenshot service

Production snapshot capture used to run a headless Chromium inside the host's
own functions: a serverless Chromium (`@sparticuz/chromium`) in every
install, and `outputFileTracingIncludes` in the host's `next.config` because
Next's tracing can't see the browser's files. That's gone. Shots are now taken
by **Polishd's screenshot service**, a separate deployment
(`shots.polishd.muskanvaswan.xyz`, source in `service/`), which the dashboard
calls straight from the owner's browser.

- **Page URLs and pixels pass through the service.** It loads each page of
  your site like a visitor would and returns the images; it doesn't store or
  log them. Its rate limiter keeps your site's hostname, and a hash of the
  caller's IP, for at most an hour.
- **It only shoots the site that asks**, as named by the browser's `Origin`
  header, and only public pages. Every connection its browser makes (the page,
  each subresource, each redirect hop) goes through a proxy that resolves DNS
  itself and refuses private, loopback, link-local, CGNAT and cloud-metadata
  addresses, then connects to the address it checked. Top-level navigation
  stays on your origin, and a page that redirects elsewhere is refused by name
  rather than shot.
- **It's rate-limited**: per site, per caller, and in total. Hitting a limit
  ends the run with a message saying whose limit it is and when to try again;
  the pages already shot are kept.
- **Images arrive as they're shot.** The gallery shows each one in a live grid,
  then stores it: on Vercel, uploaded straight from the browser to your Blob
  store with a presigned URL your server signs for that one file (no webhook,
  so no `BLOB_WEBHOOK_PUBLIC_KEY`); elsewhere, streamed to disk in chunks.
  Images are now WebP, much smaller than the old PNGs.
- **It asks first.** The first time Capture is pressed in production, a
  dialog explains the call (what the service sees, what it never gets, why
  it's harmless) and asks whether snapshots may use it. Allowing it starts
  the capture. The answer is kept per install. It can be reviewed later, and
  withdrawn with "Turn off".
- **Local captures shoot Polishd's dashboard tabs** when the Design tab
  measures them (an install reading dashboard telemetry, such as Polishd's
  own site). Production captures never do. A `/~polishd/<tab>` page is shot
  as the development dashboard's tab, and telemetry the captured dashboard
  would send is answered locally, so it never counts as usage.
- **Every off-grid padding gets pictured**, not just the 8 most used. A
  capture also hands each page's value searches out fairly, so values that
  never turn up no longer crowd out the rest of the list. Paddings came last,
  which is why their cards kept asking for another capture.
- **Value cards update after a capture**, without a reload. A value measured
  only on Polishd's own dashboard pages (an install reading dashboard
  telemetry), or on pages the snapshot didn't shoot, now says so instead of
  asking for another capture.
- **Three modes.** Local development (`next dev`, or a dashboard on localhost
  or a private address) is shot by your own Chrome, through the same capture
  loop, with nothing to agree to. Production with a Blob store (or a writable
  disk, self-hosted) and the owner's agreement uses the service; the section
  stays where it was. Anything else moves the section to the **bottom of the
  Design tab, turned off**, with the reason.
- **Clear messages** for the reasons the section is off: no Blob store, the
  service not allowed, `POLISHD_SNAPSHOT_SERVICE=off`. Also for the reasons a
  capture finds:
  - the site's CSP blocking the service or the Blob upload (with the
    `connect-src` entries to add);
  - a preview behind Vercel's Deployment Protection;
  - a site the service can't reach;
  - rate limits;
  - the service being down.
  
  A block found during a capture is kept per install, so the section stays
  off at the bottom, across reloads, until "Try again" gets a capture
  through. Production never falls back to a browser on the host.
- **Removed:** the `@sparticuz/chromium` optional dependency and the
  serverless capture path. No host should need `next.config` changes for
  snapshots; any `outputFileTracingIncludes` added for them can be removed.
  `maxDuration = 300` in the dashboard page stays useful for the AI analyses.
- Snapshots taken before this release still display.

### Recent errors are grouped and counted

The Recent errors list showed the last eight throws one row each, so a single
error firing in a loop filled the whole list and pushed everything else out.
Repeats of the same error now share one row, with a **count badge** for how
many times it was thrown across all pages; the row names the page it was last
seen on, and how many others it also hit. The list shows three errors and
collapses the rest behind **Show more**, which now reaches back to twenty
distinct errors instead of eight throws.

- An error is "the same" when its message, component and origin match — the
  page doesn't count, so a bug on every product page is one row. Third-party
  and unattributable errors keep their own rows and a dimmed badge.
- `getRecentErrors()` returns these groups: each `RecentError` gains `count`
  and `paths`, and `path`/`ts` are now its most recent sighting.

### Hover a one-off to see where it renders

The Design tab flags one-off type styles, colors and corner radii, and
off-grid paddings — but a flag only says *what* drifted, never *where*, and
"a 17px / 500 somewhere on /pricing" left the hunt to you. Hovering (or
focusing, or tapping) a flagged value now opens a card with a **picture of
the element that carries it**: ringed in the badge's amber, the rest of the
page dimmed, cropped wide enough to show the component it sits in — plus the
page, device and theme it was shot on.

- The pictures are taken by **Capture snapshot**. After each route's full
  shots, the same browser reloads the route, finds every flagged value's
  element with the client scanner's own rules, scrolls it into view and
  screenshots a crop around it. Matching is by value, not by a recorded
  selector, so the picture always shows the value really rendering at that
  size and theme. Usually that's one extra page load per route with flagged
  values, capped at 15 seconds per route.
- A value the capture looked for and never saw on screen — one that only
  renders after a click, or at a width snapshots don't shoot — says so on its
  card instead of showing a wrong crop. Values with no picture yet still list
  the pages they were measured on.
- Pictures are stored with the snapshot's shots (on disk, or in Vercel Blob
  when it's connected) and pruned with them. Polishd's own beacons from the
  extra page load are answered locally, so it never lands in the analytics as
  a visit. Snapshots captured before this release have no pictures; capture
  again to get them.

### Issues open in a drawer, rendered as the markdown they are

An issue body on the Issues tab used to be a raw `<pre>` dump behind a
"Show issue body" toggle — real GitHub-flavored markdown, displayed as if it
weren't. Clicking a row now opens a **right-side drawer** (the same pattern as
the sampled user journeys) with the full issue: title, state, the metadata
GitHub reports, the analytics evidence polishd kept, and the body **rendered
as markdown** — headings, code, linked file lists, tables, task lists,
screenshots.

- The renderer is written in-house (`src/dashboard/markdown-parse.ts` +
  `markdown.tsx`): the package's zero-runtime-dependency rule rules out
  `react-markdown`, and the GFM subset that actually appears in issues is
  small enough to own. Single newlines are hard breaks, the way GitHub
  renders issue comments, and anything unrecognized degrades to plain
  paragraph text rather than ever crashing. The grammar is pinned down by
  its own test file.
- Rows are still links to the tracker — the title goes to GitHub, the row
  goes to the drawer.

### The drawer can suggest the fix, not just show the bug

With the GitHub codebase connected, every filed issue carries a **"Suggest a
fix"** button. One click asks the configured model to first **classify the
bug — an interaction issue (something users do fails) or a design issue
(something users see is wrong)** — and then design a fix on the published
practice for that class: Nielsen Norman's usability heuristics and the
WAI-ARIA Authoring Practices for interaction bugs; WCAG 2.2 contrast rules,
spacing rhythm, and layout-stability guidance for design bugs.

- The suggestion is grounded in the repository's real source: the pipeline
  re-reads the files the issue body cites, code-searches the analytics
  evidence, and answers with an **implementation path** — ordered,
  file-by-file edits, each path linking to the file on GitHub — plus
  "grounded in" chips naming the guidelines it leaned on, so the advice can
  be judged by its sources.
- Suggestions are cached per issue in the store and load with the tab;
  regenerating is one click. Nothing is offered without a model key, and an
  issue polishd didn't file is refused — there's no evidence to ground.

### Design-review issues can be filed as bugs

The aesthetic review's "Breaking the system" list used to be read-only; the
same one-click **File bug** button the summary's losses have now sits on each
design issue when GitHub is connected. It runs the same verify-then-file
pipeline — the model checks the flagged design token (a hex color, a px value,
a page path) against the repository's source, files a GitHub issue with the
technical analysis and the review's own suggested fix when it holds up, and
answers "not a bug" with the reasoning when the code shows the value is
deliberate. Filed issues show up in the Issues tab like any other, dedupe on
their evidence citation, and render as their issue link when the tab reloads.

### Snapshot capture survives serverless time limits

Capturing a site snapshot on Vercel could fail with no error box at all — the
whole Design tab crashed into Next's error boundary. The cause: the capture ran
as **one long server action**, and a serverless host that hits its function
time limit kills the function mid-shoot, so the action rejects with no result
and the client had no catch for it. A connected Blob store couldn't help; the
request itself was the problem.

- **Capture is now chunked into one short server call per page**: begin → one
  call per route (both devices, both themes) → finish. No single request has
  to outlive a function time limit, so upgrading the package is the whole fix
  — no host configuration required. In-flight state is parked in the store
  between calls; the client contributes nothing but ids, and a new capture
  sweeps an unfinished predecessor, images included.
- **Failures degrade to messages everywhere.** Every action call is caught on
  the client (a page whose call fails is reported and skipped, not fatal),
  and every server path returns a diagnosis instead of throwing — including
  the previously uncaught `playwright-core` load.
- The capture button shows **per-page progress** ("Shooting page 3 of 7…").
- `polishd init` now writes `export const maxDuration = 300` into the
  dashboard page it generates, and the docs recommend it — headroom for heavy
  pages on hosts with strict limits, no longer a requirement.

### The dashboard streams instead of loading all at once

Every tab used to wait for its slowest query before sending a single byte —
click Analytics and the whole page arrived at the speed of the journeys
sampler. The page is now built on React Suspense streaming:

- The **chrome, header, and section titles render immediately**; each card
  shows a skeleton and fills in the moment its own data resolves, in whatever
  order the queries finish.
- Each Analytics section is its own async server component awaiting **only
  the queries it renders**, so a slow aggregate can't hold back a fast one.
  A per-request cache (`src/dashboard/data.ts`, React `cache()`) keeps
  sections that share inputs — the AI summary hashes the whole dataset for
  its staleness check — from re-running any query.
- The other tabs (Design, Issues, Installs, Settings) load behind the same
  skeleton the tab rail already shows while navigating, so the handoff from
  "navigating" to "loading data" is seamless.
- `PolishdDashboard` is unchanged for hosts that render it themselves from
  preloaded data; `createPolishdPage()` is what streams.

### Every Overview tile opens its own graph

The six numbers at the top of the Analytics tab were all-time totals, which
answer "how much" and never "when" — 37 rage clicks is a different problem if
they all landed on Tuesday. Each tile is now a button: clicking one opens a
bottom drawer with that metric bucketed over time.

- **Hourly or daily**, switchable in the drawer. Both series are computed on
  the server and travel together, so flipping granularity — or switching
  metric from inside the drawer — costs no round trip. Daily is the default
  once there's more than a day of history; before that a daily chart is one
  bar, and hourly is the only shape worth drawing.
- Every tile grows a **sparkline**, which is both the hint that there's a
  chart behind the number and the shape of it at a glance.
- The window ends at the **newest bucket that has data**, not at now, so an
  install last browsed three days ago still gets a chart instead of an empty
  one. It covers the last 48 hours or 30 days of activity; where that differs
  from the tile's all-time total, the drawer says so rather than leaving the
  reader to notice.
- Quiet buckets are drawn as **measured zeros**, not skipped — an empty night
  is a fact about the site, and dropping those points would silently compress
  the axis.
- **Sessions are never summed.** A visitor active across three hours is
  counted in all three buckets, so the drawer shows peak/average/latest for
  that metric and explains why there's no total.
- Reading a bucket works by pointer, by tap, and by keyboard (←/→, Home/End
  on the focused chart); the readout sits above the plot so it never covers
  the tallest bar, which is the one you were reaching for.
- Buckets start at the UTC hour or day, matching the existing per-page chart.
  A visitor whose clock is set to next year can't anchor the window there and
  blank the chart — the windowing rule lives in
  `src/shared/metric-buckets.ts`, pure and tested (`npm test`).

The bottom drawer itself, the info tooltip and the axis-tick maths are now
shared (`src/dashboard/drawer.tsx`, `src/dashboard/ui.tsx`) instead of copied
between the Top-pages table and this, which is what stopped the two charts
drifting apart.
### An Issues tab: every bug polishd filed, in one list

Filed issues used to exist only inside the loss that produced them — one
summary, one card, gone at the next regenerate. The dashboard grows an
**Issues** tab that lists them all, newest first, and appears only once a
GitHub repository is connected (nothing to list, and no way to list it,
otherwise).

- Each row joins two sources. The analytics **evidence**, the claim as the
  summary stated it, and the verdict the source verification reached are
  polishd's own record; the title, state, labels, assignees, comment count and
  body are read live from GitHub on every render, so a bug closed an hour ago
  reads as closed here.
- The issue log the dedupe already kept is what makes the list *ours* rather
  than the repo's — a repo full of other people's issues stays that way. New
  filings additionally record the claim, the verdict and the filing time;
  entries written by earlier versions have only a number and a URL and still
  render, dated from GitHub's own `created_at`.
- An issue that can no longer be read — deleted, transferred, token access
  revoked — keeps its row and says so, rather than quietly disappearing from
  a count you were trusting.
- Loading the tab is **one GitHub API call**, not one per issue. The repo's
  issue list returns whole issues, body and all, a hundred at a time, so a
  single page answers for every issue polishd has ever filed. Issue numbers
  only climb and the list comes back newest-first, so a page that has dropped
  below the oldest number we want proves no later page can hold it, and paging
  stops; anything buried past a three-page budget is read individually. The
  rule lives in `src/ai/issue-pages.ts` — pure, no network — with tests
  (`npm test`).

### Site snapshots now work in production

Capturing a snapshot on a serverless host used to fail on two fronts at once:
no browser to launch and no writable filesystem to keep the images on. Both
are now handled, and neither needs configuration beyond connecting a Vercel
Blob store to the project:

- When `BLOB_READ_WRITE_TOKEN` is present (Vercel injects it once a Blob store
  is connected), shots are staged in the system temp directory and uploaded to
  Vercel Blob instead of `.polishd/snapshots/`. Pruning deletes the blobs;
  a failed upload cleans up after itself so a half-stored snapshot never
  survives. Blob pathnames get a random suffix and the dashboard still serves
  every image through the auth-gated server action.
- When no local Chrome, Edge, or Playwright Chromium can launch on Linux,
  capture falls back to `@sparticuz/chromium` — a Chromium built to run inside
  Lambda-shaped sandboxes. It and `@vercel/blob` ship as optional
  dependencies, so a standard `npm install` brings them along and
  `--omit=optional` keeps them out.
- An install run with `--omit=optional` loses the feature but not the plot:
  when the environment shows a missing optional dependency will be needed
  (a Blob token with no `@vercel/blob`, a Vercel host with no
  `@sparticuz/chromium`), the gallery says so up front and disables the
  capture button, instead of failing a minute into a doomed run. Failures
  that can only surface at capture time name the missing piece precisely.
- A deployment with **no Blob store connected at all** gets the same
  treatment. Without the token, storage falls back to disk — which on a
  serverless host is read-only and gone by the next invocation, so every
  capture was doomed before it started and said only "is the filesystem
  writable?" a minute later. The gallery now names the actual gap and the
  one-time fix (connect a Blob store, redeploy) before the button is pressed,
  and the capture action refuses the same way for callers that never rendered
  the dashboard.
- Local development is unchanged: your own Chrome first, images on disk,
  same index, same gallery.

### Reading is not friction: text clicks and trivial scrolls stop counting

Three signals could report engagement or frustration where there was only
reading, inflating exactly the numbers the AI summary leans on hardest.

- **Dead clicks skip text.** A click inside a paragraph, heading, list item,
  or other prose block — or on standalone text long enough to read as content
  (40+ chars) — is cursor placement or the start of a selection, not a user
  expecting something to happen. It no longer records a `dead_click`. Clicks
  on non-interactive *layout* elements still do, and so do short standalone
  labels (`<div>Submit</div>`, `<span>Click here</span>`) — that shape is
  exactly what a mis-wired fake control looks like.
- **Rage clicks skip select-a-word/paragraph.** Double- and triple-clicking
  prose selects text; a rapid burst on a non-interactive text target no
  longer records a `rage_click`. Hammering a real button — or a fake one with
  a short label — still does.
- **History gets the same fix.** A one-time sweep (versioned via
  `polishd_meta`, run on the first dashboard load after upgrading) re-runs
  the new classification over already-stored `dead_click`/`rage_click` rows,
  using the stored selector path and label. Matching rows are retyped to
  `text_click` — kept in the table, counted by no aggregate — never deleted.
  Rage rows whose selector path contains an interactive element are left
  untouched. Ingest applies the same retype to arriving events, so a cached
  client bundle — or a telemetry emitter still on an older package — can't
  keep refilling the table with the old semantics after the sweep has run. Old `component_view` rows always carried a scroll depth, so at
  read time depth from components short enough to fit a typical viewport
  (≤700px) is ignored; page-level `scroll_depth` history is unaffected (a
  recorded depth needed a real scroll event, and genuine deep scrolls can't
  be told apart after the fact).
- **100% scroll requires somewhere to scroll.** A page (or dashboard region)
  whose scrollable distance is under 10% of the viewport reaches "100%" by
  existing, so it now records no `scroll_depth` at all; likewise
  `<PolishdMonitor content>` only reports scroll-through for components
  taller than one screen. Aggregates already treat absent as "no data" (shown
  as —), never 0.
- Both capture layers (host site and the dashboard's own telemetry) share the
  new classification via `src/client/dom.ts`, so they can't drift.
- The AI digest now omits scroll % where it wasn't measurable and the system
  prompt tells the model these semantics — no more "users read to the bottom!"
  wins on pages that fit in one viewport, and reported dead/rage counts can be
  taken as genuine friction.

### The "your proxy isn't running" banner stops crying wolf

A correctly installed, verifiably healthy site could show the red banner
indefinitely. The 0.2.2 rule compared an *all-time* drop total against an
all-time event total behind a one-hour recency gate, so the two halves covered
different time ranges: one fresh cookie-less batch — a crawler POSTing at the
public endpoint — re-armed every drop the install had ever recorded, including
the ones from before the proxy was first deployed. At the 1-in-400 ratio, 7
drops only needed fewer than 2,800 lifetime events to trip, which is most
personal sites for months.

- Drops are now bucketed by the hour, so the alert can compare drops and
  stored events over **the same 24-hour window**. Records written before this
  release carry no buckets, which means their history counts toward no window
  and cannot re-arm anything.
- The strongest signal is now the cheapest one: an event stored *after* the
  most recent drop proves the proxy is minting cookies right now, because
  every event is attributed to that cookie and a broken proxy drops every
  batch. No threshold to tune.
- Severity is split. Red — "your proxy isn't running" — is reserved for
  nothing stored at all, or nothing stored in the window while drops keep
  arriving. Otherwise the dashboard shows a neutral note: *N batches arrived
  without a session cookie (bots, or visitors with cookies blocked) — X% of
  traffic*, which is useful and true.
- "so nothing is being stored" only renders when nothing has been stored. It
  used to sit directly above stat tiles counting stored sessions and events.
- The banner now points at `doctor --url <origin>` and says why: plain
  `doctor` reads the source tree, so it can pass every check while a deployed
  build still doesn't mint a cookie. Sending someone to a command that
  answers "12 checks passed" was most of what made this alert expensive.
- The 60-second write collapse in `recordNoSession()` survives cold starts.
  Its counters were module-level, so serverless reset them on every
  invocation and the sparse traffic the throttle exists to absorb persisted
  roughly 1:1; the durable `lastAt` now gates the write too.
- The rule lives in `src/shared/capture-status.ts` — pure, no database, no
  React — with tests (`npm test`).

### Site snapshots on the Design tab

The Design tab grows a **Site snapshots** card: one click screenshots every
scanned route of the site — phone and desktop, light and dark — and renders
the shots as a filterable gallery with a full-page lightbox. Capture runs
through the new `allpages` dependency (Playwright underneath), launching the
developer's own Chrome/Edge before falling back to Playwright's Chromium, and
never auto-downloads a browser. The origin is learned from the request that
rendered the dashboard (`POLISHD_SITE_ORIGIN` overrides); shots land under
`.polishd/snapshots/` (`POLISHD_SNAPSHOT_DIR` overrides, last 6 runs kept)
with only an index in the store, and every image travels to the browser
through an auth-guarded server action rather than a new public route. Each
snapshot is stamped with the design-metrics fingerprint at capture time — the
hook for before/after visual diffing as design suggestions get applied. This
is the package's first runtime dependency beyond the optional `pg`.

### Errors are attributed to the code that threw them

`window` hears every throw in the tab, so an extension's failures — "Failed to
connect to MetaMask" being the canonical one — arrived as `js_error` events
indistinguishable from real bugs, often as the loudest error on the dashboard.

Rather than match error text, the client now works out *whose script threw*.
Resource Timing records every script the document actually fetched; extension
code is absent from it, because the browser injects content scripts and the
page never requested them. Comparing an error's stack against that live set
identifies injected code without knowing what it's called, so a new extension
needs no new pattern. Four verdicts come out: `site` (every frame is code you
shipped), `extension` (a frame names an extension URL scheme, including blobs
an extension minted at runtime), `foreign` (a frame names a script this
document never loaded), and `unknown` (nothing attributable — an opaque
cross-origin `Script error.`, an empty stack).

Only `extension` is dropped. `foreign` and `unknown` are kept, tagged with
`meta.origin`, and shown dimmed in Recent errors as "not your code" /
"unattributable" — a filter that silently eats what it can't identify is how a
real bug goes missing. A short list of message patterns remains as a last
resort for extension plumbing that throws with no attributable frame at all.

The drop also runs at ingest (a cached bundle can predate the filter, and the
endpoint is a public POST) and on the way out of `getRecentErrors`, so rows
written before this stop showing up too. New `ignoreErrors` config option —
strings matched case-insensitively, or regexes — drops anything else you've
decided not to chase.

### Telemetry answers the product questions clicks can't

The dashboard telemetry emitter now sends one `install_state` event per
session — whether a model is connected and which provider/model, resolved
server-side, never the key — and the consent prompt discloses it. On the
collecting side, the Installs tab grew a "With a model" stat and a per-domain
Model column built from each install's latest report, so connecting,
switching, or disconnecting a model reads correctly.

The dashboard's own controls also carry `data-component` names now
(`ai-summary-refresh`, `ai-summary-generate`, `ai-connect-model`,
`journey-open`, `loss-file-bug`, `loss-ignore`, `design-review-refresh`,
`settings-scan-codebase`, `show-more`, coarse `settings`/`ai-summary`
containers, …), so with `POLISHD_ANALYTICS_SOURCE=telemetry` the collector's
Most-used-features table groups dashboard clicks by feature instead of raw
selectors — the same component-level story polishd tells its hosts, told
about itself. The attributes are inert for host apps.

## 0.2.2

### Cross-install telemetry ingest

A new `@polishd/next/telemetry` entry point exports a CORS-enabled ingest
route for collecting telemetry *from other polishd installations* — the
foundation for polishd dogfooding its own dashboards. Unlike the first-party
route, it answers preflights, accepts POSTs cross-origin, and splits identity
between body and headers: the session id is client-minted (the httpOnly
session cookie never crosses origins), while the *installation* is identified
by its hostname, derived server-side from the browser-set Origin header —
which page script cannot forge. Events land tagged with that hostname in an
`install_id` column — new, nullable, migrated automatically on both backends —
so one shared database can tell installations apart and name them by domain.
Nothing sends to this endpoint yet; the dashboard-side emitter and its
opt-in consent flow ship separately.

### The dashboard dogfoods itself — with consent

The dashboard now asks, once, whether it may share anonymous usage of
*itself* with the polishd project. Opt-in and off by default: say no and it
never asks again; say yes and a small emitter records clicks (with the same
rage/dead classification the host capture layer uses, via newly shared DOM
helpers), tab views, and one viewport sample — namespaced under `/~polishd/…`
paths, reported under the site's own domain (the disclosed, Origin-derived
install identity), and suspended the instant the URL leaves the dashboard. Nothing from the host site is ever sent: not its analytics,
not its visitors, not its URLs. `POLISHD_TELEMETRY=off` kills the feature
(prompt included), `POLISHD_TELEMETRY_ENDPOINT` redirects it for testing, and
`navigator.doNotTrack` is honored regardless of stored consent. Batches
travel as `text/plain` so the cross-origin POST stays preflight-free and
beacon-compatible.

### An Installs tab, and telemetry kept out of the host's analytics

On the collecting side, telemetry is a different dataset and now reads like
one. Tagged rows are filtered out of `polishdEventsSource()` — the choke
point every first-party query goes through — so remote dashboard usage can
never count as the collector's own sessions, rank among its pages, or feed
its AI digest. Instead it gets a dedicated **Installs** tab: one row per
reporting domain with sessions, tab views, clicks, rage/dead clicks and last
seen, plus which dashboard tabs get used across the fleet. The tab only
renders on installations whose database actually holds telemetry — for the
senders, it would only ever be an empty screen.

### The full dashboard experience, over telemetry

A collector that cares about the dashboard-usage story more than its own
traffic can now flip one env var — `POLISHD_ANALYTICS_SOURCE=telemetry` —
and the *entire* dashboard reads the cross-install dataset: Analytics,
journeys, element breakdowns, device sizes, the Design tab, and the AI
summary, all through the same single source function the separation uses.
First-party events keep being captured and stored, just not shown, so the
switch is losslessly reversible.

To make that experience complete, the telemetry emitter now also captures
scroll depth (of the dashboard's own scroll container — the document never
scrolls under the shell), JS errors raised while the dashboard is up, and one
design scan of the dashboard per tab per session. `scheduleDesignScan` grew an
options form for this: a caller-supplied staleness check for namespaced path
labels, and a `scanDashboard` flag that lifts the "never measure the
dashboard" guard for the one caller whose target it is. On the collecting
side the Design tab therefore reviews the dashboard's own design as real
installs render it.

### Design findings read as colors and percentages, not raw tokens

A contrast finding used to arrive as a line of citations: `#ffffff text on
#ecae12 is 1.98:1 at 13.5px and #f5f5f5 text on #a17321 is 3.86:1 at 15px`,
set in 10px mono. Two things in that sentence are unreadable on sight — a hex
is a color nobody can picture, and `1.98:1` is a point on an open-ended scale
only accessibility people carry in their head.

**Hexes now render as swatches** wherever a design finding quotes one: the
deterministic flags, the model's evidence and suggestion, its assessment and
strengths, and the contrast rows. The code stays next to the swatch, because
that's what you search the codebase for — and the chip is a button: hover or
focus turns the swatch itself into a copy glyph, and a click puts the hex on
the clipboard and shows a tick. Swapping the swatch rather than revealing a
second icon keeps the chip one fixed width, so there's no slot sitting empty at
rest and no row of chips jumping as the pointer crosses it. Opened over plain
http on a LAN address, where there is no Clipboard API at all, it falls back to
the old selection trick and says so on the chip if even that fails.

**Ratios render as a 0–100% contrast score.** The scale is logarithmic, so the
steps read evenly instead of bunching every real pairing into the bottom fifth:
1:1 is 0%, AA's 4.5:1 lands at 49%, 21:1 is 100%. The exact ratio moves into
the tooltip rather than disappearing. Failing pairs are tinted red (clears
nothing) or amber (clears large text only); anything at AA stays neutral, since
these sentences quote the threshold as often as the measurement.

Each failing pair also gets a **meter** — the score as a bar, with a tick at
the level that text size actually needs — replacing `1.98:1 (needs 4.5:1 at
13.5px)`. The evidence and suggestion boxes went from 10px mono to 12px prose
with a real line height; only the tokens stay monospaced.

The **warning banner above the contrast table is gone**. It restated the rows
underneath it pair for pair, which was tolerable when the rows were dense
numbers and redundant once they weren't. The flags themselves stay in the data
— the AI digest reads them, with the page each failure was seen on.

Rewriting happens at render time. Stored flags, evidence strings and the AI
digest keep their verbatim numbers, because the review pipeline verifies an
issue by matching its citation against the digest it sent — so no cached review
is invalidated by this.

## 0.2.1

### Losses can be ignored, and the model remembers why

A loss had one answer next to it — **File bug** — and no way to say the other
thing: that it isn't a problem. Nothing recorded that judgement, so the next
regenerate found the deliberate two-step checkout again, and again.

**Ignore** now sits beside File bug on every loss. One click, no explanation
required: the loss leaves the card, leaves the cached summary immediately, and
is dropped from every later summary *before* the four-loss cap applies — so
dismissing one promotes the next real problem into its place rather than
leaving a gap.

A **reason** is optional and offered after the dismissal, so the fast path
stays one click. Give one and it's replayed to the model verbatim on every
later call, alongside the problem it dismissed — context the analytics digest
can't carry ("the second CTA is deliberate", "that page is staff-only"). The
model is told not to re-report a dismissed problem under any wording, and to
read the rest of the data taking the stated reason as true. Reasons can be
edited afterwards, and **Undo** puts a loss back where the model can find it
again.

Dismissals key off the same evidence citation the GitHub issue log uses, so a
problem refound under different wording is still recognised as the one you
already reviewed. They fold into the summary fingerprint too: ignoring
something marks the summary stale exactly like new analytics does, so the next
refresh really does re-ask the model.

### Setup moved out of the way, into a Settings tab

The first screen of the dashboard was also its setup form. Provider, key, site
description, codebase profile and GitHub all lived behind a gear on the
analytics summary card — which pushed the actual analytics down the page, and
left the Design tab telling people to go and find "the Analytics tab's summary
card" to configure a model it uses too.

All of it now lives in a third sidebar tab, **Settings**, grouped into Model /
Your site / Codebase / GitHub with one save. First-run onboarding runs there as
well, and finishing it drops you on Analytics with your first summary. The
summary card keeps only the story and a gear that jumps to Settings; the one
piece of setup still worth seeing next to a summary — whether the model has
actually read your codebase — stays as a one-line nudge.

### Switching tabs responds immediately

Each tab is a full server render, so clicking "Design" used to do nothing
visible for a second or two, which reads as a dead button and gets clicked
again. The tab rail now answers on the click: the tab you picked highlights
straight away, its icon becomes a spinner, further clicks on it are ignored,
and the content column shows a skeleton until the render lands. Cross-tab links
inside a tab behave identically, and the dashboard's own scroll container
returns to the top rather than dropping you halfway down the new tab.

Links are still real anchors — ⌘-click and middle-click open a tab as before,
and with JavaScript off the rail falls back to ordinary navigation.

### A dashboard mounted off `/polishd` no longer reads itself back

The read side of the dashboard (its own queries) previously excluded only the
*default* route, so an app that mounted the dashboard elsewhere — say
`/polish` — saw its own dashboard traffic ranked among the site's pages, and
the Design tab could measure the dashboard's design as the site's. The route
now resolves dynamically everywhere:

- `createPolishdPage({ config })` — pass the same config you thread into
  `initPolishd()` and `createPolishdRoute()`; the page registers
  `dashboardRoute` for the queries running in the same runtime.
- `POLISHD_DASHBOARD_ROUTE` — the no-code channel; ingest and the queries
  both read it.
- The design scanner also recognizes the dashboard by its `.polishd-root`
  scope element, so it never measures the dashboard regardless of
  configuration.

Because the exclusion is applied at read time, dashboard rows captured before
this fix disappear from the stats without touching the database.

### Quieter, truer signals

- The "your proxy isn't running" banner no longer fires over a handful of
  cookie-less batches on a site that is otherwise storing events fine (bots,
  a cookie-blocking visitor, someone's curl test). It now requires the drops
  to be recent **and** material relative to stored volume — or a store with
  nothing in it at all, which is the real broken-proxy signature.
- The Design tab's per-section findings render as one combined note instead
  of a stack of alert boxes.
- Long lists (type styles, colors, contrast failures, radii, spacing, pages)
  collapse behind "Show more" past 5 rows.
- Dashboard tabs navigate client-side — switching tabs swaps the content
  without reloading the whole page.

### Design review — a new dashboard tab

The dashboard now has a sidebar with two tabs: **Analytics** (everything it
showed before) and **Design**, a new aesthetic layer. The Design tab renders
your site's brand guideline *reverse-engineered from the rendered pages*:

- **Typography** — every font family / size / weight combination actually in
  use, shown as specimens with real text sampled from the site.
- **Color palette** — the colors your pages paint, laid out like a brand
  palette and weighted by how much of the UI they cover, split by role
  (text / background / border).
- **Contrast** — every text-on-background pairing measured against WCAG AA,
  failures shown with live samples.
- **Corner radii and spacing** — the rounding and padding scales in use.

Each section flags what breaks the system deterministically — no model
involved: font-size sprawl (16 sizes is not a type scale), extra families,
near-duplicate colors (`#fefefe` next to `#ffffff`), contrast failures,
one-off values that appear on a single page, and padding that drifts off a
4px grid.

On top of the measured metrics, an **Aesthetic review** card asks the same
model you configured for the analytics summary how coherent the design reads
— strengths, and evidence-cited issues with concrete fixes. Like the summary,
it is fingerprint-cached: reopening the tab is free, and regenerating with
unchanged metrics never spends tokens. Refresh buttons for both the metrics
and the analysis sit on the tab.

Nothing new to wire up: pages measure their own rendered design once per
visitor session (a compact few-KB tally, sampled after the page settles) and
the data flows through the existing ingest route and store. The dashboard
itself is never scanned. Existing installs only need the new package version.

## 0.2.0

Everything in this release came out of the first real third-party integration of
the package, and most of it is the same underlying problem: Polishd assumed
things about the host app that it never checked and could not see.

### Upgrading from 0.1.x

**Styling keeps working with no changes.** Your existing `@source
".../@polishd/next/dist"` still compiles the dashboard's utilities exactly as
it did, so upgrading will not leave you with an unstyled page. Verified by
rendering the dashboard both ways: 491 elements, no visible differences.

There is **one required change**, and it is about access, not styling.

**Decide how the dashboard is protected in production.** It now refuses to serve
unless you have chosen one:

```bash
POLISHD_DASHBOARD_TOKEN=$(openssl rand -hex 32)   # built-in gate, no code
```

or pass your own `authenticate` to `createPolishdPage()`, or opt out explicitly
with `POLISHD_DASHBOARD_PUBLIC=true`. Development is unaffected.

Then run `npx @polishd/next doctor`, which checks that and much else.

#### Optional: move to the shipped stylesheet

Recommended, but at your own pace. **Order matters** — add the import first, and
only then remove the old wiring, so the dashboard is never unstyled in between:

1. Add to `app/polishd/page.tsx`:
   ```tsx
   import "@polishd/next/dashboard.css";
   ```
2. Confirm the dashboard still looks right.
3. *Then* delete the `@source ".../@polishd/next/dist"` line from your Tailwind
   entry stylesheet (or the `content` glob in `tailwind.config.*`).

Doing this drops Tailwind as a requirement for your app and stops your build
compiling utilities only the dashboard uses. `doctor` reports which of the two
setups it finds, and never calls a working 0.1.x setup broken.

#### If you are on Next 15, check this

0.1.0's CLI wrote `proxy.ts` regardless of the installed Next major, and **Next
15 does not load that file**. If you are on Next 15 your proxy has never run:
no session cookie, every beacon returning 200, and nothing captured, with no
error anywhere to show for it. Rename it to `middleware.ts` and rename the
exported function to `middleware`. `doctor` reports this explicitly.

### Breaking

- **The dashboard fails shut in production.** With no `POLISHD_DASHBOARD_TOKEN`,
  no `authenticate` callback and no `POLISHD_DASHBOARD_PUBLIC=true`, production
  renders a locked screen and every AI server action denies. Previously the
  default was open, and the warning about it was suppressed in production —
  exactly where it was worth acting on. The dashboard's settings can change the
  configured model and API base URL, so an open one is arbitrary spend on the
  owner's key, not merely an analytics leak.
- **The dashboard renders in its own shell** (`position: fixed`, own background
  and scroll container) rather than inheriting the host page. Pass
  `shell: false` to `createPolishdPage()` for the old behaviour.

### Added

- **`npx @polishd/next doctor`** — checks the wiring that fails silently: the
  proxy named and exported for the installed Next major, `config.matcher` as an
  inline literal excluding `/api`, `runtime`/`dynamic` declared rather than
  re-exported, the stylesheet import, access posture, Node version.
  `--url <origin>` adds live checks that the cookie is minted and events store.
- **Built-in token auth.** Setting `POLISHD_DASHBOARD_TOKEN` is the whole
  integration for an app with no auth of its own — no import, no page edit. The
  token is exchanged for an httpOnly, path-scoped cookie by a server action, so
  it never appears in a URL, in history, in logs or in a `Referer` header. The
  cookie holds an HMAC rather than the token, comparison is constant-time,
  expiry is enforced server-side, and the unlock form is rate limited.
  `polishdTokenAuth()` is exported for hosts that want to configure it.
- **`dist/dashboard.css`** — the dashboard ships its own stylesheet, compiled at
  publish time. Tailwind is no longer required in the host app.
- **`composePolishd(handler, { matcher })`** — for apps that already have a
  proxy. Declaring the handler's original scope re-applies it as an internal
  guard, so widening `config.matcher` to the union doesn't silently start
  running your handler on every request in the app.
- **`authenticate` receives the request context** (`cookies`, `headers`), so
  callbacks are ordinary functions of their inputs and testable without a live
  request. Zero-argument callbacks keep working unchanged.
- **`POLISHD_SESSION_COOKIE`** — read by both the proxy and the ingest route, so
  renaming the cookie cannot go half-applied.

### Fixed

- **`--force` destroyed hand-written proxies.** Both the exists-guard and the
  merge hint were skipped under the flag, so a user who passed it to regenerate
  an unrelated file lost their real proxy wholesale. Generated files now carry a
  sentinel; files the CLI did not author are never overwritten, with or without
  `--force`, and its own files are backed up to `.bak` before regenerating.
- **The CLI ignored the installed Next major**, always writing `proxy.ts`. On
  Next 15 — a supported version — that file never runs: no session cookie, every
  beacon still 200, nothing stored, no error anywhere. It now resolves the
  installed version and picks the filename and exported function to match.
- **The merge hint keyed off the wrong filename**, so the Next 16 collision —
  the one that actually happens — got no guidance and only `--force` as a
  remedy, which was the data-loss bug above.
- **A missing session cookie is no longer silent.** Ingest records the rejection
  in `polishd_meta`, the dashboard shows a banner naming the expected proxy
  filename per Next major, and the client warns once in the dev console.
- **`--dry-run` under-reported**, omitting the `.gitignore` change.
- **`polishd.config.ts` was documented as being loaded automatically.** Nothing
  imports it; it cannot be auto-loaded, because the three consumers run in three
  runtimes and the Edge one has no filesystem. The docs now say what actually
  has to happen.

### Also

- Node `>= 22.5.0` is checked by the CLI rather than left to a confusing
  "cannot find module `node:sqlite`" at first request.
- `bin/` is included in the published files. npm auto-includes the bin entry but
  not the modules it imports, so the CLI would otherwise have shipped broken.
- Docs carry a paste-ready prompt pointing a coding agent at `AGENTS.md`, in the
  README, `docs/SETUP.md` and `polishd --help`.

## 0.1.0

Initial release.
