"use client";

import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { Loader2, Plus, X } from "lucide-react";
import { usePoolWrite } from "@/lib/hooks/useReliefTrigger";
import { useWallet } from "@/lib/genlayer/wallet";
import { HAZARDS, MIN_POOL_WEI, THRESHOLD_UNIT, parseGen, todayUtc } from "@/lib/contracts/types";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { HazardIcon } from "./HazardIcon";

const EMPTY = {
  name: "",
  hazards: ["EQ"] as string[],
  countries: "",
  minAlert: "Orange",
  minExposed: "",
  areaTerms: "",
  payout: "2",
  amount: "5",
  coverageStart: todayUtc(),
  coverageEnd: "",
};
type Form = typeof EMPTY;
type Field = keyof Form | "recipients" | "thresholds";
type Row = { address: string; percent: string; label: string };
const ONE_ROW: Row[] = [{ address: "", percent: "100", label: "" }];
const MAX_RECIPIENTS = 5;

export function CreatePoolModal() {
  const { isConnected } = useWallet();
  const { writeAsync, pending } = usePoolWrite();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [rows, setRows] = useState<Row[]>(ONE_ROW);
  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  const setRow = (i: number, k: keyof Row, v: string) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    setErrors({ ...errors, recipients: "" });
  };
  const percentTotal = rows.reduce((t, r) => t + (Number(r.percent) || 0), 0);
  const busy = pending === "create";

  useEffect(() => {
    if (!isConnected && open && !busy) setOpen(false);
  }, [isConnected, open, busy]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
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
    const addrs = rows.map((r) => r.address.trim().toLowerCase());
    if (rows.some((r) => !isAddress(r.address.trim()))) next.recipients = "Every recipient needs a wallet address (0x...)";
    else if (new Set(addrs).size !== addrs.length) next.recipients = "Each wallet can appear only once";
    else if (rows.some((r) => !/^\d+$/.test(r.percent.trim()) || Number(r.percent) < 1 || Number(r.percent) > 100)) next.recipients = "Each share is a whole percent from 1 to 100";
    else if (percentTotal !== 100) next.recipients = `Shares add up to ${percentTotal}%; they must add up to 100%`;
    const usedThresholds = Object.entries(thresholds).filter(([h, v]) => form.hazards.includes(h) && v.trim());
    if (usedThresholds.some(([, v]) => !(/^\d+(\.\d+)?$/.test(v.trim()) && Number(v) > 0))) next.thresholds = "Thresholds are positive numbers, or leave them empty";
    if (form.hazards.length === 0) next.hazards = "Pick at least one hazard";
    if (countries.length === 0 || countries.some((c) => !/^[A-Z]{3}$/.test(c))) next.countries = "ISO3 codes separated by commas, e.g. MMR,THA";
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
          recipients: JSON.stringify(rows.map((r) => ({ address: r.address.trim(), percent: Number(r.percent), label: r.label.trim() }))),
          hazards: form.hazards.join(","),
          countries: countries.join(","),
          minAlert: form.minAlert,
          thresholds: usedThresholds.map(([h, v]) => `${h}:${v.trim()}`).join(","),
          minExposed: BigInt(form.minExposed.trim() || "0"),
          areaTerms: form.areaTerms.trim(),
          payout: payout!,
          coverageStart: form.coverageStart,
          coverageEnd: form.coverageEnd,
        },
      });
      setForm(EMPTY);
      setRows(ONE_ROW);
      setThresholds({});
      setOpen(false);
    } catch {
      // The error toast and the transaction panel already explain what happened.
    }
  };

  const field = (k: keyof Form, label: string, placeholder: string, hint?: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`cp-${k}`}>{label}</Label>
      <Input id={`cp-${k}`} value={form[k] as string} onChange={set(k)} placeholder={placeholder} className={errors[k] ? "border-destructive" : ""} {...extra} />
      {errors[k] ? <p className="text-xs text-destructive">{errors[k]}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="gradient" disabled={!isConnected} aria-label="Create pool" title="Create pool">
          <Plus className="w-4 h-4 sm:mr-2" /> <span className="hidden sm:inline">Create pool</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="brand-card border-2 sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Pre-fund a disaster response</DialogTitle>
          <DialogDescription>
            Write the trigger before the disaster. When a GDACS event matches these terms, validators confirm it and the payout goes
            straight to the recipients&apos; wallets, split by the shares you set. Terms cannot be changed later; unspent GEN goes back to donors pro-rata.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5 mt-2">
          {field("name", "Pool name", "e.g. Central Myanmar earthquake response")}
          <div className="space-y-1.5">
            <Label>Recipients and shares</Label>
            <p className="text-xs text-muted-foreground">Each payout is split between up to {MAX_RECIPIENTS} pre-agreed wallets, e.g. reforestation 50%, wildlife care 30%, displaced families 20%.</p>
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <Input value={r.address} onChange={(e) => setRow(i, "address", e.target.value)} placeholder="0x... wallet" className="font-mono text-sm flex-[3]" aria-label={`Recipient ${i + 1} wallet`} />
                <Input value={r.label} onChange={(e) => setRow(i, "label", e.target.value)} placeholder="Purpose" maxLength={40} className="text-sm flex-[2]" aria-label={`Recipient ${i + 1} purpose`} />
                <Input value={r.percent} onChange={(e) => setRow(i, "percent", e.target.value)} inputMode="numeric" className="font-mono text-sm w-16" aria-label={`Recipient ${i + 1} percent`} />
                <span className="self-center text-xs text-muted-foreground">%</span>
                {rows.length > 1 && (
                  <button type="button" aria-label={`Remove recipient ${i + 1}`} className="text-muted-foreground hover:text-destructive" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between text-xs">
              {rows.length < MAX_RECIPIENTS ? (
                <button type="button" className="text-accent hover:underline" onClick={() => setRows([...rows, { address: "", percent: "", label: "" }])}>+ Add a recipient</button>
              ) : <span />}
              <span className={percentTotal === 100 ? "text-muted-foreground" : "text-amber-400"}>Total {percentTotal}%</span>
            </div>
            {errors.recipients && <p className="text-xs text-destructive">{errors.recipients}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Hazards</Label>
            <div className="flex flex-wrap gap-2">
              {HAZARDS.map((h) => (
                <button
                  type="button"
                  key={h.code}
                  onClick={() => toggleHazard(h.code)}
                  aria-pressed={form.hazards.includes(h.code)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${form.hazards.includes(h.code) ? "border-accent bg-accent/15 text-accent" : "border-white/15 text-muted-foreground"}`}
                >
                  <HazardIcon code={h.code} className="w-3.5 h-3.5" />
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
            {form.hazards.filter((h) => THRESHOLD_UNIT[h]).map((h) => (
              <div key={h} className="space-y-1.5">
                <Label htmlFor={`cp-th-${h}`}>{THRESHOLD_UNIT[h].label} (optional)</Label>
                <Input id={`cp-th-${h}`} value={thresholds[h] ?? ""} onChange={(e) => { setThresholds({ ...thresholds, [h]: e.target.value }); setErrors({ ...errors, thresholds: "" }); }} placeholder={THRESHOLD_UNIT[h].placeholder} className="font-mono" />
                <p className="text-xs text-muted-foreground">{h === "WF" ? "GDACS reports a wildfire's burned area in hectares." : h === "EQ" ? "Cross-checked against USGS." : "GDACS maximum sustained wind."}</p>
              </div>
            ))}
            {errors.thresholds && <p className="text-xs text-destructive sm:col-span-2">{errors.thresholds}</p>}
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
