import type { Stage } from "@/lib/loop";
import { StatusChip } from "@/components/ui";

/**
 * The loop as a ring: a node per stage, the shipped stretch drawn solid and
 * the stretch still in beta drawn dashed. The travelling arc closes the
 * circle on the last stage — the point being that this is a cycle, not a
 * funnel.
 */

const CX = 200;
const CY = 200;
const R = 115;
const LABEL_R = 141;
const CIRC = 2 * Math.PI * R;

function point(radius: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
}

function arcPath(fromDeg: number, toDeg: number, radius = R) {
  const a = point(radius, fromDeg);
  const b = point(radius, toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} 1 ${b.x} ${b.y}`;
}

function anchorFor(deg: number): { anchor: "start" | "middle" | "end"; dy: number } {
  const cos = Math.cos((deg * Math.PI) / 180);
  if (cos > 0.3) return { anchor: "start", dy: 3 };
  if (cos < -0.3) return { anchor: "end", dy: 3 };
  return { anchor: "middle", dy: deg < 0 ? -6 : 12 };
}

export default function LoopRing({
  stages,
  active,
  dir = 1,
}: {
  stages: Stage[];
  active: number;
  /** Which way the reader last moved through the stages: 1 down, -1 back up. */
  dir?: 1 | -1;
}) {
  // Evenly round the ring, starting at twelve o'clock.
  const angleOf = (i: number) => -90 + (i * 360) / stages.length;

  const current = stages[active];
  const coming = current.status === "coming";
  const accent = coming ? "#fbbf24" : "#f5f5f5";

  // Index of the first stage still in beta; the ring goes dashed from there.
  const firstComing = stages.findIndex((s) => s.status === "coming");

  // The arc runs one segment past the active node — you are always in transit
  // toward the next stage — so the final stage closes the ring completely. It
  // is drawn in two pieces so the shipped stretch stays white however far the
  // amber has travelled into beta territory.
  const travelled = active + 1;
  const shipped = Math.min(travelled, firstComing) / stages.length;
  const beta = Math.max(0, travelled - firstComing) / stages.length;

  return (
    <div className="relative mx-auto w-full max-w-[320px] sm:max-w-[380px]">
      {/* A little room either side: with seven stages the labels nearest
          three and nine o'clock reach almost to the ring's own width. */}
      <svg viewBox="-12 0 424 400" className="w-full" role="img" aria-label="The Polishd loop">
        {/* Shipped half — solid. Beta half — dashed. */}
        <path
          d={arcPath(angleOf(0), angleOf(firstComing))}
          fill="none"
          stroke="#262626"
          strokeWidth={1.5}
        />
        <path
          d={arcPath(angleOf(firstComing), angleOf(stages.length))}
          fill="none"
          stroke="#262626"
          strokeWidth={1.5}
          strokeDasharray="3 7"
          strokeLinecap="round"
        />

        {/* Travelling arc — shipped stretch, then beta stretch. */}
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="#f5f5f5"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - shipped)}
          transform={`rotate(${angleOf(0)} ${CX} ${CY})`}
          className="ring-arc"
        />
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - beta)}
          transform={`rotate(${angleOf(firstComing)} ${CX} ${CY})`}
          className="ring-arc"
        />

        {stages.map((stage, i) => {
          const deg = angleOf(i);
          const node = point(R, deg);
          const label = point(LABEL_R, deg);
          const { anchor, dy } = anchorFor(deg);
          const isActive = i === active;
          const reached = i < active;
          const isComing = stage.status === "coming";
          const tone = isComing ? "#fbbf24" : "#f5f5f5";

          return (
            <g key={stage.id} className="ring-node">
              {/* Every node keeps its halo and its size change mounted, so moving
                  between stages is a transition rather than a swap (globals.css). */}
              <circle
                cx={node.x}
                cy={node.y}
                r={13}
                fill="none"
                stroke={tone}
                strokeWidth={1}
                className="ring-halo"
                data-active={isActive || undefined}
              />
              <circle
                cx={node.x}
                cy={node.y}
                r={5}
                className="ring-dot"
                data-active={isActive || undefined}
                fill={isActive ? tone : reached ? "#5e5e5e" : "#121212"}
                stroke={isActive ? tone : reached ? "#5e5e5e" : "#363636"}
                strokeWidth={1.5}
                strokeDasharray={!isActive && !reached && isComing ? "2 2" : undefined}
              />
              <text
                x={label.x}
                y={label.y}
                dy={dy}
                textAnchor={anchor}
                className="ring-label"
                fill={isActive ? tone : reached ? "#8f8f8f" : "#5e5e5e"}
              >
                {stage.name.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Centre read-out. */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="label">Stage</div>
          {/* Keyed per stage, so each new one plays its entrance. */}
          <div
            key={current.id}
            className="ring-readout"
            style={{ "--dir": dir } as React.CSSProperties}
          >
            <div
              className="mt-1 text-[44px] font-semibold leading-none tracking-[-0.04em] tabular-nums"
              style={{ color: accent }}
            >
              {current.id}
            </div>
            <div className="mt-2 text-[15px] font-medium">{current.name}</div>
            <StatusChip status={current.status} dot className="mt-2.5" />
          </div>
        </div>
      </div>
    </div>
  );
}
