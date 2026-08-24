import styles from "./lifecycle.module.css";

export default function LifecycleLoading() {
  return (
    <div className={styles.workspace} aria-label="Caricamento Property Lifecycle">
      <div className="h-48 animate-pulse rounded-[10px] border border-[var(--lr-line)] bg-[var(--lr-surface)]" />
      <div className="grid gap-4 lg:grid-cols-[1.6fr_0.72fr]">
        <div className="h-[420px] animate-pulse rounded-[10px] border border-[var(--lr-line)] bg-[var(--lr-surface)]" />
        <div className="h-[320px] animate-pulse rounded-[10px] border border-[var(--lr-line)] bg-[var(--lr-surface)]" />
      </div>
    </div>
  );
}
