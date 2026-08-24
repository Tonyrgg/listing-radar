export default function PrivateAreaLoading() {
  return (
    <div className="space-y-7" aria-busy="true" aria-label="Caricamento pagina">
      <div className="border-b border-[var(--lr-line-quiet)] pb-6">
        <div className="h-3 w-28 animate-pulse rounded bg-[var(--lr-raised)]" />
        <div className="mt-3 h-9 w-full max-w-md animate-pulse rounded bg-[var(--lr-raised)]" />
        <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded bg-[var(--lr-raised)]" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-24 animate-pulse rounded-lg border border-[var(--lr-line)] bg-[var(--lr-surface)]"
          />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-lg border border-[var(--lr-line)] bg-[var(--lr-surface)]" />
    </div>
  );
}
