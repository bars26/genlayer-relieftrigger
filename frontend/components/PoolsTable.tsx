"use client";

import { Fragment, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, ExternalLink, HeartHandshake, Loader2, RefreshCw, Search } from "lucide-react";
import { useAllPools } from "@/lib/hooks/useReliefTrigger";
import {
  ALERT_STYLE,
  CODE_TEXT,
  HAZARD_LABEL,
  formatGen,
  gdacsUrl,
  parseJson,
  wei,
  type ClaimFacts,
  type HistoryEntry,
  type Pool,
  type PoolState,
} from "@/lib/contracts/types";
import { toErrorInfo } from "@/lib/utils/errors";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { StateBadge, VerdictBadge } from "./Badges";
import { PoolActions } from "./PoolActions";
import { AddressDisplay } from "./AddressDisplay";

const STATES: (PoolState | "any")[] = ["any", "open", "pending", "closed"];

export function PoolsTable() {
  const { pools, failedIds, fetchedAt, isLoading, isFetching, isError, error, refetch } = useAllPools();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<PoolState | "any">("any");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...pools]
      .reverse()
      .filter(
        (p) =>
          (state === "any" || p.state === state) &&
          (!q ||
            p.id === q ||
            p.name.toLowerCase().includes(q) ||
            p.countries.toLowerCase().includes(q) ||
            p.area_terms.toLowerCase().includes(q))
      );
  }, [pools, query, state]);

  if (isLoading) {
    return (
      <div className="brand-card p-8 flex items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin text-accent" /> Loading pools...
      </div>
    );
  }
  if (isError && pools.length === 0) {
    const e = toErrorInfo(error);
    return (
      <div className="brand-card p-8 space-y-3 text-center">
        <AlertCircle className="w-10 h-10 mx-auto text-destructive" />
        <p className="text-destructive font-semibold">{e.message}</p>
        {e.hint && <p className="text-sm text-muted-foreground">{e.hint}</p>}
        <Button variant="gradient" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }
  if (pools.length === 0) {
    return (
      <div className="brand-card p-12 text-center space-y-3">
        <HeartHandshake className="w-14 h-14 mx-auto text-muted-foreground opacity-30" />
        <h3 className="text-xl font-bold">No pools yet</h3>
        <p className="text-muted-foreground">Create the first one: pre-fund a responder for the next qualifying disaster.</p>
      </div>
    );
  }

  return (
    <div className="brand-card p-6 overflow-hidden">
      {failedIds.length > 0 && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm">
          <span>{failedIds.length} pool(s) could not be read just now because the Studio RPC was busy.</span>
          <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>Retry</Button>
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, country (ISO3), area or pool id..." className="pl-9" aria-label="Search pools" />
        </div>
        <select value={state} onChange={(e) => setState(e.target.value as PoolState | "any")} aria-label="Filter by state" className="rounded-md border border-input bg-transparent px-3 text-sm">
          {STATES.map((s) => (
            <option key={s} value={s} className="bg-background">{s === "any" ? "Any state" : s}</option>
          ))}
        </select>
      </div>
      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {fetchedAt ? `Read from the contract at ${fetchedAt.slice(11, 19)} UTC.` : "Read from the contract."} Your own writes update their pool at once.
        </span>
        <button type="button" onClick={() => refetch()} disabled={isFetching} className="inline-flex items-center gap-1 hover:text-accent disabled:opacity-50">
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No pools match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                {["Pool", "Covers", "Balance", "State", "Last claim"].map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map((p) => <PoolRow key={p.id} pool={p} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function lastClaim(pool: Pool, history: HistoryEntry[]) {
  if (pool.state === "pending") return { verdict: pool.claim_verdict, key: pool.claim_event };
  const h = [...history].reverse().find((e) => e.event === "paid" || e.event === "dismissed");
  if (!h) return null;
  return { verdict: (h.event === "paid" ? "MEETS" : (h.verdict as string)) as Pool["claim_verdict"], key: String(h.event_key ?? "") };
}

function severityText(min: string, hazards: string[]) {
  const parts = [];
  if (hazards.includes("EQ")) parts.push(`earthquakes ≥ M${min}, GDACS and USGS within 0.3`);
  if (hazards.includes("TC")) parts.push(`cyclones ≥ ${min} km/h wind`);
  return parts.join("; ");
}

function Terms({ pool }: { pool: Pool }) {
  const hazards = pool.hazards.split(",");
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">{k}</dt><dd>{v}</dd></div>
  );
  return (
    <dl className="text-xs space-y-1">
      {row("Hazards", hazards.map((h) => HAZARD_LABEL[h] ?? h).join(", "))}
      {row("Countries", pool.countries.replaceAll(",", ", "))}
      {row("GDACS alert", <span className={ALERT_STYLE[pool.min_alert]}>{pool.min_alert.toLowerCase()} or higher</span>)}
      {pool.min_severity && (hazards.includes("EQ") || hazards.includes("TC")) && row("Severity", severityText(pool.min_severity, hazards))}
      {wei(pool.min_exposed) > 0n && row("Exposed people", `≥ ${Number(wei(pool.min_exposed)).toLocaleString("en-US")} in MMI VII+ shaking (earthquakes)`)}
      {row("Event dates", `${pool.coverage_start} → ${pool.coverage_end}`)}
      {row("Payout", `${formatGen(pool.payout)} GEN per qualifying event`)}
      {pool.area_terms && row("Area (LLM)", <em>&quot;{pool.area_terms}&quot;</em>)}
    </dl>
  );
}

function PoolRow({ pool }: { pool: Pool }) {
  const [open, setOpen] = useState(false);
  const history = parseJson<HistoryEntry[]>(pool.history_json, []);
  const facts = parseJson<ClaimFacts>(pool.claim_facts_json, {});
  const paid = parseJson<string[]>(pool.paid_events_json, []);
  const claim = lastClaim(pool, history);
  const [ctype, cid] = pool.claim_event.split(":");

  return (
    <Fragment>
      <tr className="hover:bg-white/5 transition-colors">
        <td className="px-3 py-4 max-w-[20rem]">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-start gap-2 text-left">
            {open ? <ChevronDown className="w-4 h-4 mt-0.5 shrink-0" /> : <ChevronRight className="w-4 h-4 mt-0.5 shrink-0" />}
            <span>
              <span className="block text-sm font-semibold line-clamp-2">{pool.name}</span>
              <span className="block text-xs font-mono text-muted-foreground mt-1">{pool.id}</span>
            </span>
          </button>
        </td>
        <td className="px-3 py-4 text-xs">
          <span className="block">{pool.hazards.split(",").map((h) => HAZARD_LABEL[h] ?? h).join(", ")}</span>
          <span className="block text-muted-foreground mt-1">{pool.countries.replaceAll(",", ", ")} · <span className={ALERT_STYLE[pool.min_alert]}>{pool.min_alert.toLowerCase()}+</span></span>
        </td>
        <td className="px-3 py-4 text-sm font-mono whitespace-nowrap">
          {formatGen(pool.balance)} GEN
          {wei(pool.total_paid) > 0n && <span className="block text-xs text-green-400">{formatGen(pool.total_paid)} paid</span>}
        </td>
        <td className="px-3 py-4"><StateBadge state={pool.state} /></td>
        <td className="px-3 py-4">
          {claim ? (
            <span className="space-y-1 block">
              <VerdictBadge verdict={claim.verdict} />
              <span className="block text-xs font-mono text-muted-foreground">{claim.key}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-white/[0.02]">
          <td colSpan={5} className="px-3 pb-6 pt-2">
            <div className="ml-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Terms (fixed at creation)</p>
                  <Terms pool={pool} />
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Recipient: <AddressDisplay address={pool.recipient} /></p>
                  <p>Created by: <AddressDisplay address={pool.creator} /> · {parseJson<string[]>(pool.donors_json, []).length} donor(s) · {formatGen(pool.total_donated)} GEN donated</p>
                  {paid.length > 0 && <p>Paid events: {paid.map((k) => <a key={k} href={gdacsUrl(k.split(":")[0], k.split(":")[1])} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-accent mr-2">{k}</a>)}</p>}
                </div>
                {pool.state === "pending" && (
                  <div className="rounded-md border border-white/10 p-3 space-y-1 text-xs">
                    <p className="font-semibold text-sm flex items-center gap-2">
                      Pending claim{" "}
                      <a href={gdacsUrl(ctype, cid)} target="_blank" rel="noopener noreferrer" className="font-mono inline-flex items-center gap-1 hover:text-accent">{pool.claim_event} <ExternalLink className="w-3 h-3" /></a>
                      <VerdictBadge verdict={pool.claim_verdict} />
                    </p>
                    <p className="text-muted-foreground">Why: {CODE_TEXT[pool.claim_code] ?? pool.claim_code}</p>
                    <p className="text-muted-foreground">
                      What validators read: {HAZARD_LABEL[facts.hazard ?? ""] ?? facts.hazard} · {(facts.countries ?? []).join(", ") || "no country"} · alert {facts.alert || "?"} · {facts.from_date || "no date"}
                      {facts.severity != null && <> · severity {facts.severity}</>}
                      {facts.usgs_mag != null && <> · USGS M{facts.usgs_mag}</>}
                      {facts.exposed != null && <> · {Number(facts.exposed).toLocaleString("en-US")} exposed</>}
                    </p>
                  </div>
                )}
                <PoolActions pool={pool} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">On-chain history</p>
                <ol className="space-y-1.5">
                  {[...history].reverse().map((h, i) => (
                    <li key={i} className="text-xs">
                      <span className="font-mono text-muted-foreground">{h.at.replace("T", " ")}</span>{" "}
                      <strong className="capitalize">{h.event}</strong>
                      {typeof h.event_key === "string" && <> · <span className="font-mono">{h.event_key}</span></>}
                      {typeof h.verdict === "string" && <> · {h.verdict}</>}
                      {typeof h.code === "string" && <> ({h.code})</>}
                      {h.event === "contested" && <> · by {String(h.by)}, was {String(h.before)}</>}
                      {h.amount ? <> · {formatGen(h.amount as string)} GEN</> : null}
                      {h.event === "closed" && <> · {formatGen(h.remaining as string)} GEN left for donors</>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
