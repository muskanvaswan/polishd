// Seeds a Queuebird deployment with traffic for its dashboard to describe.
//
// templates.json holds seven real visits to this site, exactly as
// @polishd/next's own capture recorded them (desktop and phone; copying the
// install command, trying the code tabs and the Yearly switch, reading the
// docs, leaving early). This replays them as many sessions over the last two
// weeks by POSTing to the ingest route the way a browser does. Every event is
// one the package recorded; only the session ids and the times are new.
//
//   npm run seed                                   # http://localhost:3300
//   ORIGIN=https://demo.polishd.site npm run seed
//
// Run it once, against an empty store. SESSIONS (default 200) sets how many.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const ORIGIN = (process.env.ORIGIN ?? "http://localhost:3300").replace(/\/$/, "");
const SESSIONS = Number(process.env.SESSIONS ?? 200);
const DAYS = 14;
const T = JSON.parse(readFileSync(new URL("./templates.json", import.meta.url), "utf8"));

// How often each recorded visit is replayed, out of 100.
const MIX = [
  ["desktop-bounce", 28],
  ["phone-bounce", 22],
  ["desktop-convert", 14],
  ["desktop-copy", 12],
  ["desktop-explore", 10],
  ["desktop-pricing", 8],
  ["phone-pricing", 6],
];

// Seeded, so every run gives the same sessions.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = () => {
  let r = rand() * MIX.reduce((s, [, w]) => s + w, 0);
  for (const [name, w] of MIX) if ((r -= w) < 0) return name;
  return MIX[0][0];
};

const now = Date.now();
const counts = {};
let stored = 0;
for (let i = 0; i < SESSIONS; i++) {
  const name = pick();
  counts[name] = (counts[name] ?? 0) + 1;
  // A daytime start somewhere in the window.
  const day = Math.floor(rand() * DAYS);
  const hour = 8 + rand() * 14;
  // Whole milliseconds: Postgres stores ts as an integer and rejects a fraction.
  const start = Math.round(now - (day + 1) * 86_400_000 + hour * 3_600_000);
  const events = T[name].map(({ dt, ...e }) => ({ ...e, ts: Math.min(start + dt, now - 60_000) }));
  const res = await fetch(`${ORIGIN}/api/polishd`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: `polishd_session=${randomUUID()}` },
    // No `build`: the server stamps its own, so the events sit on the build that's deployed.
    body: JSON.stringify({ events }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(`${name}: ${res.status} ${JSON.stringify(body)}`);
  stored += body.stored;
}
console.log({ origin: ORIGIN, sessions: SESSIONS, stored, counts });
if (!stored) console.log("Nothing was stored. Does the deployment have a writable store (POLISHD_DATABASE_URL)?");
