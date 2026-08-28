import type { ReactNode } from "react";
import { clsx } from "clsx";

import { DatoAssente, Periodo, Stato, type StatoForma } from "@/components/ui/atoms";
import { Label } from "@/components/ui/primitives";
import { formatCurrency, formatDays, formatNumber } from "@/lib/formatting";

/**
 * Una casa, guardata la prima volta.
 *
 * È la parte che non cambia mai: le foto, il prezzo, i metri, i locali. Che la
 * casa la tenga un'agenzia che osserviamo o la teniamo noi, questa apertura è
 * la stessa — prima erano due pagine con due impaginazioni, due misure di
 * titolo e due modi di dire «superficie».
 */

export type CasaInSintesi = {
  indirizzo: string;
  /** «In vendita», «In affitto», o quello che il ciclo di vita ha capito. */
  contratto: string;
  prezzo: number | null;
  prezzoEtichetta: string;
  mq: number | null;
  locali: number | null;
  piano: number | null;
  foto: string[];
  statoTesto: string;
  statoForma: StatoForma;
  /** Da quanti giorni è sul mercato, quando lo sappiamo. */
  giorniSulMercato: number | null;
  giorniIncerti?: boolean;
  notaGiorni?: string;
};

/** Le foto: una scena principale e un piccolo contesto, senza occupare tutta la pagina. */
export function FotoDellaCasa({
  urls,
  alt,
  className,
}: Readonly<{ urls: string[]; alt: string; className?: string }>) {
  if (!urls.length) {
    return (
      <div
        className={clsx(
          "grid aspect-[16/9] w-full place-items-center rounded-[var(--lr-radius-card)] border border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] px-6 text-center",
          "text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]",
          className,
        )}
      >
        Di questa casa non abbiamo nessuna foto
      </div>
    );
  }

  const [prima, ...altre] = urls;
  const anteprime = altre.slice(0, 2);

  return (
    <div
      className={clsx(
        "grid aspect-[16/10] min-h-0 grid-cols-1 gap-2 overflow-hidden rounded-[var(--lr-radius-card)] bg-[var(--lr-raised)]",
        anteprime.length && "sm:grid-cols-[minmax(0,3fr)_minmax(8rem,1fr)] sm:grid-rows-2",
        className,
      )}
    >
      <div
        role="img"
        aria-label={alt}
        className={clsx(
          "min-h-0 w-full bg-[var(--lr-raised)] bg-cover bg-center",
          anteprime.length ? "sm:row-span-2" : "h-full",
        )}
        style={{ backgroundImage: `url("${prima}")` }}
      />
      {anteprime.map((url, indice) => (
        <div
          key={url}
          role="img"
          aria-label={`${alt}, foto ${indice + 2}`}
          className="hidden min-h-0 bg-[var(--lr-raised)] bg-cover bg-center sm:block"
          style={{ backgroundImage: `url("${url}")` }}
        />
      ))}
    </div>
  );
}

function Fatto({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <p className="mt-0.5 text-[length:var(--lr-text-record)] text-[var(--lr-ink)]">{children}</p>
    </div>
  );
}

export function ColpoDocchio({
  casa,
  children,
}: Readonly<{
  casa: CasaInSintesi;
  /** Quello che questa casa ha in più: un giudizio, la posizione, un mandato. */
  children?: ReactNode;
}>) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]">
      <FotoDellaCasa urls={casa.foto} alt={casa.indirizzo} />

      <div className="space-y-5 rounded-[var(--lr-radius-card)] border border-[var(--lr-line)] bg-[var(--lr-surface)] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--lr-line-quiet)] pb-5">
          <div>
            <Label>{casa.prezzoEtichetta}</Label>
            <p className="text-[length:var(--lr-text-page)] font-[650] leading-tight tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
              {formatCurrency(casa.prezzo)}
            </p>
          </div>
          <Stato forma={casa.statoForma}>{casa.statoTesto}</Stato>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          <Fatto label="Superficie">
            {casa.mq != null ? (
              `${formatNumber(casa.mq)} m²`
            ) : (
              <DatoAssente label="non dichiarata" />
            )}
          </Fatto>
          <Fatto label="Locali">
            {casa.locali != null ? (
              formatNumber(casa.locali)
            ) : (
              <DatoAssente label="non dichiarati" />
            )}
          </Fatto>
          <Fatto label="Piano">
            {casa.piano != null ? (
              casa.piano === 0 ? (
                "terra"
              ) : (
                formatNumber(casa.piano)
              )
            ) : (
              <DatoAssente label="non dichiarato" />
            )}
          </Fatto>
          <Fatto label="Sul mercato">
            {casa.giorniSulMercato != null ? (
              <Periodo
                from={`da almeno ${formatDays(casa.giorniSulMercato)}`}
                uncertain={casa.giorniIncerti}
                note={casa.notaGiorni}
              />
            ) : (
              <DatoAssente label="da quando non si sa" />
            )}
          </Fatto>
        </div>

        {children ? <div className="space-y-4 border-t border-[var(--lr-line-quiet)] pt-5">{children}</div> : null}
      </div>
    </section>
  );
}
