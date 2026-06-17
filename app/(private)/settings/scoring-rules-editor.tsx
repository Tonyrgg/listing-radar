"use client";

import { Pencil } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveScoringConfig } from "@/app/(private)/settings/actions";
import type { ScoringConfig } from "@/lib/listings/scoring-config";

const scoringRows: Array<{
  key: keyof ScoringConfig;
  label: string;
  help: string;
}> = [
  {
    key: "privateSeller",
    label: "Venditore privato",
    help: "Premia gli annunci con contatto diretto.",
  },
  {
    key: "agencySeller",
    label: "Annuncio di agenzia",
    help: "Penalizza quando il contatto non e diretto.",
  },
  {
    key: "unknownSeller",
    label: "Venditore sconosciuto",
    help: "Penalita quando il tipo venditore non e chiaro.",
  },
  { key: "newToday", label: "Nuovo oggi", help: "Premio per annunci appena rilevati." },
  {
    key: "visiblePhone",
    label: "Telefono visibile",
    help: "Premio quando e presente un recapito.",
  },
  {
    key: "online60Days",
    label: "Online da 60 giorni",
    help: "Premio per annunci online da almeno 60 giorni.",
  },
  {
    key: "online120Days",
    label: "Online da 120 giorni",
    help: "Premio per annunci online da almeno 120 giorni.",
  },
  { key: "priceDrop", label: "Ribasso", help: "Premio quando il prezzo e sceso." },
  {
    key: "negotiablePrice",
    label: "Prezzo trattabile",
    help: "Premio se la descrizione dichiara trattabilita.",
  },
  {
    key: "noAgencies",
    label: "No agenzie",
    help: "Premio se il venditore esclude intermediari.",
  },
  {
    key: "missingPrice",
    label: "Prezzo mancante",
    help: "Penalita quando manca il prezzo.",
  },
  {
    key: "missingSqm",
    label: "Superficie mancante",
    help: "Penalita quando manca la superficie.",
  },
  {
    key: "missingDescription",
    label: "Descrizione insufficiente",
    help: "Penalita per schede poco informative.",
  },
  { key: "auction", label: "Asta", help: "Penalita per aste o procedure." },
  {
    key: "highPriorityThreshold",
    label: "Soglia alta appetibilita",
    help: "Da questo valore un annuncio diventa prioritario.",
  },
];

