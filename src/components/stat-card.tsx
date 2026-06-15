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
    <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4 shadow-[var(--shadow-panel)]">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold text-[var(--surface-accent)]">{value}</p>
      {hint ? (
        <p className="mt-2 text-sm text-[var(--ink-soft)]">{hint}</p>
      ) : null}
    </article>
  );
}
