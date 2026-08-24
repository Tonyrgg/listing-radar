import { Card } from "@/components/ui/primitives";

export default function MatchingLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Sto calcolando gli abbinamenti">
      <div className="border-b border-[var(--lr-line-quiet)] pb-5">
        <div className="h-3 w-28 animate-pulse rounded bg-[var(--lr-raised)]" />
        <div className="mt-2 h-7 w-52 animate-pulse rounded bg-[var(--lr-raised)]" />
        <div className="mt-4 flex gap-2">
          {[0, 1, 2, 3, 4, 5].map((tab) => (
            <div key={tab} className="h-9 w-28 animate-pulse rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)]" />
          ))}
        </div>
      </div>
      <Card className="h-24 animate-pulse" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="h-56 animate-pulse" />
        <Card className="h-56 animate-pulse" />
      </div>
    </div>
  );
}
