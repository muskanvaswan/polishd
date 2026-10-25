import { ArrowRightIcon } from "@/components/dash/icons";

/**
 * The handoff a review card ends on now: how many of its findings are
 * waiting on the Actionables tab. On this page it links to the Actionables
 * section, the way the dashboard's links to the tab.
 */
export default function ActionablesPointer({
  count,
  tone,
  from,
}: {
  count: number;
  /** The finding's marker colour on the list: bg-bad for analytics, bg-warn for design. */
  tone: string;
  /** "the analytics", "the design review". */
  from: string;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg border border-line bg-sunken px-3 py-2">
      <span className="flex items-center gap-2 text-[12.5px] text-fg-2">
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />
        <span>
          <span className="font-semibold text-fg">{count}</span> {count === 1 ? "problem" : "problems"} from{" "}
          {from} to act on
        </span>
      </span>
      <a
        href="#act"
        className="group inline-flex items-center gap-1 text-[12px] font-medium text-fg-3 transition-colors hover:text-fg"
      >
        Actionables
        <span className="transition-transform group-hover:translate-x-0.5">
          <ArrowRightIcon />
        </span>
      </a>
    </div>
  );
}
