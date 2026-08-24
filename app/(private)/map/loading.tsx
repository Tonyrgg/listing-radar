import { Card } from "@/components/ui/primitives";

export default function MapLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Sto caricando la mappa">
      <div className="border-b border-[var(--lr-line-quiet)] pb-5">
        <div className="h-3 w-20 animate-pulse rounded bg-[var(--lr-raised)]" />
        <div className="mt-2 h-7 w-56 animate-pulse rounded bg-[var(--lr-raised)]" />
        <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded bg-[var(--lr-raised)]" />
      </div>
      <Card className="h-[calc(100vh-260px)] min-h-[520px] animate-pulse" />
    </div>
  );
}