function formatScoreValue(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function equalConfig(left: ScoringConfig, right: ScoringConfig) {
  return scoringRows.every((row) => left[row.key] === right[row.key]);
}

function toFormData(config: ScoringConfig) {
  const formData = new FormData();

  scoringRows.forEach((row) => {
    formData.set(row.key, String(config[row.key]));
  });

  return formData;
}

export function ScoringRulesEditor({
  initialConfig,
}: Readonly<{ initialConfig: ScoringConfig }>) {
  const router = useRouter();
  const [savedConfig, setSavedConfig] = useState(initialConfig);
  const [draftConfig, setDraftConfig] = useState(initialConfig);
  const [isEditing, setIsEditing] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isDirty = useMemo(
    () => !equalConfig(savedConfig, draftConfig),
    [savedConfig, draftConfig],
  );

  useEffect(() => {
    if (!isDirty) return;

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;

    function interceptNavigation(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      const link =
        target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;

      if (!link || link.target || link.hasAttribute("download")) {
        return;
      }

      const destination = new URL(link.href, window.location.href);

      if (destination.origin !== window.location.origin) {
        return;
      }

      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search &&
        destination.hash === window.location.hash
      ) {
        return;
      }

      event.preventDefault();
      setPendingHref(`${destination.pathname}${destination.search}${destination.hash}`);
    }

    document.addEventListener("click", interceptNavigation, true);
    return () => document.removeEventListener("click", interceptNavigation, true);
  }, [isDirty]);

  function updateDraft(key: keyof ScoringConfig, value: string) {
    const parsed = Number(value);
    setDraftConfig((current) => ({
      ...current,
      [key]: Number.isFinite(parsed) ? parsed : 0,
    }));
  }

  function cancelEditing() {
    setDraftConfig(savedConfig);
    setIsEditing(false);
    setError(null);
  }

  function saveChanges(onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const nextConfig = await saveScoringConfig(toFormData(draftConfig));
        setSavedConfig(nextConfig);
        setDraftConfig(nextConfig);
        setIsEditing(false);
        onDone?.();
        router.refresh();
      } catch {
        setError("Salvataggio non riuscito. Riprova.");
      }
    });
  }

  function keepEditing() {
    setPendingHref(null);
  }

  function discardAndNavigate() {
    const destination = pendingHref;
    setDraftConfig(savedConfig);
    setPendingHref(null);
    setIsEditing(false);

    if (destination) {
      router.push(destination);
    }
  }

  return (
    <section className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]">
      <div className="flex min-h-14 items-center justify-between gap-4 border-b border-[var(--line-soft)] px-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--ink-strong)]">
              Regole di appetibilita
            </h2>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--line-strong)] text-[var(--surface-accent)] transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isEditing}
              aria-label="Modifica regole di appetibilita"
            >
              <Pencil aria-hidden="true" className="size-3.5" />
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--ink-subtle)]">
            {isEditing ? "Modifica attiva" : "Lettura"}
            {isDirty ? " - modifiche non salvate" : ""}
          </p>
        </div>
        <span className="text-xs text-[var(--ink-subtle)]">
          Salvate in database
        </span>
      </div>

      <div className="p-5">
        {isEditing ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {scoringRows.map((row) => (
              <label
                key={row.key}
                className="grid gap-3 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] p-4"
              >
                <span>
                  <span className="block text-sm font-semibold text-[var(--ink-strong)]">
                    {row.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--ink-subtle)]">
                    {row.help}
                  </span>
                </span>
                <input
                  type="number"
                  value={draftConfig[row.key]}
                  onChange={(event) => updateDraft(row.key, event.target.value)}
                  className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3 text-sm font-semibold text-[var(--ink-strong)]"
                />
              </label>
            ))}
          </div>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {scoringRows.map((row) => (
              <div
                key={row.key}
                className="rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] p-4"
              >
                <dt className="text-sm font-semibold text-[var(--ink-strong)]">
                  {row.label}
                </dt>
                <dd className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-xs leading-5 text-[var(--ink-subtle)]">
                    {row.help}
                  </span>
                  <strong className="shrink-0 rounded-md border border-[var(--line-soft)] px-2 py-1.5 text-sm tabular-nums text-[var(--ink-strong)]">
                    {formatScoreValue(savedConfig[row.key])}
                  </strong>
                </dd>
              </div>
            ))}
          </dl>
        )}

        {error ? (
          <p className="mt-4 text-sm font-medium text-[var(--status-error)]">
            {error}
          </p>
        ) : null}

        {isEditing ? (
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => saveChanges()}
              disabled={isPending}
              className="h-11 rounded-md bg-[var(--surface-accent)] px-5 text-sm font-semibold text-[var(--button-ink)] transition-colors hover:bg-[var(--surface-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Salvataggio..." : "Salva modifiche"}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              disabled={isPending}
              className="h-11 rounded-md border border-[var(--line-strong)] px-5 text-sm font-medium text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Annulla
            </button>
          </div>
        ) : null}
      </div>

      {pendingHref ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[oklch(0.08_0.02_154/0.72)] px-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-scoring-title"
            className="w-full max-w-md rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 shadow-[0_24px_70px_oklch(0.05_0.02_154/0.55)]"
          >
            <h3
              id="unsaved-scoring-title"
              className="text-lg font-semibold text-[var(--ink-strong)]"
            >
              Modifiche non salvate
            </h3>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
              Hai cambiato le regole di appetibilita. Vuoi salvarle prima di uscire?
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => {
                  const destination = pendingHref;
                  saveChanges(() => {
                    setPendingHref(null);
                    if (destination) router.push(destination);
                  });
                }}
                disabled={isPending}
                className="h-10 rounded-md bg-[var(--surface-accent)] px-4 text-sm font-semibold text-[var(--button-ink)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Salva
              </button>
              <button
                type="button"
                onClick={discardAndNavigate}
                disabled={isPending}
                className="h-10 rounded-md border border-[var(--line-strong)] px-4 text-sm font-medium text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Esci senza salvare
              </button>
              <button
                type="button"
                onClick={keepEditing}
                disabled={isPending}
                className="h-10 rounded-md border border-[var(--line-strong)] px-4 text-sm font-medium text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Continua modifica
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
