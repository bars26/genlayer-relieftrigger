"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Radio } from "lucide-react";
import { useRecentEvents } from "@/lib/hooks/useReliefTrigger";
import { pickEvent, usePickedEvent } from "@/lib/hooks/usePickedEvent";
import { ALERT_STYLE, HAZARD_LABEL } from "@/lib/contracts/types";
import { Button } from "./ui/button";

/** Recent Orange and Red GDACS alerts. Picking one pre-fills every pool's trigger form. */
export function RecentEvents() {
  const { data: events = [], isLoading, isError, refetch } = useRecentEvents();
  const picked = usePickedEvent();
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? events : events.slice(0, 8);

  return (
    <div className="brand-card p-6 space-y-3">
      <h3 className="text-xl font-bold flex items-center gap-2"><Radio className="w-5 h-5 text-accent" /> Recent GDACS alerts</h3>
      <p className="text-sm text-muted-foreground">
        Orange and Red alerts from the last 120 days. Click one to pre-fill the trigger form, then open a pool. The contract never
        trusts this list: validators fetch the event from GDACS themselves.
      </p>
      {isLoading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading GDACS...</p>}
      {isError && (
        <div className="text-sm space-y-2">
          <p className="text-destructive">GDACS could not be reached just now.</p>
          <Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button>
        </div>
      )}
      <ul className="space-y-1.5">
        {list.map((e) => {
          const active = picked?.type === e.type && picked?.id === e.id;
          return (
            <li key={`${e.type}:${e.id}`}>
              <div className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${active ? "border-accent bg-accent/10" : "border-white/10"}`}>
                <button type="button" onClick={() => pickEvent(e.type, e.id, e.name)} className="flex-1 text-left" aria-pressed={active}>
                  <span className="flex items-center gap-2">
                    <span className={`font-bold ${ALERT_STYLE[e.alert] ?? ""}`}>{e.alert.toLowerCase()}</span>
                    <span className="font-mono text-muted-foreground">{e.type}:{e.id}</span>
                    <span className="text-muted-foreground">{e.date}</span>
                  </span>
                  <span className="block mt-0.5 line-clamp-1">{e.name || HAZARD_LABEL[e.type]}</span>
                  {e.severity && <span className="block text-muted-foreground line-clamp-1">{e.severity}</span>}
                </button>
                <a href={e.url} target="_blank" rel="noopener noreferrer" aria-label="Open the GDACS report" className="pt-0.5 hover:text-accent">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      {events.length > 8 && (
        <Button size="sm" variant="secondary" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${events.length}`}</Button>
      )}
      {picked && <p className="text-xs text-accent">Picked {picked.type}:{picked.id}. Open a pool below to trigger it.</p>}
    </div>
  );
}
