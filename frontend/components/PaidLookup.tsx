"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useReliefContract } from "@/lib/hooks/useReliefTrigger";
import { HAZARDS } from "@/lib/contracts/types";
import { classifyError } from "@/lib/utils/errors";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** The call a donor dashboard, auditor or another contract makes to see whether an event was funded. */
export function PaidLookup() {
  const contract = useReliefContract();
  const [pool, setPool] = useState("pool_0");
  const [type, setType] = useState("EQ");
  const [id, setId] = useState("1474477");
  const [result, setResult] = useState<boolean | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contract) return;
    setLoading(true);
    setErr("");
    setResult(null);
    try {
      setResult(await contract.wasPaid(pool.trim(), type, id.trim()));
    } catch (e) {
      const c = classifyError(e, "read");
      setErr(c.kind === "rate_limited" || c.kind === "rpc_unreachable" ? `${c.message} ${c.hint ?? ""}` : "No pool with that id.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="brand-card p-6 space-y-3">
      <h3 className="text-xl font-bold flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-accent" /> Integrator check</h3>
      <p className="text-sm text-muted-foreground">
        Reads <code className="text-xs">was_paid(pool_id, type, event_id)</code>: true once validators confirmed the event and the payout
        left the pool. Each event can pay a pool only once.
      </p>
      <form onSubmit={lookup} className="space-y-2">
        <div className="flex gap-2">
          <Input value={pool} onChange={(e) => setPool(e.target.value)} placeholder="pool_0" className="font-mono" aria-label="Pool id" />
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Event type" className="rounded-md border border-input bg-transparent px-2 text-sm">
            {HAZARDS.map((h) => <option key={h.code} value={h.code} className="bg-background">{h.code}</option>)}
          </select>
          <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="1474477" className="font-mono" aria-label="GDACS event id" />
        </div>
        <Button type="submit" variant="gradient" className="w-full" disabled={loading || !pool.trim() || !/^\d+$/.test(id.trim())}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check"}
        </Button>
      </form>
      {result !== null && (
        <p className={`text-sm ${result ? "text-green-400" : "text-muted-foreground"}`}>
          was_paid → {String(result)}. {result ? "This event was confirmed and paid from this pool." : "This event has not been paid from this pool."}
        </p>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
