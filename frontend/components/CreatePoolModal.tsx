"use client";

import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { Loader2, Plus } from "lucide-react";
import { usePoolWrite } from "@/lib/hooks/useReliefTrigger";
import { useWallet } from "@/lib/genlayer/wallet";
import { HAZARDS, MIN_POOL_WEI, parseGen, todayUtc } from "@/lib/contracts/types";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const EMPTY = {
  name: "",
  recipient: "",
  hazards: ["EQ"] as string[],
  countries: "",
  minAlert: "Orange",
  minSeverity: "",
  minExposed: "",
  areaTerms: "",
  payout: "2",
  amount: "5",
  coverageStart: todayUtc(),
  coverageEnd: "",
};
type Form = typeof EMPTY;
type Field = keyof Form;

export function CreatePoolModal() {
  const { isConnected } = useWallet();
  const { writeAsync, pending } = usePoolWrite();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const busy = pending === "create";

  useEffect(() => {
    if (!isConnected && open && !busy) setOpen(false);
  }, [isConnected, open, busy]);

  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setErrors({ ...errors, [k]: "" });
  };
  const toggleHazard = (code: string) => {
    const hazards = form.hazards.includes(code) ? form.hazards.filter((h) => h !== code) : [...form.hazards, code];
    setForm({ ...form, hazards });
    setErrors({ ...errors, hazards: "" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    const value = parseGen(form.amount);
    const payout = parseGen(form.payout);
    const countries = form.countries.toUpperCase().split(",").map((c) => c.trim()).filter(Boolean);
    if (!form.name.trim()) next.name = "Name the pool";
    if (!isAddress(form.recipient.trim())) next.recipient = "Paste the responder's wallet address (0x...)";
    if (form.hazards.length === 0) next.hazards = "Pick at least one hazard";
    if (countries.length === 0 || countries.some((c) => !/^[A-Z]{3}$/.test(c))) next.countries = "ISO3 codes separated by commas, e.g. MMR,THA";
    if (form.minSeverity.trim() && !(/^\d+(\.\d+)?$/.test(form.minSeverity.trim()) && Number(form.minSeverity) > 0))
      next.minSeverity = "A positive number, or leave empty";
    if (form.minExposed.trim() && !/^\d+$/.test(form.minExposed.trim())) next.minExposed = "A whole number, or leave empty";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.coverageStart)) next.coverageStart = "Pick a date";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.coverageEnd) || form.coverageEnd < todayUtc()) next.coverageEnd = "Today or later (UTC)";
    else if (form.coverageEnd < form.coverageStart) next.coverageEnd = "Must be on or after the start";
    if (value === null || value < MIN_POOL_WEI) next.amount = "At least 1 GEN";
    if (payout === null || payout <= 0n) next.payout = "A positive amount";
    else if (value !== null && payout > value) next.payout = "No more than the initial funding";
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      await writeAsync({
        kind: "create",
        value: value!,
        input: {
          name: form.name.trim(),
          recipient: form.recipient.trim(),
          hazards: form.hazards.join(","),
          countries: countries.join(","),
          minAlert: form.minAlert,
          minSeverity: form.minSeverity.trim(),
          minExposed: BigInt(form.minExposed.trim() || "0"),
          areaTerms: form.areaTerms.trim(),
          payout: payout!,
          coverageStart: form.coverageStart,
          coverageEnd: form.coverageEnd,
        },
      });
      setForm(EMPTY);
      setOpen(false);
    } catch {
      // The error toast and the transaction panel already explain what happened.
    }
  };

  const field = (k: Field, label: string, placeholder: string, hint?: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`cp-${k}`}>{label}</Label>
      <Input id={`cp-${k}`} value={form[k] as string} onChange={set(k)} placeholder={placeholder} className={errors[k] ? "border-destructive" : ""} {...extra} />
      {errors[k] ? <p className="text-xs text-destructive">{errors[k]}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="gradient" disabled={!isConnected}>
          <Plus className="w-4 h-4 mr-2" /> Create pool
        </Button>
      </DialogTrigger>
      <DialogContent className="brand-card border-2 sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Pre-fund a disaster response</DialogTitle>
          <DialogDescription>
            Write the trigger before the disaster. When a GDACS event matches these terms, validators confirm it and the payout goes
            straight to the responder&apos;s wallet. Terms cannot be changed later; unspent GEN goes back to donors pro-rata.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5 mt-2">
          {field("name", "Pool name", "e.g. Central Myanmar earthquake response")}
          {field("recipient", "Recipient wallet", "0x...", "The pre-agreed responder (NGO, local partner). Payouts go only here.", { className: `font-mono text-sm ${errors.recipient ? "border-destructive" : ""}` })}
          <div className="space-y-1.5">
            <Label>Hazards</Label>
            <div className="flex flex-wrap gap-2">
              {HAZARDS.map((h) => (
                <button
                  type="button"
                  key={h.code}
                  onClick={() => toggleHazard(h.code)}
                  aria-pressed={form.hazards.includes(h.code)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${form.hazards.includes(h.code) ? "border-accent bg-accent/15 text-accent" : "border-white/15 text-muted-foreground"}`}
                >
                  {h.label}
                </button>
              ))}
            </div>
            {errors.hazards && <p className="text-xs text-destructive">{errors.hazards}</p>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field("countries", "Countries (ISO3)", "MMR,THA", "Any affected country listed by GDACS counts.", { className: `font-mono ${errors.countries ? "border-destructive" : ""}` })}
            <div className="space-y-1.5">
              <Label htmlFor="cp-minAlert">Minimum GDACS alert</Label>
              <select id="cp-minAlert" value={form.minAlert} onChange={set("minAlert")} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                {["Green", "Orange", "Red"].map((a) => <option key={a} className="bg-background">{a}</option>)}
              </select>
            </div>
            {field("minSeverity", "Minimum severity (optional)", "7", "Earthquake magnitude or cyclone wind in km/h.")}
            {field("minExposed", "Minimum people exposed (optional)", "1000000", "Earthquakes: people in MMI VII+ shaking, per GDACS.")}
            {field("coverageStart", "Events from", "", undefined, { type: "date" })}
            {field("coverageEnd", "Events until", "", "Then anyone can close the pool.", { type: "date" })}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-areaTerms">Area condition (optional, judged by validators&apos; LLMs)</Label>
            <textarea
              id="cp-areaTerms"
              value={form.areaTerms}
              onChange={set("areaTerms")}
              rows={2}
              maxLength={600}
              placeholder="e.g. The earthquake struck the Mandalay or Sagaing Region of central Myanmar."
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">Only asked after every numeric term already passed in code. Leave empty to pay on the coded terms alone.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field("amount", "Initial funding (GEN)", "5", "At least 1 GEN.", { className: `font-mono ${errors.amount ? "border-destructive" : ""}` })}
            {field("payout", "Payout per event (GEN)", "2", "Capped by what is left in the pool.", { className: `font-mono ${errors.payout ? "border-destructive" : ""}` })}
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="gradient" className="flex-1" disabled={busy}>
              {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</> : "Create pool"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
