import type { IntelMap as IntelMapDef } from "@/game/missions/types";

const FILL: Record<IntelMapDef["areas"][number]["kind"], string> = {
  water: "rgba(70,110,140,.35)",
  fence: "none",
  building: "rgba(220,214,196,.28)",
  road: "rgba(200,190,160,.16)",
  cover: "rgba(110,150,80,.22)",
  danger: "rgba(255,200,90,.16)",
};
const LINE: Record<IntelMapDef["lines"][number]["kind"], { stroke: string; dash: string }> = {
  route: { stroke: "rgba(160,220,150,.85)", dash: "5 4" },
  patrol: { stroke: "rgba(255,150,110,.6)", dash: "2 3" },
  exfil: { stroke: "rgba(130,190,255,.9)", dash: "5 4" },
};

/**
 * Top-down briefing sketch drawn from `MissionDef.intel` (map metres, north
 * up): areas, the suggested route in, the truck's patrol loop, the exfil
 * route and labelled marks. Purely presentational SVG.
 */
export function IntelMap({ intel }: { intel: IntelMapDef }) {
  const { x0, x1, z0, z1 } = intel.bounds;
  const w = x1 - x0, h = z1 - z0;
  // SVG y grows down = map z grows south: north is up.
  const X = (x: number) => x - x0;
  const Y = (z: number) => z - z0;
  return (
    <figure className="mt-4">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[420px] rounded-md border border-white/10 bg-[#0c1012]" role="img" aria-label="Intel map of the area of operations">
        {intel.areas.map((a, i) => (
          <g key={i}>
            <rect
              x={X(a.x0)} y={Y(a.z0)} width={a.x1 - a.x0} height={a.z1 - a.z0}
              fill={FILL[a.kind]}
              stroke={a.kind === "fence" ? "rgba(230,230,220,.7)" : a.kind === "danger" ? "rgba(255,200,90,.5)" : "none"}
              strokeWidth={a.kind === "fence" ? 1.2 : 0.6}
              strokeDasharray={a.kind === "fence" ? "3 1.5" : undefined}
            />
            {a.label && (
              <text x={X((a.x0 + a.x1) / 2)} y={Y((a.z0 + a.z1) / 2) + 2} textAnchor="middle" fontSize={5.5} fill="rgba(240,236,224,.75)" style={{ letterSpacing: ".08em" }}>
                {a.label}
              </text>
            )}
          </g>
        ))}
        {intel.lines.map((l, i) => (
          <polyline key={i} points={l.pts.map((p) => `${X(p.x)},${Y(p.z)}`).join(" ")} fill="none" stroke={LINE[l.kind].stroke} strokeWidth={1.4} strokeDasharray={LINE[l.kind].dash} strokeLinejoin="round" />
        ))}
        {intel.marks.map((m, i) => {
          const cx = X(m.x), cy = Y(m.z);
          const color = m.kind === "target" ? "#ff6a5a" : m.kind === "exfil" ? "#82beff" : m.kind === "start" ? "#a8e09a" : m.kind === "tower" ? "#ffc845" : "#e8e4d8";
          return (
            <g key={i}>
              {m.kind === "tower" ? (
                <path d={`M${cx} ${cy - 3.2}L${cx + 3} ${cy + 2.4}H${cx - 3}Z`} fill={color} />
              ) : m.kind === "target" ? (
                <g stroke={color} strokeWidth={1.2} fill="none">
                  <circle cx={cx} cy={cy} r={3.6} />
                  <path d={`M${cx - 5.5} ${cy}H${cx + 5.5}M${cx} ${cy - 5.5}V${cy + 5.5}`} />
                </g>
              ) : (
                <circle cx={cx} cy={cy} r={2.4} fill={color} />
              )}
              {m.label && (
                <text x={cx + 5} y={cy + 2} fontSize={6} fontWeight={700} fill={color} style={{ letterSpacing: ".06em" }}>
                  {m.label}
                </text>
              )}
            </g>
          );
        })}
        <text x={w - 6} y={10} textAnchor="end" fontSize={7} fill="rgba(240,236,224,.6)">N ↑</text>
      </svg>
      <figcaption className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-400">
        <span><span className="text-[#a0dc96]">- -</span> suggested route in</span>
        <span><span className="text-[#ff966e]">···</span> truck patrol</span>
        <span><span className="text-[#82beff]">- -</span> exfil</span>
        <span><span className="text-[#ffc845]">▲</span> watchtower + searchlight</span>
      </figcaption>
    </figure>
  );
}
