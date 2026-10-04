/** Types and display helpers for the ReliefTrigger contract. */

export type Verdict = "MEETS" | "DOES_NOT_MEET" | "UNCLEAR" | "";
export type PoolState = "open" | "pending" | "closed";
export type Hazard = "EQ" | "TC" | "FL" | "VO" | "DR" | "WF";

export interface Pool {
  id: string;
  creator: string;
  name: string;
  recipient: string;
  hazards: string;
  countries: string;
  min_alert: "GREEN" | "ORANGE" | "RED";
  min_severity: string;
  min_exposed: string | number | bigint;
  area_terms: string;
  payout: string | number | bigint;
  coverage_start: string;
  coverage_end: string;
  state: PoolState;
  balance: string | number | bigint;
  total_donated: string | number | bigint;
  total_paid: string | number | bigint;
  closing_balance: string | number | bigint;
  donors_json: string;
  paid_events_json: string;
  claim_event: string;
  claim_by: string;
  claim_at: string;
  claim_verdict: Verdict;
  claim_code: string;
  claim_facts_json: string;
  claim_contested: boolean;
  history_json: string;
}

/** What validators read from GDACS (and USGS for earthquakes) when a claim was assessed. */
export interface ClaimFacts {
  reachable?: boolean;
  hazard?: string;
  name?: string;
  countries?: string[];
  alert?: string;
  from_date?: string;
  severity?: number;
  severity_text?: string;
  exposed?: number;
  usgs_checked?: boolean;
  usgs_mag?: number;
  place?: string;
}

export interface HistoryEntry {
  at: string;
  event: "created" | "donated" | "triggered" | "superseded" | "contested" | "paid" | "dismissed" | "closed" | "reclaimed";
  [key: string]: unknown;
}

/** A recent Orange or Red GDACS alert, from the app's /api/events snapshot. */
export interface GdacsEvent {
  type: Hazard;
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
}

export interface TransactionReceipt {
  status: string;
  hash: string;
  [key: string]: any;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const CONTEST_WINDOW_SECONDS = 600;
export const MIN_POOL_WEI = 10n ** 18n;
export const MIN_DONATION_WEI = 10n ** 17n;

export const HAZARDS: { code: Hazard; label: string; severity?: string }[] = [
  { code: "EQ", label: "Earthquake", severity: "magnitude" },
  { code: "TC", label: "Tropical cyclone", severity: "max wind, km/h" },
  { code: "FL", label: "Flood" },
  { code: "VO", label: "Volcano" },
  { code: "DR", label: "Drought" },
  { code: "WF", label: "Wildfire" },
];
export const HAZARD_LABEL: Record<string, string> = Object.fromEntries(HAZARDS.map((h) => [h.code, h.label]));

export function wei(v: string | number | bigint | undefined): bigint {
  try {
    return BigInt(v ?? 0);
  } catch {
    return 0n;
  }
}

export function formatGen(v: string | number | bigint | undefined, digits = 2): string {
  const w = wei(v);
  const whole = w / 10n ** 18n;
  const frac = Number((w % 10n ** 18n) / 10n ** 14n) / 10_000;
  return (Number(whole) + frac).toFixed(digits);
}

export function parseGen(input: string): bigint | null {
  const m = input.trim().match(/^(\d+)(?:\.(\d{1,18}))?$/);
  if (!m) return null;
  return BigInt(m[1]) * 10n ** 18n + BigInt((m[2] ?? "").padEnd(18, "0") || "0");
}

export function parseJson<T>(json: string | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export const sameAddress = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function secondsSince(iso: string): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso.endsWith("Z") || /[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 1000;
}

export const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Coverage is over once the UTC date is past coverage_end; then anyone can close the pool. */
export const coverageEnded = (p: Pool) => todayUtc() > p.coverage_end;

export const donorsOf = (p: Pool) => parseJson<string[]>(p.donors_json, []);
export const isDonor = (p: Pool, a?: string | null) => donorsOf(p).some((d) => sameAddress(d, a));

export const VERDICT_STYLE: Record<Exclude<Verdict, "">, { label: string; cls: string; help: string }> = {
  MEETS: {
    label: "Meets terms",
    cls: "bg-green-500/20 text-green-400 border-green-500/40",
    help: "The event satisfies every term. Resolving pays the recipient.",
  },
  DOES_NOT_MEET: {
    label: "Does not meet",
    cls: "bg-red-500/20 text-red-400 border-red-500/40",
    help: "The event fails at least one term. Resolving dismisses the claim; the pool stays funded.",
  },
  UNCLEAR: {
    label: "Unclear",
    cls: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
    help: "A source could not be read or the area could not be judged. Nothing is paid; trigger again later.",
  },
};

/** Why the validators reached a verdict, by the code the contract records. */
export const CODE_TEXT: Record<string, string> = {
  met: "every coded term holds (no area condition)",
  area: "coded terms hold; validators' LLMs judged the area condition",
  hazard: "the event type is not covered by this pool",
  country: "no affected country is covered by this pool",
  alert: "the GDACS alert level is below the pool's minimum",
  date: "the event date is outside the coverage period",
  severity: "the severity is below the pool's minimum",
  exposure: "fewer people were exposed than the pool requires",
  sources_disagree: "GDACS and USGS magnitudes differ by more than 0.3",
  gdacs_unreachable: "GDACS could not be read",
  usgs_unreachable: "USGS could not be read to confirm the magnitude",
};

export const STATE_STYLE: Record<PoolState, string> = {
  open: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  pending: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  closed: "bg-white/5 text-muted-foreground border-white/10",
};

export const ALERT_STYLE: Record<string, string> = {
  RED: "text-red-400",
  ORANGE: "text-amber-400",
  GREEN: "text-green-400",
};

/** Map and legend colours for GDACS alert levels and paid events. */
export const ALERT_HEX: Record<string, string> = { RED: "#EF4444", ORANGE: "#F59E0B", GREEN: "#22C55E" };
export const PAID_HEX = "#22C55E";

export const gdacsUrl = (type: string, id: string) =>
  `https://www.gdacs.org/report.aspx?eventtype=${type}&eventid=${id}`;
