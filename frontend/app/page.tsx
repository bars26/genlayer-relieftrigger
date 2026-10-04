"use client";

import { Navbar } from "@/components/Navbar";
import { PoolsTable } from "@/components/PoolsTable";
import { StatsPanel } from "@/components/StatsPanel";
import { RecentEvents } from "@/components/RecentEvents";
import { PaidLookup } from "@/components/PaidLookup";
import { TransactionPanel } from "@/components/TransactionPanel";
import { EventMap } from "@/components/EventMap";
import { Coins, Radio, Send, ShieldCheck } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-grow pt-20 pb-12 px-4 md:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center mb-8">
            <div className="lg:col-span-5 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-accent">Anticipatory disaster relief on GenLayer</p>
              <h1 className="text-3xl md:text-4xl xl:text-5xl font-bold leading-tight">Fund before the disaster. Pay when it is confirmed.</h1>
              <p className="text-base md:text-lg text-muted-foreground">
                Relief money arrives weeks late because someone has to decide the disaster happened. Here donors decide in advance: they
                pre-fund a responder and write the trigger. When a GDACS alert matches, GenLayer validators confirm it against GDACS and
                USGS themselves and the payout goes straight to the responder&apos;s wallet.
              </p>
              <ol className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { icon: Coins, t: "1. Fund", d: "terms fixed up front" },
                  { icon: Radio, t: "2. Alert", d: "GDACS reports an event" },
                  { icon: ShieldCheck, t: "3. Verify", d: "GDACS + USGS, in code" },
                  { icon: Send, t: "4. Pay", d: "straight to the wallet" },
                ].map(({ icon: Icon, t, d }) => (
                  <li key={t} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                    <Icon className="w-4 h-4 text-accent shrink-0" />
                    <span>
                      <strong className="block text-foreground">{t}</strong>
                      <span className="text-muted-foreground">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="lg:col-span-7">
              <EventMap />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            <div className="lg:col-span-8">
              <h2 className="text-xl font-bold mb-4">Relief pools</h2>
              <PoolsTable />
            </div>
            <div className="lg:col-span-4 space-y-6">
              <StatsPanel />
              <RecentEvents />
              <PaidLookup />
              <TransactionPanel />
            </div>
          </div>

          <section className="mt-8 brand-card p-6 md:p-8">
            <h2 className="text-2xl font-bold mb-4">How it works</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-sm text-muted-foreground">
              <div className="space-y-2">
                <div className="text-accent font-bold text-lg">1. Pre-fund</div>
                <p>A donor names the responder&apos;s wallet and fixes the terms: hazards, countries, minimum GDACS alert, severity, people exposed, dates and an optional area condition. Anyone can add GEN to an open pool.</p>
              </div>
              <div className="space-y-2">
                <div className="text-accent font-bold text-lg">2. Trigger</div>
                <p>Anyone submits a GDACS event id. Every validator fetches the event from GDACS, and for earthquakes cross-checks the magnitude with USGS. Hazard, country, alert, dates, severity and exposure are decided in code.</p>
              </div>
              <div className="space-y-2">
                <div className="text-accent font-bold text-lg">3. Judge the area</div>
                <p>Only if every coded term passes, and the pool has an area condition, do the validators&apos; LLMs decide whether the event struck that area. The answer must be MEETS, DOES_NOT_MEET or UNCLEAR, and validators must agree exactly.</p>
              </div>
              <div className="space-y-2">
                <div className="text-accent font-bold text-lg">4. Pay or return</div>
                <p>For 10 minutes a donor or the recipient can ask once for a re-assessment. Then the payout goes to the responder; each event pays a pool once. After coverage ends, donors reclaim what is left pro-rata.</p>
              </div>
            </div>
          </section>
        </div>
      </main>
      <footer className="border-t border-white/10 py-3 text-center text-sm text-muted-foreground">
        Event data: <a href="https://www.gdacs.org" target="_blank" rel="noopener noreferrer" className="hover:text-accent">GDACS</a> and{" "}
        <a href="https://earthquake.usgs.gov" target="_blank" rel="noopener noreferrer" className="hover:text-accent">USGS</a>
        {" · "}
        <a href="https://genlayer.com" target="_blank" rel="noopener noreferrer" className="hover:text-accent">Powered by GenLayer</a>
        {" · "}
        <a href="https://github.com/bars26/genlayer-relieftrigger" target="_blank" rel="noopener noreferrer" className="hover:text-accent">Source</a>
      </footer>
    </div>
  );
}
