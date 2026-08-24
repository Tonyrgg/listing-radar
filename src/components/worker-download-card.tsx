import { Download, MonitorDown } from "lucide-react";

import { Card, Chip, Label, Meta, buttonClass } from "@/components/ui/primitives";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type PublishedRelease = {
  version: string;
  releaseDate: string | null;
  size: number | null;
};

/**
 * Da qui si installa il Property Worker su un computer nuovo.
 * Il pacchetto è lo stesso che usa l'aggiornamento automatico: chi lo installa
 * parte dall'ultima versione pubblicata e da lì in poi si aggiorna da solo.
 */
async function readPublishedRelease(): Promise<PublishedRelease | null> {
  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase.storage
      .from("property-worker-updates")
      .download("latest.json");

    if (error || !data) {
      return null;
    }

    const manifest = JSON.parse(await data.text()) as Partial<PublishedRelease>;

    return manifest.version
      ? {
          version: manifest.version,
          releaseDate: manifest.releaseDate ?? null,
          size: manifest.size ?? null,
        }
      : null;
  } catch {
    return null;
  }
}

function formatSize(bytes: number | null) {
  if (!bytes) return null;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function formatDate(value: string | null) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export async function WorkerDownloadCard() {
  const release = await readPublishedRelease();

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex size-9 items-center justify-center rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)] text-[var(--lr-ink-2)]">
              <MonitorDown aria-hidden="true" className="size-4" />
            </span>
            <div>
              <Label>Programma per Windows</Label>
              <h2 className="mt-0.5 text-[length:var(--lr-text-section)] font-[650] tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
                Property Worker
              </h2>
            </div>
            <Chip tone={release ? "info" : "warn"} dot>
              {release ? `Versione ${release.version}` : "Nessuna versione pubblicata"}
            </Chip>
          </div>

          <p className="mt-4 max-w-prose text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
            {release
              ? "Installalo su qualunque computer: il programma controlla da solo se esiste una versione più recente e la scarica quando glielo chiedi."
              : "Non risulta pubblicata nessuna versione. Dal computer di sviluppo, esegui «npm run desktop:release» dentro la cartella worker."}
          </p>
        </div>

        {release ? (
          <a href="/api/property-worker/download" download className={buttonClass("primary")}>
            <Download aria-hidden="true" className="size-4" />
            Scarica il programma
          </a>
        ) : null}
      </div>

      {release ? (
        <dl className="mt-5 grid gap-4 border-t border-[var(--lr-line-quiet)] pt-5 sm:grid-cols-3">
          <div>
            <Label>Versione pubblicata</Label>
            <dd className="mt-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink)]">
              {release.version}
            </dd>
          </div>
          <div>
            <Label>Pubblicata il</Label>
            <dd className="mt-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink)]">
              {formatDate(release.releaseDate) ?? "Data non disponibile"}
            </dd>
          </div>
          <div>
            <Label>Dimensione</Label>
            <dd className="mt-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink)]">
              {formatSize(release.size) ?? "Non disponibile"}
            </dd>
          </div>
        </dl>
      ) : null}

      <Meta className="mt-4">
        Il download richiede l&apos;accesso a Listing Radar: il pacchetto non è
        raggiungibile da chi non ha effettuato l&apos;accesso.
      </Meta>
    </Card>
  );
}
