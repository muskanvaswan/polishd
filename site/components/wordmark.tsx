import DotBottle from "@/components/dot-bottle";

/**
 * The Polishd wordmark, as the dashboard's sidebar and the hero set it:
 * "polis" and "d" in the highway face, and for the h, the halftone polish
 * bottle with its slow shimmer. Size it with a font-size on `className`; the
 * bottle scales with the em.
 */
export default function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="polishd"
      className={`font-highway inline-block whitespace-nowrap font-extrabold lowercase leading-none tracking-[-0.03em] ${className}`}
    >
      <span aria-hidden>polis</span>
      <DotBottle className="mx-[0.02em] inline-block h-[0.73em]" />
      <span aria-hidden>d</span>
    </span>
  );
}
