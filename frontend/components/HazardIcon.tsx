import { Activity, Flame, Mountain, Sun, Tornado, Waves, type LucideIcon } from "lucide-react";
import { HAZARD_LABEL } from "@/lib/contracts/types";

const ICONS: Record<string, LucideIcon> = {
  EQ: Activity,
  TC: Tornado,
  FL: Waves,
  VO: Mountain,
  DR: Sun,
  WF: Flame,
};

export function HazardIcon({ code, className = "w-4 h-4" }: { code: string; className?: string }) {
  const Icon = ICONS[code] ?? Activity;
  return <Icon className={className} aria-label={HAZARD_LABEL[code] ?? code} role="img" />;
}
