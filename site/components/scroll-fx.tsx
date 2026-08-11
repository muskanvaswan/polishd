"use client";

import { useEffect } from "react";

/**
 * One observer for the whole page.
 *
 * Sections stay server components and just opt in with `className="r"`; this
 * flips them to `.in` on entry, counts up any `[data-count]` inside, and fills
 * any `.fill` meters. It also toggles the sticky header's hairline.
 */
export default function ScrollFX() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Sticky header hairline.
    const bar = document.getElementById("top-bar");
    const onScroll = () => bar?.classList.toggle("stuck", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const countUp = (el: HTMLElement, instant: boolean) => {
      const target = Number(el.dataset.count ?? 0);
      if (reduce || instant) {
        el.textContent = target.toLocaleString("en-US");
        return;
      }
      const duration = 1500;
      let start: number | null = null;
      const frame = (ts: number) => {
        if (start === null) start = ts;
        const p = Math.min((ts - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 4);
        el.textContent = Math.round(target * eased).toLocaleString("en-US");
        if (p < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    };

    const reveal = (el: HTMLElement, instant = false) => {
      el.classList.add("in");

      const n = el.querySelector<HTMLElement>("[data-count]");
      if (n) countUp(n, instant);

      el.querySelectorAll<HTMLElement>(".fill").forEach((f, i) => {
        const paint = () => {
          f.style.width = `${f.dataset.w ?? 0}%`;
        };
        if (instant) paint();
        else window.setTimeout(paint, 180 + i * 130);
      });
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target as HTMLElement);
          io.unobserve(entry.target);
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
    );

    document.querySelectorAll<HTMLElement>(".r").forEach((el) => {
      // A restored scroll position (reload, back-navigation, deep link) leaves
      // everything above the fold permanently un-intersected — show it at once
      // rather than animating content the reader has already scrolled past.
      if (el.getBoundingClientRect().bottom < 0) {
        el.style.transitionDelay = "0ms";
        reveal(el, true);
        return;
      }

      // Rewind the server-rendered figure so it can count back up. Safe to do
      // after paint: `.r` is still transparent until this element is revealed.
      const n = el.querySelector<HTMLElement>("[data-count]");
      if (n && !reduce) n.textContent = "0";

      io.observe(el);
    });

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return null;
}
