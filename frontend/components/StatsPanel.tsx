"use client";

import { Coins } from "lucide-react";
import { useAllPools } from "@/lib/hooks/useReliefTrigger";
import { formatGen, parseJson, wei } from "@/lib/contracts/types";

export function StatsPanel() {
  const { pools } = useAllPools();
  const sum = (k: "balance" | "total_paid" | "total_donated") => pools.reduce((s, p) => s + wei(p[k]), 0n);
  const paidEvents = pools.reduce((n, p) => n + parseJson<string[]>(p.paid_events_json, []).length, 0);
  const count = (s: string) => pools.filter((p) => p.state === s).length;
  const cell = (label: string, value: string | number, cls = "") => (
    <div className="rounded-lg border border-white/10 p-3 text-center">
      <div className={`text-2xl font-bold ${cls}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
  return (
    <div className="brand-card p-6 space-y-4">
      <h3 className="text-xl font-bold flex items-center gap-2"><Coins className="w-5 h-5 text-accent" /> Pre-positioned now</h3>
      <div className="text-3xl font-bold">{formatGen(sum("balance"))} <span className="text-base text-muted-foreground">GEN</span></div>
      <div className="grid grid-cols-3 gap-3">
        {cell("Open", count("open"), "text-accent")}
        {cell("Claim pending", count("pending"), "text-orange-300")}
        {cell("Closed", count("closed"))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {cell("Paid to responders", `${formatGen(sum("total_paid"), 1)} GEN`, "text-green-400")}
        {cell("Qualifying events paid", paidEvents, "text-green-400")}
      </div>
      <p className="text-xs text-muted-foreground">{formatGen(sum("total_donated"), 1)} GEN donated across {pools.length} pool(s).</p>
    </div>
  );
}
