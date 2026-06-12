import { Badge } from "@/components/badge";
import {
  LISTING_SOURCE_OPTIONS,
  MONITORED_ZONE,
  REPORT_SCHEDULE,
} from "@/lib/constants";

export default function SettingsPage() {
  const telegramEnabled = Boolean(
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
  );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
          Settings
        </p>
        <h2 className="text-3xl font-semibold text-[var(--ink-strong)]">
          Configurazione corrente
        </h2>
      </header>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 shadow-[var(--shadow-panel)]">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
            Monitoraggio
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                Zona monitorata
              </p>
              <p className="mt-2 text-sm font-medium text-[var(--ink-strong)]">
                {MONITORED_ZONE}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                Orario report
              </p>
              <p className="mt-2 text-sm font-medium text-[var(--ink-strong)]">
                {REPORT_SCHEDULE}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                Telegram
              </p>
              <div className="mt-2">
                <Badge tone={telegramEnabled ? "green" : "amber"}>
                  {telegramEnabled ? "enabled" : "disabled"}
                </Badge>
              </div>
            </div>
          </div>
        </article>

        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 shadow-[var(--shadow-panel)]">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
            Fonti predisposte
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {LISTING_SOURCE_OPTIONS.map((source) => (
              <Badge key={source} tone="slate">
                {source}
              </Badge>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
