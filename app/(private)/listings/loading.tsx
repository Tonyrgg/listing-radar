import { Card } from "@/components/ui/primitives";

export default function ListingsLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Sto caricando l'archivio">
      <div className="border-b border-[var(--lr-line-quiet)] pb-5">
        <div className="h-3 w-20 animate-pulse rounded bg-[var(--lr-raised)]" />
        <div className="mt-2 h-7 w-64 animate-pulse rounded bg-[var(--lr-raised)]" />
        <div className="mt-2 h-4 w-80 animate-pulse rounded bg-[var(--lr-raised)]" />
      </div>
      <div className="flex gap-3">
        <div className="h-16 flex-1 animate-pulse rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)]" />
        <div className="h-16 flex-1 animate-pulse rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)]" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((row) => (
          <Card key={row} className="h-36 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
