"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { usePoolWrite } from "@/lib/hooks/useReliefTrigger";
import { usePickedEvent } from "@/lib/hooks/usePickedEvent";
import { useWallet } from "@/lib/genlayer/wallet";
import { useNow } from "@/lib/hooks/useNow";
import {
  CONTEST_WINDOW_SECONDS,
  HAZARDS,
  approvalPercent,
  claimWeight,
  hasApproved,
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
  useNow();

  if (!isConnected) {
    return <p className="text-sm text-muted-foreground">Connect a wallet to donate, trigger or resolve.</p>;
  }

  const donor = isDonor(pool, address);
  const recipient = sameAddress(address, pool.recipient);
  const ended = coverageEnded(pool);
  const windowLeft = Math.max(0, CONTEST_WINDOW_SECONDS - secondsSince(pool.claim_at));
  const windowOpen = pool.state === "pending" && windowLeft > 0;
  const meets = pool.claim_verdict === "MEETS";
  const myWeight = claimWeight(pool, address);
  const approved = hasApproved(pool, address);
  // The side a ruling goes against may contest it once: donors (pre-claim, not the recipient)
  // a payout, the recipient anything else. Each contest restarts the window.
  const canContest = windowOpen && (meets ? myWeight > 0n && !pool.donor_contested : recipient && !pool.recipient_contested);
  const canApprove = pool.state === "pending" && meets && windowOpen && myWeight > 0n && !approved;
  const canResolve = pool.state === "pending" && (!windowOpen || (!meets && recipient));
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
    const pct = approvalPercent(pool);
    return (
      <div className="space-y-3">
        {windowOpen ? (
          <p className="text-sm text-muted-foreground">
            Contest window: <strong>{Math.ceil(windowLeft / 60)} min</strong> left
            {pool.claim_contested ? " (restarted by a contest)" : ""}.{" "}
            {meets
              ? "Donors who gave before this claim can contest it once, or release it early with a majority of their donations."
              : "The recipient can contest it once or dismiss it early."}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">The contest window has passed. Anyone can resolve the claim.</p>
        )}
        {meets && windowOpen && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Early-release approvals</span>
              <span>
                {formatGen(pool.approval_weight)} of {formatGen(pool.claim_weight_total)} GEN ({pct}%, needs over 50%)
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-green-500" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {canApprove && btn("approve", `Approve release (your say: ${formatGen(myWeight)} GEN)`, () => write({ kind: "approve", id: pool.id }))}
          {canContest && btn("contest", "Contest (re-assess)", () => write({ kind: "contest", id: pool.id }), "secondary")}
          {canResolve &&
            btn(
              "resolve",
              meets ? `Release ${formatGen(wei(pool.payout) < wei(pool.balance) ? pool.payout : pool.balance)} GEN` : windowOpen ? "Dismiss claim now" : "Dismiss claim",
              () => write({ kind: "resolve", id: pool.id })
            )}
        </div>
        {meets && windowOpen && myWeight === 0n && donor && (
          <p className="text-xs text-muted-foreground">
            {recipient ? "As the recipient you have no say in releasing your own payout." : "Your donation came after this claim was opened, so it gives no say in this claim."}
          </p>
        )}
        {approved && windowOpen && <p className="text-xs text-green-400">You approved this release.</p>}
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
