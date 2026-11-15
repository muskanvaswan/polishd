"use client";

import { useEffect, useRef, useState } from "react";

import { FIXES, FIX_IDS, readFixes, writeFixes, type FixId } from "@/lib/fixes";

/**
 * The demo's bar: says what this site is, lists its bugs so you can fix them
 * one at a time (or all at once), and opens the site's real Polishd dashboard.
 *
 * It lives in an iframe on purpose. Polishd measures the page it's installed
 * on — every click, every colour — and the bar isn't part of Queuebird. An
 * iframe's clicks never reach the page's listeners and the design scan skips
 * iframes, so the dashboard describes the site and nothing else.
 */

const BAR_H = 62;

const BAR = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="dark">
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; background: transparent; overflow: hidden; }
  body {
    display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 8px; padding: 0 6px 8px;
    font: 500 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #b8b8b8; -webkit-font-smoothing: antialiased;
  }
  button { all: unset; cursor: pointer; font: inherit; }
  button:focus-visible, a:focus-visible { outline: 2px solid #f5f5f5; outline-offset: 2px; }

  .bar {
    flex: none; display: flex; align-items: center; gap: 10px; height: 46px; max-width: 100%;
    padding: 0 6px 0 16px; border-radius: 999px; white-space: nowrap;
    background: rgba(10, 10, 10, .94); border: 1px solid rgba(255, 255, 255, .16);
    box-shadow: 0 6px 20px rgba(0, 0, 0, .55);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  }
  .mark { font-weight: 800; font-size: 15px; letter-spacing: -.03em; color: #f5f5f5; }
  .note { color: #8f8f8f; font-size: 12.5px; }
  .sep { width: 1px; height: 20px; background: #363636; }
  .bugs {
    display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 12px; border-radius: 999px;
    background: #1a1a1a; border: 1px solid #2c2c2c; color: #f5f5f5; font-size: 12.5px;
    transition: background-color .15s, transform .15s;
  }
  .bugs:hover { background: #242424; }
  .bugs:active, .open:active, .act:active { transform: scale(.97); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #f87171; transition: background-color .2s; }
  .bugs[data-clear="1"] .dot { background: #4ade80; }
  .chev { width: 9px; height: 9px; transition: transform .2s cubic-bezier(.23, 1, .32, 1); }
  .bugs[aria-expanded="true"] .chev { transform: rotate(180deg); }
  .open {
    display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: 999px;
    background: #f5f5f5; color: #000; font-weight: 600; font-size: 12.5px; text-decoration: none;
    transition: background-color .15s, transform .15s;
  }
  .open:hover { background: #fff; }
  .short { display: none; }

  .panel {
    display: none; flex: 0 1 auto; min-height: 0; width: min(430px, 100%); flex-direction: column;
    border-radius: 16px; background: rgba(12, 12, 12, .97); border: 1px solid rgba(255, 255, 255, .14);
    box-shadow: 0 10px 30px rgba(0, 0, 0, .6); overflow: hidden;
    transform-origin: 50% 100%;
  }
  .panel[data-open="1"] { display: flex; animation: rise .22s cubic-bezier(.23, 1, .32, 1); }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.98); } }
  .head { padding: 14px 16px 10px; }
  .head b { display: block; color: #f5f5f5; font-size: 14px; font-weight: 600; }
  .head span { display: block; margin-top: 3px; font-size: 12px; color: #8f8f8f; }
  .list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 8px; }
  .kind { padding: 8px 8px 4px; font-size: 11px; color: #6f6f6f; }
  .row { display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 10px; }
  .row:hover { background: #171717; }
  .row .t { flex: 1; min-width: 0; }
  .row .t b { display: block; font-weight: 500; font-size: 13px; color: #f5f5f5; transition: color .2s; }
  .row .t span { display: block; margin-top: 2px; font-size: 11.5px; color: #8f8f8f; }
  .row[data-on="1"] .t b { color: #8f8f8f; text-decoration: line-through; text-decoration-color: #5e5e5e; }
  .sw { position: relative; flex: none; width: 38px; height: 22px; border-radius: 999px; background: #363636; transition: background-color .2s; }
  .sw::after {
    content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff;
    transition: transform .2s cubic-bezier(.23, 1, .32, 1);
  }
  .sw[aria-checked="true"] { background: #4ade80; }
  .sw[aria-checked="true"]::after { transform: translateX(16px); }
  .foot { display: flex; gap: 8px; padding: 10px 12px 12px; border-top: 1px solid #222; }
  .act { flex: 1; height: 34px; border-radius: 10px; text-align: center; font-size: 12.5px; font-weight: 600; transition: background-color .15s, transform .15s, opacity .15s; }
  .act.all { background: #f5f5f5; color: #000; }
  .act.all:hover { background: #fff; }
  .act.reset { flex: 0 0 auto; padding: 0 14px; background: #1a1a1a; border: 1px solid #2c2c2c; color: #b8b8b8; }
  .act[disabled] { opacity: .4; pointer-events: none; }

  @media (max-width: 640px) { .note, .sep { display: none; } }
  @media (max-width: 440px) {
    .bar { gap: 8px; padding-left: 12px; }
    .long { display: none; } .short { display: inline; }
  }
  @media (prefers-reduced-motion: reduce) { .panel[data-open="1"] { animation: none; } }
</style>
</head>
<body>
  <div class="panel" id="panel" role="dialog" aria-label="This site's bugs">
    <div class="head">
      <b id="count"></b>
      <span>Polishd flagged each of these on its dashboard. Fix them one at a time and watch the page change.</span>
    </div>
    <div class="list" id="list"></div>
    <div class="foot">
      <button type="button" class="act all" id="all">Fix all of them</button>
      <button type="button" class="act reset" id="reset">Reset</button>
    </div>
  </div>
  <div class="bar">
    <span class="mark">polishd</span>
    <span class="note">is installed on this demo site</span>
    <span class="sep"></span>
    <button type="button" class="bugs" id="bugs" aria-expanded="false" aria-controls="panel">
      <span class="dot"></span><span id="label"></span>
      <svg class="chev" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6.5 5 3.5l3 3"/></svg>
    </button>
    <a class="open" href="/polishd" target="_blank" rel="noopener"><span class="long">Open the dashboard</span><span class="short">Dashboard</span> ↗</a>
  </div>
  <script>
    var FIXES = __FIXES__;
    var on = [];
    var open = false;
    var $ = function (id) { return document.getElementById(id); };
    var send = function (msg) { msg.source = "polishd-demo-bar"; parent.postMessage(msg, "*"); };

    var list = $("list");
    var kind = "";
    FIXES.forEach(function (f) {
      if (f.kind !== kind) {
        kind = f.kind;
        var h = document.createElement("div");
        h.className = "kind";
        h.textContent = kind === "Behaviour" ? "Behaviour, from the Analytics tab" : "Design, from the Design tab";
        list.appendChild(h);
      }
      var row = document.createElement("div");
      row.className = "row";
      row.dataset.id = f.id;
      var t = document.createElement("div");
      t.className = "t";
      var b = document.createElement("b");
      b.textContent = f.title;
      var s = document.createElement("span");
      s.textContent = f.seen;
      t.appendChild(b);
      t.appendChild(s);
      var sw = document.createElement("button");
      sw.type = "button";
      sw.className = "sw";
      sw.setAttribute("role", "switch");
      sw.setAttribute("aria-label", "Fix: " + f.title);
      sw.addEventListener("click", function () { send({ toggle: f.id }); });
      row.appendChild(t);
      row.appendChild(sw);
      list.appendChild(row);
    });

    function draw() {
      var left = FIXES.length - on.length;
      $("label").textContent = left === 0 ? "All fixed" : left + (left === 1 ? " bug" : " bugs");
      $("bugs").dataset.clear = left === 0 ? "1" : "";
      $("count").textContent = left === 0 ? "All " + FIXES.length + " fixed" : left + " of " + FIXES.length + " bugs left on this site";
      document.querySelectorAll(".row").forEach(function (row) {
        var is = on.indexOf(row.dataset.id) !== -1;
        row.dataset.on = is ? "1" : "";
        row.querySelector(".sw").setAttribute("aria-checked", String(is));
      });
      $("all").disabled = left === 0;
      $("reset").disabled = on.length === 0;
    }
    function setOpen(next) {
      open = next;
      $("panel").dataset.open = open ? "1" : "";
      $("bugs").setAttribute("aria-expanded", String(open));
      send({ open: open });
    }
    $("bugs").addEventListener("click", function () { setOpen(!open); });
    $("all").addEventListener("click", function () { send({ all: true }); });
    $("reset").addEventListener("click", function () { send({ all: false }); });
    addEventListener("keydown", function (e) { if (e.key === "Escape" && open) setOpen(false); });
    addEventListener("message", function (e) {
      if (e.source !== parent || !e.data || e.data.source !== "polishd-demo") return;
      if (e.data.fixes) { on = e.data.fixes; draw(); }
      if (e.data.close && open) setOpen(false);
    });
    draw();
    send({ ready: true });
  </script>
</body>
</html>`.replace("__FIXES__", JSON.stringify(FIXES).replace(/</g, "\\u003c"));

export default function DemoBar() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [sweeping, setSweeping] = useState(false);
  const [open, setOpen] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    const post = (msg: object) => frame.current?.contentWindow?.postMessage({ source: "polishd-demo", ...msg }, "*");
    const tell = () => post({ fixes: readFixes() });
    const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const fixAll = () => {
      if (busy.current) return;
      if (reduced()) {
        writeFixes(FIX_IDS, false);
        return tell();
      }
      // The brush crosses the page, and the fixes land under it.
      busy.current = true;
      setSweeping(true);
      window.setTimeout(() => {
        writeFixes(FIX_IDS);
        tell();
      }, 520);
      window.setTimeout(() => {
        setSweeping(false);
        busy.current = false;
      }, 1400);
    };

    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.source !== "polishd-demo-bar") return;
      const d = e.data;
      if (d.ready) return tell();
      if (typeof d.open === "boolean") return setOpen(d.open);
      if (d.all === true) return fixAll();
      if (d.all === false) {
        writeFixes([], !reduced());
        return tell();
      }
      if (typeof d.toggle === "string") {
        const now = readFixes();
        const id = d.toggle as FixId;
        writeFixes(now.includes(id) ? now.filter((x) => x !== id) : [...now, id], !reduced());
        tell();
      }
    };
    // A click on the page itself closes the list.
    const onPageDown = () => post({ close: true });

    window.addEventListener("message", onMessage);
    document.addEventListener("pointerdown", onPageDown);
    tell();
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("pointerdown", onPageDown);
    };
  }, []);

  return (
    <div data-polishd-ui="">
      {sweeping ? <div className="polish-sweep pointer-events-none fixed inset-y-0 z-[70] w-[34vw] min-w-[260px]" /> : null}
      <iframe
        ref={frame}
        title="Polishd demo controls"
        srcDoc={BAR}
        style={{ height: open ? `min(672px, calc(100svh - 16px))` : BAR_H }}
        className="fixed bottom-1 left-1/2 z-[60] w-[min(660px,calc(100vw-12px))] -translate-x-1/2 border-0 bg-transparent"
      />
    </div>
  );
}
