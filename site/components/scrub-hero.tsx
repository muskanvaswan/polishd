"use client";

import { useEffect, useRef } from "react";

/**
 * The hero graphic: a shoe-polish brush scrubbing the wireframe of a website,
 * drawn entirely in text. The wireframe sits on the page at ghost opacity —
 * the unfinished build — and wherever the bristles pass, the same characters
 * come up to full white. Polish, literally.
 *
 * Three stacked <pre> layers share one character grid: the dim wireframe, a
 * bright copy masked to the scrubbed cells, and the brush sprite. A fourth
 * carries the sparkle pass at the end of each loop. Everything is positioned
 * in character units, so one container-query font-size scales the whole scene.
 */

const COLS = 76;
const ROWS = 34;

/* -- The website, before polish --------------------------------------------
   A browser frame around the usual anatomy: nav, hero copy, a media block,
   three cards, a footer. Drawn once, kept exactly COLS wide. */

const WIREFRAME = [
  "+--------------------------------------------------------------------------+",
  "| o o o  +---------------------------------------------------------+   =   |",
  "+--------+---------------------------------------------------------+-------+",
  "|                                                                          |",
  "|  ******      ----   ----   ----   ----                    +----------+   |",
  "|                                                           +----------+   |",
  "|                                                                          |",
  "|                                                                          |",
  "|  ############################         +-------------------------------+  |",
  "|  ####################                 |   \\                       /   |  |",
  "|                                       |     \\                   /     |  |",
  "|  -------------------------------      |       \\               /       |  |",
  "|  -------------------------            |          \\         /          |  |",
  "|                                       |             \\   /             |  |",
  "|  +----------+  +----------+           |               X               |  |",
  "|  | ======== |  | ········ |           |             /   \\             |  |",
  "|  +----------+  +----------+           |          /         \\          |  |",
  "|                                       |       /               \\       |  |",
  "|                                       |     /                   \\     |  |",
  "|                                       |   /                       \\   |  |",
  "|                                       +-------------------------------+  |",
  "|                                                                          |",
  "|  +---------------------+  +---------------------+  +-------------------+ |",
  "|  |  **                 |  |  **                 |  |  **               | |",
  "|  |                     |  |                     |  |                   | |",
  "|  |  --------------     |  |  --------------     |  |  ------------     | |",
  "|  |  ----------         |  |  ----------         |  |  ----------       | |",
  "|  |  --------------     |  |  ----------         |  |  ------------     | |",
  "|  |                     |  |                     |  |                   | |",
  "|  +---------------------+  +---------------------+  +-------------------+ |",
  "|                                                                          |",
  "+--------------------------------------------------------------------------+",
  "|  ****            ---- ---- ----                            o  o  o       |",
  "+--------------------------------------------------------------------------+",
].map((row) => row.padEnd(COLS, " ").slice(0, COLS));

/* -- The brush -------------------------------------------------------------
   Flat wooden back, ferrule, bristles — the Saphir silhouette, five rows tall.
   The bottom row is the contact line. */

const BRUSH = [
  " .__________. ",
  " |##########| ",
  " '----------' ",
  "  ||||||||||  ",
  "  ''''''''''  ",
];
const BRUSH_W = BRUSH[0].length;
const BRUSH_H = BRUSH.length;

/* -- Choreography ----------------------------------------------------------
   The brush works the page in horizontal bands, serpentine like someone
   actually polishing a surface, then the shine settles and the loop resets. */

const BAND_H = 4;
const FIRST_ROW = 0; // start on the browser chrome — polish everything
const BANDS = Math.ceil((ROWS - FIRST_ROW) / BAND_H);
const BAND_SECONDS = 1.2;
const SHINE_SECONDS = 1.6;
const DULL_SECONDS = 0.6; // the shine fades back to the unfinished build
const WIGGLES = 6; // back-and-forth scrubs per band

const ease = (t: number) => t * t * (3 - 2 * t);
const hash = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

