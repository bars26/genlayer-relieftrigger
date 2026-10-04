"use client";

import { useMemo, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { Loader2 } from "lucide-react";
import { useRecentEvents, usePaidEventKeys } from "@/lib/hooks/useReliefTrigger";
import { pickEvent, usePickedEvent } from "@/lib/hooks/usePickedEvent";
import { ALERT_HEX, HAZARD_LABEL, PAID_HEX, type GdacsEvent } from "@/lib/contracts/types";

const W = 960;
const H = 440;

const topo = world as unknown as Topology<{ countries: GeometryCollection }>;
const land = feature(topo, topo.objects.countries);
const countries = land.features.filter((f) => f.id !== "010"); // drop Antarctica
const projection = geoNaturalEarth1().fitExtent(
  [
    [6, 6],
    [W - 6, H - 6],
  ],
  { type: "Sphere" }
);
const path = geoPath(projection);
const LAND_PATHS = countries.map((f) => path(f) ?? "");

/** Recent GDACS alerts on a world map; paid events are ringed. Clicking a dot pre-fills the trigger form. */
export function EventMap() {
  const { data, isLoading, isError } = useRecentEvents();
  const paid = usePaidEventKeys();
  const picked = usePickedEvent();
  const [hover, setHover] = useState<GdacsEvent | null>(null);

  const points = useMemo(() => {
    const all = [...(data?.events ?? []), ...(data?.extra ?? [])];
    return all
      .filter((e) => e.lon != null && e.lat != null)
      .map((e) => {
        const xy = projection([e.lon as number, e.lat as number]);
        return xy ? { e, x: xy[0], y: xy[1], key: `${e.type}:${e.id}` } : null;
      })
      .filter((p): p is { e: GdacsEvent; x: number; y: number; key: string } => p !== null)
      .sort((a, b) => (a.e.alert === "RED" ? 1 : 0) - (b.e.alert === "RED" ? 1 : 0)); // red on top
  }, [data]);

  const paidSet = new Set(paid);
  const focus = hover ?? (picked ? points.find((p) => p.key === `${picked.type}:${picked.id}`)?.e ?? null : null);

  return (
    <div className="brand-card p-4 md:p-5">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="World map of recent GDACS alerts and paid events">
          <g>
            {LAND_PATHS.map((d, i) => (
              <path key={i} d={d} fill="var(--map-land)" stroke="var(--background)" strokeWidth={0.6} />
            ))}
          </g>
          <g>
            {points.map(({ e, x, y, key }) => {
              const isPaid = paidSet.has(key);
              const isPicked = picked && `${picked.type}:${picked.id}` === key;
              return (
                <g
                  key={key}
                  transform={`translate(${x},${y})`}
                  className="cursor-pointer"
                  onClick={() => pickEvent(e.type, e.id, e.name)}
                  onMouseEnter={() => setHover(e)}
                  onMouseLeave={() => setHover(null)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${key} ${e.name}`}
                  onKeyDown={(k) => (k.key === "Enter" || k.key === " ") && pickEvent(e.type, e.id, e.name)}
                >
                  <circle r={22} fill="transparent" />
                  {isPaid && <circle r={12} fill="none" stroke={PAID_HEX} strokeWidth={3} />}
                  {isPicked && <circle r={16} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="4 3" />}
                  <circle r={6.5} fill={ALERT_HEX[e.alert] ?? ALERT_HEX.ORANGE} fillOpacity={0.92} stroke="var(--background)" strokeWidth={1.2} />
                </g>
              );
            })}
          </g>
        </svg>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading GDACS alerts...
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: ALERT_HEX.RED }} /> Red alert</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: ALERT_HEX.ORANGE }} /> Orange alert</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full border-2" style={{ borderColor: PAID_HEX }} /> Paid by a pool</span>
        <span className="ml-auto">GDACS, last 120 days{isError ? " (unavailable right now)" : ""}</span>
      </div>
      <p className="mt-2 text-sm min-h-[1.25rem]">
        {focus ? (
          <>
            <span className="font-mono text-muted-foreground">{focus.type}:{focus.id}</span>{" "}
            <strong>{focus.name || HAZARD_LABEL[focus.type]}</strong>
            <span className="text-muted-foreground"> · {focus.date} · {focus.alert.toLowerCase()} alert</span>
            {paidSet.has(`${focus.type}:${focus.id}`) && <span className="text-green-400"> · paid</span>}
            {picked && `${picked.type}:${picked.id}` === `${focus.type}:${focus.id}` && (
              <span className="text-accent"> · picked: open a pool below to trigger it</span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">Click an alert to pre-fill the trigger form of every pool.</span>
        )}
      </p>
    </div>
  );
}
