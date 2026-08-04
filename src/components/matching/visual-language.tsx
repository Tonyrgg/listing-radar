import type { LucideIcon } from "lucide-react";
import {
  Accessibility,
  ArrowDownToLine,
  ArrowUpToLine,
  Bath,
  BedDouble,
  Bike,
  Box,
  Building2,
  CalendarClock,
  Car,
  ChefHat,
  CircleParking,
  DoorOpen,
  Flower2,
  House,
  KeyRound,
  Layers3,
  MapPin,
  PackageOpen,
  PanelTopOpen,
  Ruler,
  Sofa,
  Sparkles,
  SquareStack,
  Store,
  Trees,
  UtilityPole,
  Warehouse,
  WashingMachine,
} from "lucide-react";

import type { ContractType } from "@/lib/matching/types";

const propertyTypeConfig: Record<string, { label: string; icon: LucideIcon }> = {
  apartment: { label: "Appartamento", icon: Building2 },
  independent_house: { label: "Casa indipendente", icon: House },
  villa: { label: "Villa", icon: Trees },
  townhouse: { label: "Villetta a schiera", icon: SquareStack },
  penthouse: { label: "Attico", icon: ArrowUpToLine },
  ground_floor: { label: "Piano terra", icon: ArrowDownToLine },
  entire_building: { label: "Intero stabile", icon: Store },
  commercial_space: { label: "Locale commerciale", icon: Store },
  office: { label: "Ufficio", icon: Building2 },
  warehouse: { label: "Deposito / magazzino", icon: Warehouse },
  garage: { label: "Garage / box", icon: Car },
  land: { label: "Terreno", icon: Trees },
  other: { label: "Altra tipologia", icon: Box },
};

const featureIcons: Record<string, LucideIcon> = {
  elevator: Layers3,
  balcony: PanelTopOpen,
  terrace: UtilityPole,
  garden: Flower2,
  veranda: PanelTopOpen,
  courtyard: Trees,
  garage: Warehouse,
  parking_space: CircleParking,
  cellar: Box,
  storage_room: PackageOpen,
  independent_entrance: DoorOpen,
  eat_in_kitchen: ChefHat,
  closet: Box,
  laundry_room: WashingMachine,
  second_bathroom: Bath,
  furnished: Sofa,
  accessible: Accessibility,
  rented_property_accepted: CalendarClock,
  ground_floor_accepted: ArrowDownToLine,
  basement_accepted: ArrowDownToLine,
};

export function propertyTypeLabel(value: string) {
  return propertyTypeConfig[value]?.label ?? value.replaceAll("_", " ");
}

export function ContractMark({
  type,
  className,
}: Readonly<{ type: ContractType; className?: string }>) {
  const Icon = type === "sale" ? KeyRound : CalendarClock;
  const label = type === "sale" ? "Acquisto" : "Affitto";
  return (
    <span
      title={label}
      className={`group/tooltip relative grid size-12 shrink-0 place-items-center rounded-[9px] border ${
        type === "sale"
          ? "border-[oklch(0.55_0.08_145)] bg-[oklch(0.23_0.035_145)] text-[var(--surface-accent)]"
          : "border-[oklch(0.52_0.07_80)] bg-[oklch(0.23_0.028_80)] text-[var(--status-warning)]"
      } ${className ?? ""}`}
    >
      <Icon aria-hidden="true" className="size-5" />
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-[6px] border border-[var(--line-strong)] bg-[var(--surface-elevated)] px-2 py-1 text-[11px] font-semibold text-[var(--ink-strong)] opacity-0 transition-opacity group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100">
        {label}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PropertyTypeMark({
  type,
  compact = false,
}: Readonly<{ type: string; compact?: boolean }>) {
  const config = propertyTypeConfig[type] ?? {
    label: propertyTypeLabel(type),
    icon: Building2,
  };
  const Icon = config.icon;
  return (
    <span
      title={config.label}
      className={`group/tooltip relative inline-flex items-center gap-2 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] text-[var(--ink-soft)] ${
        compact ? "min-h-8 px-2 text-xs" : "min-h-10 px-3 text-sm"
      }`}
    >
      <Icon aria-hidden="true" className="size-4 text-[var(--surface-accent)]" />
      {!compact ? config.label : <span className="sr-only">{config.label}</span>}
      {compact ? (
        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-[6px] border border-[var(--line-strong)] bg-[var(--surface-elevated)] px-2 py-1 text-[11px] font-semibold text-[var(--ink-strong)] opacity-0 transition-opacity group-hover/tooltip:opacity-100">
          {config.label}
        </span>
      ) : null}
    </span>
  );
}

export function FeatureMark({
  featureKey,
  label,
}: Readonly<{ featureKey: string; label: string }>) {
  const Icon = featureIcons[featureKey] ?? Sparkles;
  return (
    <span
      title={label}
      className="group/tooltip relative grid size-9 place-items-center rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] text-[var(--ink-soft)]"
    >
      <Icon aria-hidden="true" className="size-4" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-[6px] border border-[var(--line-strong)] bg-[var(--surface-elevated)] px-2 py-1 text-[11px] font-semibold text-[var(--ink-strong)] opacity-0 transition-opacity group-hover/tooltip:opacity-100">
        {label}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function VisualFact({
  icon: Icon,
  label,
  value,
  prominent = false,
}: Readonly<{
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  prominent?: boolean;
}>) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-[7px] bg-[var(--surface-muted)] text-[var(--ink-subtle)]">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[.09em] text-[var(--ink-subtle)]">
          {label}
        </p>
        <p className={`mt-0.5 truncate ${prominent ? "text-base font-bold text-[var(--ink-strong)]" : "text-sm font-semibold text-[var(--ink-soft)]"}`}>
          {value}
        </p>
      </div>
    </div>
  );
}

export const visualIcons = {
  area: Ruler,
  rooms: Layers3,
  bedrooms: BedDouble,
  bathrooms: Bath,
  zone: MapPin,
  garage: Car,
  bike: Bike,
};
