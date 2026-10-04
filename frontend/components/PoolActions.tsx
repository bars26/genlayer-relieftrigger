"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { usePoolWrite } from "@/lib/hooks/useReliefTrigger";
import { usePickedEvent } from "@/lib/hooks/usePickedEvent";
import { useWallet } from "@/lib/genlayer/wallet";
import {
  CONTEST_WINDOW_SECONDS,
  HAZARDS,
  MIN_DONATION_WEI,
  coverageEnded,
  formatGen,
  isDonor,
  parseGen,
  sameAddress,
  secondsSince,
  wei,
  type Pool,
} from "@/lib/contracts/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/** The actions the connected wallet can take on this pool right now, and why others are not offered. */
export function PoolActions({ pool }: { pool: Pool }) {
  const { address, isConnected } = useWallet();
  const { write, pending } = usePoolWrite();
  const [amount, setAmount] = useState("1");
  const picked = usePickedEvent();
  const [type, setType] = useState(picked?.type ?? pool.hazards.split(",")[0] ?? "EQ");
  const [eventId, setEventId] = useState(picked?.id ?? "");
  useEffect(() => {
    if (picked) {
      setType(picked.type);
      setEventId(picked.id);
    }
  }, [picked]);
  const busy = (kind: string) => pending === `${kind}:${pool.id}`;

  if (!isConnected) {
    return <p className="text-sm text-muted-foreground">Connect a wallet to donate, trigger or resolve.</p>;
  }

  const donor = isDonor(pool, address);
  const recipient = sameAddress(address, pool.recipient);
  const ended = coverageEnded(pool);
  const windowLeft = Math.max(0, CONTEST_WINDOW_SECONDS - secondsSince(pool.claim_at));
  const windowOpen = pool.state === "pending" && !pool.claim_contested && windowLeft > 0;
  const meets = pool.claim_verdict === "MEETS";
  const canContest = windowOpen && (donor || recipient);
  const canResolve = pool.state === "pending" && (!windowOpen || (meets && donor) || (!meets && recipient));
  const donationWei = parseGen(amount);
  const donationLow = donationWei === null || donationWei < MIN_DONATION_WEI;
  const idValid = /^\d{1,10}$/.test(eventId.trim());

  const btn = (kind: string, label: string, onClick: () => void, variant: "gradient" | "secondary" = "gradient", disabled = false) => (
    <Button size="sm" variant={variant} onClick={onClick} disabled={!!pending || disabled}>
      {busy(kind) ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
      {label}
    </Button>
  );

  const triggerForm = (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Trigger with a GDACS event</p>
      <p className="text-xs text-muted-foreground">
        Anyone can trigger. Every validator reads the event from GDACS (and USGS for earthquakes) and checks it against the terms.
        Pick one from &quot;Recent GDACS alerts&quot; or paste the id from a gdacs.org report URL.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`type-${pool.id}`}>Type</Label>
          <select
            id={`type-${pool.id}`}
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {HAZARDS.map((h) => (
              <option key={h.code} value={h.code} className="bg-background">{h.code} · {h.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`event-${pool.id}`}>GDACS event id</Label>
          <Input id={`event-${pool.id}`} value={eventId} onChange={(e) => setEventId(e.target.value)} placeholder="1474477" className="w-36 font-mono" />
        </div>
        {btn("trigger", "Trigger", () => write({ kind: "trigger", id: pool.id, type, eventId: eventId.trim() }), "gradient", !idValid)}
      </div>
    </div>
  );

  if (pool.state === "closed") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Coverage has ended. Each donor can take back their pro-rata share of the {formatGen(pool.closing_balance)} GEN that was not paid out.
        </p>
        {donor ? btn("reclaim", "Reclaim my share", () => write({ kind: "reclaim", id: pool.id })) : null}
      </div>
    );
  }

  if (pool.state === "pending") {
    return (
      <div className="space-y-2">
        {windowOpen && (
          <p className="text-sm text-muted-foreground">
            Contest window: <strong>{Math.ceil(windowLeft / 60)} min</strong> left. A donor or the recipient can ask once for an
            independent re-assessment. A donor can release a payout early; the recipient can dismiss a failed claim early.
          </p>
        )}
        {pool.claim_contested && <p className="text-sm text-muted-foreground">Contested once. Anyone can resolve it now.</p>}
        <div className="flex flex-wrap gap-2">
          {canContest && btn("contest", "Contest (re-assess)", () => write({ kind: "contest", id: pool.id }), "secondary")}
          {canResolve &&
            btn(
              "resolve",
              meets ? `Release ${formatGen(wei(pool.payout) < wei(pool.balance) ? pool.payout : pool.balance)} GEN` : "Dismiss claim",
              () => write({ kind: "resolve", id: pool.id })
            )}
        </div>
        {!canResolve && (
          <p className="text-xs text-muted-foreground">
            Anyone can resolve after the window. Before that, only a donor can release a payout and only the recipient can dismiss.
          </p>
        )}
        {!meets && wei(pool.balance) > 0n && (
          <div className="pt-3 space-y-1">
            <p className="text-xs text-muted-foreground">
              This claim pays nothing, so a new trigger replaces it right away (it is recorded as superseded).
            </p>
            {triggerForm}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-lg">
      {!ended && wei(pool.balance) > 0n && triggerForm}
      {!ended && (
        <div className="flex items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={`donate-${pool.id}`}>Donate (GEN)</Label>
            <Input id={`donate-${pool.id}`} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28 font-mono" />
          </div>
          {btn("donate", "Donate", () => write({ kind: "donate", id: pool.id, value: donationWei! }), "secondary", donationLow)}
          {donationLow && <p className="text-xs text-destructive pb-2">At least 0.1 GEN.</p>}
        </div>
      )}
      {ended && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Coverage ended on {pool.coverage_end}. Anyone can close the pool so donors can reclaim.</p>
          {btn("close", "Close pool", () => write({ kind: "close", id: pool.id }))}
        </div>
      )}
      {!ended && wei(pool.balance) === 0n && <p className="text-xs text-muted-foreground">The pool is empty; donate to re-arm it.</p>}
    </div>
  );
}
