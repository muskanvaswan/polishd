"use client";

import { useRef } from "react";

/**
 * The 67-second promo film, for anyone who'd rather watch than scroll. Opens
 * in a native <dialog> (Escape and the backdrop close it) and only loads the
 * video when asked.
 */
export default function FilmButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  const open = () => {
    const v = video.current!;
    if (!v.src) v.src = "/film/polishd-film.mp4";
    dialog.current!.showModal();
    v.currentTime = 0;
    void v.play().catch(() => {});
  };
  const close = () => {
    video.current?.pause();
    dialog.current?.close();
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="group inline-flex h-[46px] cursor-pointer items-center gap-3 rounded-[10px] border border-line-strong bg-surface/60 pl-2 pr-5 font-chart text-[14px] font-medium text-fg-2 transition-[color,border-color,background-color,scale] duration-150 ease-out hover:border-fg-4 hover:bg-raised hover:text-fg active:scale-[0.97]"
      >
        <span className="grid size-[30px] place-items-center rounded-[7px] bg-fg text-black transition-transform duration-200 ease-[var(--ease-out)] group-hover:scale-105">
          <svg width="11" height="12" viewBox="0 0 11 12" fill="currentColor" aria-hidden>
            <path d="M1 1.2v9.6a.7.7 0 0 0 1.06.6l8-4.8a.7.7 0 0 0 0-1.2l-8-4.8A.7.7 0 0 0 1 1.2z" />
          </svg>
        </span>
        Watch the film <span className="font-mono text-[11.5px] text-fg-4">1:07</span>
      </button>

      <dialog
        ref={dialog}
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
        onClose={() => video.current?.pause()}
        className="m-auto w-[min(1100px,94vw)] overflow-visible bg-transparent p-0 backdrop:bg-black/85 backdrop:backdrop-blur-sm"
        aria-label="The Polishd film"
      >
        <div className="relative overflow-hidden rounded-2xl border border-line bg-black shadow-pop">
          <video ref={video} controls playsInline preload="none" poster="/film/poster.jpg" className="block aspect-video w-full" />
        </div>
        <button
          type="button"
          onClick={close}
          className="absolute -top-12 right-0 cursor-pointer rounded-lg px-3 py-1.5 font-chart text-[13px] text-fg-3 transition-colors hover:bg-raised hover:text-fg"
        >
          Close ✕
        </button>
      </dialog>
    </>
  );
}
