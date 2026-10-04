/**
 * Recent Orange and Red alerts from the GDACS event list, cached at the CDN.
 *
 * Purely a convenience for picking an event id to trigger with: the contract never
 * trusts this list. Validators fetch the event from GDACS themselves when a pool is triggered.
 */

export const dynamic = "force-dynamic";

const HAZARDS = ["EQ", "TC", "FL", "VO", "DR", "WF"];
const DAYS = 120;

type Event = {
  type: string;
  id: string;
  alert: string;
  name: string;
  countries: string[];
  iso3: string;
  date: string;
  severity: string;
  url: string;
  lon: number | null;
  lat: number | null;
};

let memo: { at: number; events: Event[] } | null = null;
const MEMO_MS = 10 * 60_000;
const extraMemo = new Map<string, Event | null>();

function point(f: any): [number | null, number | null] {
  const g = f?.geometry;
  if (g?.type === "Point" && Array.isArray(g.coordinates)) return [Number(g.coordinates[0]), Number(g.coordinates[1])];
  return [null, null];
}

function toEvent(f: any): Event {
  const p = f?.properties ?? {};
  const [lon, lat] = point(f);
  return {
    type: String(p.eventtype),
    id: String(p.eventid),
    alert: String(p.alertlevel ?? "").toUpperCase(),
    name: String(p.name ?? p.htmldescription ?? "").slice(0, 120),
    countries: String(p.country ?? "")
      .split(",")
      .map((c: string) => c.trim())
      .filter(Boolean)
      .slice(0, 4),
    iso3: String(p.iso3 ?? ""),
    date: String(p.fromdate ?? "").slice(0, 10),
    severity: String(p.severitydata?.severitytext ?? "").slice(0, 100),
    url: `https://www.gdacs.org/report.aspx?eventtype=${p.eventtype}&eventid=${p.eventid}`,
    lon,
    lat,
  };
}

/** Single events (e.g. ones a pool already paid) that may be older than the recent list. */
async function loadExtra(keys: string[]): Promise<Event[]> {
  const out: Event[] = [];
  for (const key of keys) {
    if (!extraMemo.has(key)) {
      const [type, id] = key.split(":");
      try {
        const res = await fetch(`https://www.gdacs.org/gdacsapi/api/events/geteventdata?eventtype=${type}&eventid=${id}`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        extraMemo.set(key, res.ok ? toEvent(await res.json()) : null);
      } catch {
        continue; // not memoised, so the next request retries
      }
    }
    const e = extraMemo.get(key);
    if (e) out.push(e);
  }
  return out;
}

async function load(): Promise<Event[]> {
  const to = new Date();
  const from = new Date(to.getTime() - DAYS * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const url =
    "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH" +
    `?eventlist=${HAZARDS.join(";")}&fromDate=${day(from)}&toDate=${day(to)}&alertlevel=Orange;Red`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal }).finally(() =>
    clearTimeout(timer)
  );
  if (!res.ok) throw new Error(`GDACS returned HTTP ${res.status}`);
  const body = await res.json();
  const features: any[] = Array.isArray(body?.features) ? body.features : [];
  return features
    .filter((f) => HAZARDS.includes(String(f?.properties?.eventtype)) && /^\d+$/.test(String(f?.properties?.eventid)))
    .map(toEvent)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function GET(request: Request) {
  const extraKeys = (new URL(request.url).searchParams.get("extra") ?? "")
    .split(",")
    .filter((k) => /^(EQ|TC|FL|VO|DR|WF):\d{1,10}$/.test(k))
    .slice(0, 20);
  try {
    if (!memo || Date.now() - memo.at > MEMO_MS) memo = { at: Date.now(), events: await load() };
    const known = new Set(memo.events.map((e) => `${e.type}:${e.id}`));
    const extra = await loadExtra(extraKeys.filter((k) => !known.has(k)));
    return Response.json(
      { events: memo.events, extra, source: "GDACS event list (Orange and Red, last 120 days)" },
      { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=86400" } }
    );
  } catch (err) {
    if (memo) return Response.json({ events: memo.events }, { headers: { "Cache-Control": "public, s-maxage=60" } });
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
