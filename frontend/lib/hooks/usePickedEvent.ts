"use client";

import { useSyncExternalStore } from "react";

/** The GDACS event chosen in the "Recent GDACS alerts" panel; trigger forms pre-fill from it. */
export type PickedEvent = { type: string; id: string; name: string; at: number };

let picked: PickedEvent | null = null;
const listeners = new Set<() => void>();

export function pickEvent(type: string, id: string, name: string) {
  picked = { type, id, name, at: Date.now() };
  listeners.forEach((l) => l());
}

export function usePickedEvent(): PickedEvent | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => picked,
    () => null
  );
}