export default function ScrubHero() {
  const rootRef = useRef<HTMLDivElement>(null);
  const brightRef = useRef<HTMLPreElement>(null);
  const brushRef = useRef<HTMLPreElement>(null);
  const shineRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const bright = brightRef.current;
    const brush = brushRef.current;
    const shine = shineRef.current;
    if (!root || !bright || !brush || !shine) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) {
      // No animation: show the site already polished, brush at rest.
      bright.textContent = WIREFRAME.join("\n");
      brush.style.display = "none";
      return;
    }

    const polished = new Uint8Array(COLS * ROWS);
    let raf = 0;
    let start = performance.now();
    let loop = 0;
    // Paused until the observer first sees the scene; the clock stands still
    // while it's off screen, so the brush resumes mid-stroke, not mid-skip.
    let pausedAt: number | null = start;

    const render = (now: number) => {
      const t = (now - start) / 1000;
      const scrubTotal = BANDS * BAND_SECONDS;

      if (t < scrubTotal) {
        // -- Scrub phase --
        const band = Math.min(BANDS - 1, Math.floor(t / BAND_SECONDS));
        const u = (t - band * BAND_SECONDS) / BAND_SECONDS;
        const ltr = band % 2 === 0;

        // Travel across, with the scrubbing oscillation riding on top.
        const sweep = ease(u) * (COLS + BRUSH_W) - BRUSH_W;
        const wiggle = Math.sin(u * Math.PI * 2 * WIGGLES) * 2.5;
        const x = (ltr ? sweep : COLS - BRUSH_W - sweep) + wiggle;
        const bandTop = FIRST_ROW + band * BAND_H;
        const y = bandTop - (BRUSH_H - 2) + Math.sin(u * Math.PI * 2 * WIGGLES * 2) * 0.3;

        // Everything behind the bristles is polished. Marking the full swept
        // region every frame (not just the cells under the brush right now)
        // keeps the trail gapless even when the tab stalls and frames drop.
        for (let row = 0; row < bandTop; row++) {
          for (let col = 0; col < COLS; col++) polished[row * COLS + col] = 1;
        }
        const trail = Math.round(x);
        for (let row = bandTop; row < Math.min(ROWS, bandTop + BAND_H); row++) {
          const from = ltr ? 0 : Math.max(0, trail + 2);
          const to = ltr ? Math.min(COLS - 1, trail + BRUSH_W - 3) : COLS - 1;
          for (let col = from; col <= to; col++) polished[row * COLS + col] = 1;
        }

        brush.style.transform =
          `translate(${x * 0.6}em, ${y * 1.3}em) rotate(${wiggle * 0.8}deg)`;
        brush.style.opacity = "1";
        shine.textContent = "";
      } else if (t < scrubTotal + SHINE_SECONDS) {
        // -- Shine phase: the brush lifts away and the surface glints. --
        polished.fill(1); // whatever frames were dropped, the job is done
        const u = (t - scrubTotal) / SHINE_SECONDS;
        brush.style.opacity = String(Math.max(0, 1 - u * 3));
        brush.style.transform =
          `translate(${COLS * 0.54}em, ${(FIRST_ROW + (BANDS - 1) * BAND_H) * 1.3 - u * 4}em) ` +
          `rotate(-8deg)`;

        const rows: string[] = Array.from({ length: ROWS }, () => "");
        const frame = Math.floor(t * 9); // twinkle
        let s = "";
        for (let i = 0; i < 14; i++) {
          const col = Math.floor(hash(loop * 31 + i * 7.3) * (COLS - 4)) + 2;
          const row = Math.floor(hash(loop * 17 + i * 3.1) * (ROWS - 4)) + 2;
          if (WIREFRAME[row][col] !== " " && (frame + i) % 3 !== 0) {
            rows[row] = rows[row].padEnd(col) + (i % 2 ? "+" : "*");
          }
          s = rows.join("\n");
        }
        shine.textContent = s;
      } else if (t < scrubTotal + SHINE_SECONDS + DULL_SECONDS) {
        // -- Dull: the finished surface fades back down to the wireframe, so
        // the next pass doesn't open on the whole page snapping dark. --
        const u = (t - scrubTotal - SHINE_SECONDS) / DULL_SECONDS;
        bright.style.opacity = String((1 - u) ** 2); // ease-out: an exit
        brush.style.opacity = "0";
        shine.textContent = "";
      } else {
        // -- Reset: wipe the polish and start the next pass. --
        polished.fill(0);
        bright.style.opacity = "1";
        start = now;
        loop++;
      }

      // The bright layer is the wireframe, masked to the polished cells.
      let masked = "";
      for (let row = 0; row < ROWS; row++) {
        const line = WIREFRAME[row];
        for (let col = 0; col < COLS; col++) {
          masked += polished[row * COLS + col] ? line[col] : " ";
        }
        if (row < ROWS - 1) masked += "\n";
      }
      bright.textContent = masked;

      raf = requestAnimationFrame(render);
    };

    // Only run while the scene is on screen: past the hero it would just be
    // rebuilding text nobody sees, on the main thread the rest of the page's
    // scroll effects share.
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && pausedAt !== null) {
        start += performance.now() - pausedAt;
        pausedAt = null;
        raf = requestAnimationFrame(render);
      } else if (!entry.isIntersecting && pausedAt === null) {
        cancelAnimationFrame(raf);
        pausedAt = performance.now();
      }
    });
    io.observe(root);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      role="img"
      aria-label="A shoe-polish brush scrubbing a website wireframe until it shines"
      className="pointer-events-none relative select-none overflow-x-clip [container-type:inline-size]"
    >
      {/* One shared type spec: JetBrains Mono is exactly 0.6em wide per char,
          so this font-size makes COLS characters fill the container. */}
      <div
        className="relative mx-auto w-max font-mono leading-[1.3]"
        style={{ fontSize: `${(100 / (COLS * 0.6)) * 0.985}cqw` }}
      >
        <pre aria-hidden className="text-[#555]">
          {WIREFRAME.join("\n")}
        </pre>
        <pre ref={brightRef} aria-hidden className="absolute inset-0 text-white" />
        <pre ref={shineRef} aria-hidden className="absolute inset-0 text-[#f5e17a]" />
        <pre
          ref={brushRef}
          aria-hidden
          className="absolute left-0 top-0 text-[#f5e17a] opacity-0 will-change-transform"
        >
          {BRUSH.join("\n")}
        </pre>
      </div>
    </div>
  );
}
