import type { Stage } from "@/lib/loop";
import { StatusChip } from "@/components/ui";

/**
 * The loop as a ring: six nodes, the shipped half drawn solid and the half
 * still in beta drawn dashed. The travelling arc closes the circle on the last
 * stage — the point being that this is a cycle, not a funnel.
 */

const CX = 200;
const CY = 200;
const R = 115;
const LABEL_R = 141;
const CIRC = 2 * Math.PI * R;
const STEP = 60; // 6 stages around the ring

const angleOf = (i: number) => -90 + i * STEP;

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
}: {
  stages: Stage[];
  active: number;
}) {
  const current = stages[active];
  const coming = current.status === "coming";
  const accent = coming ? "#f5a623" : "#ffffff";

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
      <svg viewBox="0 0 400 400" className="w-full" role="img" aria-label="The Polishd loop">
        {/* Shipped half — solid. Beta half — dashed. */}
        <path
          d={arcPath(angleOf(0), angleOf(firstComing))}
          fill="none"
          stroke="#2e2e2e"
          strokeWidth={1.5}
        />
        <path
          d={arcPath(angleOf(firstComing), angleOf(stages.length))}
          fill="none"
          stroke="#2e2e2e"
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
          stroke="#ffffff"
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
          stroke="#f5a623"
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
          const tone = isComing ? "#f5a623" : "#ffffff";

          return (
            <g key={stage.id} className="ring-node">
              {isActive && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={13}
                  fill="none"
                  stroke={tone}
                  strokeWidth={1}
                  opacity={0.28}
                />
              )}
              <circle
                cx={node.x}
                cy={node.y}
                r={isActive ? 6.5 : 5}
                fill={isActive ? tone : reached ? "#5a5a5a" : "#0a0a0a"}
                stroke={isActive ? tone : reached ? "#5a5a5a" : "#3a3a3a"}
                strokeWidth={1.5}
                strokeDasharray={!isActive && !reached && isComing ? "2 2" : undefined}
              />
              <text
                x={label.x}
                y={label.y}
                dy={dy}
                textAnchor={anchor}
                className="ring-label"
                fill={isActive ? tone : reached ? "#888" : "#555"}
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
          <div
            className="mt-1 text-[44px] font-semibold leading-none tracking-[-0.04em] tabular-nums transition-colors duration-300"
            style={{ color: accent }}
          >
            {current.id}
          </div>
          <div className="mt-2 text-[15px] font-medium">{current.name}</div>
          <StatusChip status={current.status} dot className="mt-2.5" />
        </div>
      </div>
    </div>
  );
}
