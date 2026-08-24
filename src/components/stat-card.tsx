export function StatCard({
  label,
  value,
  hint,
}: Readonly<{
  label: string;
  value: number;
  hint?: string;
}>) {
  return (
    <article className="rounded-[10px] border border-[var(--lr-line)] bg-[var(--lr-surface)] p-4">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--lr-ink-3)]">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-[var(--lr-ink)]">
        {value}
      </p>
      {hint ? (
        <p className="mt-2 text-sm text-[var(--lr-ink-2)]">{hint}</p>
      ) : null}
    </article>
  );
}
