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
    <article className="rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)] p-4">
      <p className="text-[length:var(--lr-text-meta)] font-medium uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-[var(--lr-ink)]">
        {value}
      </p>
      {hint ? (
        <p className="mt-2 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">{hint}</p>
      ) : null}
    </article>
  );
}
