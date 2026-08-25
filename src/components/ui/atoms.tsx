import { clsx } from "clsx";
import type { ReactNode } from "react";

/* ===========================================================================
 * I sette atomi di Listing Radar.
 *
 * Non sono componenti generici: sono nati leggendo lo schema. Il modello
 * distingue certo da dedotto, conserva una confidenza per ogni affermazione e
 * un intervallo dove non sa una data — questi sette atomi sono il modo in cui
 * quelle distinzioni arrivano all'occhio.
 *
 * Regola del contratto: una pagina riscritta si compone da qui e non inventa
 * atomi propri. Se serve qualcosa che non c'è, si aggiunge in questo file.
 *
 *   1  Dato        valore + provenienza          evidence.confidence
 *   2  Periodo     data incerta con intervallo   true_market_start_*
 *   3  Fonte       nome + salute                 agencies · adapter_health
 *   4  Movimento   direzione + ampiezza          snapshots · events
 *   5  Stato       ciclo di vita, con forma      agency_listings.state
 *   6  Impronta    prova visiva confrontabile    image_fingerprints
 *   7  Giudizio    una parola + gli indizi       opportunities.level
 * ========================================================================= */

/* ---------------------------------------------------------------------------
 * 1 · Il Dato — un valore che dichiara da dove viene.
 *
 * «sure»    dichiarato dalla fonte, o confermato da te      pieno
 * «guess»   dedotto da noi                                  tratteggiato
 * «unknown» non lo sappiamo                                 sbiadito
 *
 * Un segno, tre stati, nessuna legenda da imparare.
 * ------------------------------------------------------------------------- */

export type Certainty = "sure" | "guess" | "unknown";

/** Traduce la confidenza del modello nei tre stati che l'occhio distingue. */
export function certaintyFromConfidence(
  confidence: number | null | undefined,
  options: { manuallyVerified?: boolean } = {},
): Certainty {
  if (options.manuallyVerified) return "sure";
  if (confidence == null) return "unknown";
  if (confidence >= 0.85) return "sure";
  return "guess";
}

const certaintyClass: Record<Certainty, string> = {
  sure: "",
  guess: "border-b border-dashed border-[var(--lr-ink-3)]",
  unknown: "text-[var(--lr-ink-3)] opacity-60",
};

const certaintyTitle: Record<Certainty, string> = {
  sure: "Dichiarato dalla fonte",
  guess: "Dedotto: la fonte non lo dichiara",
  unknown: "Non lo sappiamo",
};

export function Dato({
  children,
  certainty = "sure",
  hint,
  className,
}: Readonly<{
  children: ReactNode;
  certainty?: Certainty;
  /** Sostituisce la spiegazione predefinita, quando c'è di meglio da dire. */
  hint?: string;
  className?: string;
}>) {
  return (
    <span
      title={hint ?? certaintyTitle[certainty]}
      className={clsx("inline", certaintyClass[certainty], className)}
    >
      {children}
    </span>
  );
}

