"use client";

import { useEffect } from "react";

/**
 * One page-wide observer: anything tagged `.r` comes into view once, as it
 * arrives. Anything already scrolled past on load (a hash link, a reload
 * halfway down) is shown at once rather than left hidden above the reader.
 */
export default function ScrollFX() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".r:not(.in)")];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    for (const el of els) {
      if (el.getBoundingClientRect().bottom < 0) el.classList.add("in");
      else io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return null;
}
