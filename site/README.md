# polishd-site

Landing page for **[@polishd/next](https://www.npmjs.com/package/@polishd/next)** —
a Next.js (App Router) app, fully static, no data source.

```bash
npm install
npm run dev      # http://localhost:3000
```

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Static production build (prerenders `/`) |
| `npm run start` | Serve the build |
| `npm run typecheck` | `tsc --noEmit` |

Deploy anywhere that runs Next — Vercel picks it up with the root directory set
to `site/`.

## The story the page tells

Shipping is cheap now, so working software is no longer the bar — taste is. The
page argues that in one arc, then shows the loop that gets you there:

**track → measure → analyse → surface → experiment → verify → ship, or repeat.**

Stages 01–04 ship today; 05–06 are in build. Every stage on the page carries its
own `Live` / `In beta` status, and the frontier section says outright that the
API for the unshipped half isn't settled. Nothing claims to exist that doesn't.

| Section | Does |
|---|---|
| `hero` | The thesis — *Build fast, refine relentlessly* |
| `loop` | The centrepiece — the six-stage ring |
| `proof` | The shipped half, as real dashboard output |
| `frontier` | Stages 05–06, drawn dashed |
| `install` | Three commands |
| `closing` | *Make your website look polishd* |

## How it's put together

Tailwind v4, with design tokens taken straight from the package's own dashboard
(`src/dashboard/index.tsx`): `#000` page, `#0a0a0a` cards, `#2e2e2e` hairlines,
11px/`0.08em` uppercase labels, tabular numerals, and the same red / amber /
emerald / blue / violet accents.

- `components/loop-ring.tsx` — the ring. Six nodes; the shipped arc is solid and
  the beta arc dashed. A white arc travels the shipped stretch and an amber one
  continues into beta, closing the circle on the last stage.
- `components/sections/loop.tsx` — the only stateful section. An observer band
  across the middle of the viewport decides which stage you're reading; the ring
  is sticky beside it on `lg`, and sits above the stage list on smaller screens.
- `components/scroll-fx.tsx` — one page-wide observer that reveals anything
  tagged `className="r"`, counts up `[data-count]` figures and fills `.fill`
  meters. Elements already scrolled past on load reveal instantly rather than
  staying hidden.
- Reduced motion is honoured, and a `<noscript>` block unhides everything for
  visitors without JS.

The dashboard numbers in `proof` are illustrative — they mirror a real Polishd
install so the layout is shown at realistic density.