/** Il posto di un dato che manca: si vede che manca, non sparisce. */
export function DatoAssente({ label }: Readonly<{ label: string }>) {
  return (
    <span
      title="Non lo sappiamo"
      className="inline text-[var(--lr-ink-3)] opacity-60"
    >
      {label}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * 2 · Il Periodo — mai una data secca dove il modello ha un intervallo.
 *
 * Il campo si chiama `minimumDaysOnline` per un motivo: è un limite inferiore.
 * Scrivere «84 giorni» come se fosse un fatto tradisce il modello.
 * ------------------------------------------------------------------------- */

export function Periodo({
  from,
  uncertain = false,
  note,
  className,
}: Readonly<{
  /** Testo già formattato: «da giugno», «da almeno 84 giorni». */
  from: string;
  /** Vero quando il limite inferiore è l'unica cosa che sappiamo. */
  uncertain?: boolean;
  note?: string;
  className?: string;
}>) {
  /* Quando non sappiamo da quando è in vendita, non lo scriviamo: una riga in
   * meno è più onesta di «data ignota» accanto a un motivo che dice il contrario. */
  if (!from) {
    return null;
  }

  return (
    <span
      className={clsx("inline-flex flex-wrap items-baseline gap-1", className)}
      title={
        uncertain
          ? "È il primo momento in cui l'abbiamo vista: potrebbe essere online da prima."
          : undefined
      }
    >
      <span className={clsx(uncertain && "border-b border-dashed border-[var(--lr-ink-3)]")}>
        {from}
      </span>
      {uncertain ? (
        <span className="text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
          {note ?? "forse prima"}
        </span>
      ) : null}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * 3 · La Fonte — nome, mai colore.
 *
 * Con dieci agenzie la tinta non può identificare: nessuna palette regge dieci
 * categorie distinguibili, nemmeno per un occhio normale. Il nome si scrive; il
 * pallino dice soltanto se quella fonte è affidabile adesso.
 * ------------------------------------------------------------------------- */

export type SourceHealth = "healthy" | "partial" | "broken" | "unknown";

const healthDot: Record<SourceHealth, string> = {
  healthy: "bg-[var(--lr-accent)]",
  partial: "bg-[var(--lr-warn)]",
  broken: "bg-[var(--lr-danger)]",
  unknown: "bg-[var(--lr-line)]",
};

const healthTitle: Record<SourceHealth, string> = {
  healthy: "Letta per intero all'ultimo giro",
  partial: "Letta con limiti noti",
  broken: "Non letta: quello che vedi potrebbe essere incompleto",
  unknown: "Stato non noto",
};

export function Fonte({
  name,
  health = "unknown",
  note,
  className,
}: Readonly<{
  name: string;
  health?: SourceHealth;
  note?: string;
  className?: string;
}>) {
  return (
    <span
      className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap", className)}
      title={note ?? healthTitle[health]}
    >
      <span aria-hidden="true" className={clsx("size-1.5 shrink-0 rounded-full", healthDot[health])} />
      <span>{name}</span>
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * 4 · Il Movimento — direzione, ampiezza e da quanto.
 *
 * Un ribasso conta solo se sai di quanto e quando: il numero da solo non
 * decide niente.
 * ------------------------------------------------------------------------- */

export function Movimento({
  direction,
  amount,
  since,
  className,
  sinceClassName,
}: Readonly<{
  direction: "down" | "up" | "flat";
  /** Testo già formattato: «−17.000 €». */
  amount?: string;
  since?: string;
  className?: string;
  /** Per nascondere il contorno dove lo spazio non c'è: su un telefono
   * «di quanto è sceso» conta più di «a quanto è arrivato». */
  sinceClassName?: string;
}>) {
  if (direction === "flat") {
    return (
      <span className={clsx("text-[var(--lr-ink-3)]", className)}>
        {since ? `Fermo da ${since}` : "Prezzo fermo"}
      </span>
    );
  }

  return (
    <span
      className={clsx(
        "inline-flex items-baseline gap-1.5 font-medium",
        direction === "down" ? "text-[var(--lr-warn)]" : "text-[var(--lr-ink-2)]",
        className,
      )}
    >
      <span aria-hidden="true">{direction === "down" ? "↓" : "↑"}</span>
      <span>{amount}</span>
      {since ? (
        <span
          className={clsx(
            "font-normal text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]",
            sinceClassName,
          )}
        >
          {since}
        </span>
      ) : null}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * 5 · Lo Stato — sette stati agenzia e sei stati proprietà.
 *
 * Sono troppi per affidarli alla tinta: ognuno porta una forma.
 * ------------------------------------------------------------------------- */

export type StatoForma = "agenzia" | "privato" | "attesa" | "chiuso" | "venduto";

const formaClass: Record<StatoForma, string> = {
  agenzia: "bg-[var(--lr-ink-3)]",
  privato: "rounded-full bg-[var(--lr-accent)]",
  attesa: "rotate-45 bg-[var(--lr-warn)]",
  chiuso: "bg-[var(--lr-line)]",
  venduto: "rounded-full bg-[var(--lr-info)]",
};

/** Lo stato di un mandato d'agenzia, tradotto nella forma che gli spetta. */
export function formaFromAgencyState(state: string): StatoForma {
  if (state === "ACTIVE") return "agenzia";
  if (state === "EXIT_PENDING") return "attesa";
  if (state === "CLOSED_SOLD") return "venduto";
  return "chiuso";
}

/** Lo stato di una proprietà: privato e agenzia insieme contano come privato. */
export function formaFromPropertyState(state: string): StatoForma {
  if (state === "SOLD") return "venduto";
  if (state.includes("PRIVATE")) return "privato";
  if (state.startsWith("ACTIVE")) return "agenzia";
  return "chiuso";
}

export function Stato({
  forma,
  children,
  className,
}: Readonly<{
  forma: StatoForma;
  children: ReactNode;
  className?: string;
}>) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]",
        className,
      )}
    >
      <span aria-hidden="true" className={clsx("size-2 shrink-0", formaClass[forma])} />
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * 6 · L'Impronta — la prova visiva.
 *
 * L'identità di un immobile si decide guardando: le impronte percettive di
 * foto e planimetrie sono miniature confrontabili, non percentuali.
 * ------------------------------------------------------------------------- */

export function Impronta({
  count,
  kind = "foto",
  matched = true,
  className,
}: Readonly<{
  count: number;
  kind?: "foto" | "planimetria";
  matched?: boolean;
  className?: string;
}>) {
  if (count <= 0) return null;

  const label =
    kind === "planimetria"
      ? count === 1
        ? "planimetria"
        : "planimetrie"
      : count === 1
        ? "foto"
        : "foto";

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 text-[length:var(--lr-text-meta)]",
        matched ? "text-[var(--lr-accent)]" : "text-[var(--lr-ink-3)]",
        className,
      )}
      title={
        matched
          ? "Le stesse immagini compaiono in entrambi gli annunci"
          : "Immagini diverse fra i due annunci"
      }
    >
      <span aria-hidden="true" className="flex gap-0.5">
        {Array.from({ length: Math.min(count, 3) }).map((_, index) => (
          <span
            key={index}
            className={clsx(
              "h-3 w-4 rounded-[2px] bg-[var(--lr-raised)]",
              matched
                ? "shadow-[inset_0_0_0_1.5px_var(--lr-accent)]"
                : "shadow-[inset_0_0_0_1px_var(--lr-line)]",
            )}
          />
        ))}
      </span>
      <span>
        {count} {label} {matched ? "uguali" : "diverse"}
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * 7 · Il Giudizio — una parola, e gli indizi che la sostengono.
 *
 * Mai un numero da 0 a 100: «72» richiede di sapere cosa vuol dire 72.
 * «Alta, 3 indizi su 4» si legge in un istante.
 * ------------------------------------------------------------------------- */

export type Livello = "alta" | "media" | "bassa";

/** I livelli del lifecycle diventano parole che si leggono a colpo d'occhio. */
export function livelloFromOpportunity(level: string | null | undefined): Livello {
  const value = String(level ?? "").toUpperCase();
  if (value === "HOT" || value === "HIGH") return "alta";
  if (value === "INTERESTING") return "media";
  return "bassa";
}

/* «Alta», «Media», «Bassa» sono aggettivi senza il loro nome: da soli, in un
 * angolo di riga, «Media» si legge anche come una media aritmetica. Il giudizio
 * dice invece quanta attenzione merita quella casa, adesso. */
const livelloLabel: Record<Livello, string> = {
  alta: "Da chiamare",
  media: "Vale un'occhiata",
  bassa: "Da tenere d'occhio",
};

export function Giudizio({
  livello,
  signals,
  total,
  reason,
  align = "left",
  className,
}: Readonly<{
  livello: Livello;
  /** Quanti indizi sono maturati. */
  signals?: number;
  /** Su quanti possibili. */
  total?: number;
  /** La frase che lo spiega: senza, il giudizio non si mostra mai. */
  reason?: string;
  align?: "left" | "right";
  className?: string;
}>) {
  return (
    <span
      className={clsx(
        "inline-grid gap-0.5",
        align === "right" ? "justify-items-end text-right" : "justify-items-start",
        className,
      )}
    >
      <span
        className={clsx(
          "text-[length:var(--lr-text-record)] font-[650] leading-none",
          livello === "alta" ? "text-[var(--lr-ink)]" : "text-[var(--lr-ink-2)]",
        )}
      >
        {livelloLabel[livello]}
      </span>
      {signals != null && total != null ? (
        <span className="text-[length:var(--lr-text-label)] text-[var(--lr-ink-3)]">
          {signals} {signals === 1 ? "indizio" : "indizi"} su {total}
        </span>
      ) : null}
      {reason ? (
        <span className="mt-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]">
          {reason}
        </span>
      ) : null}
    </span>
  );
}
