export function formatCurrency(value: number | null | undefined) {
  if (value == null) {
    return "Non disponibile";
  }

  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    /* Senza questo un prezzo a quattro cifre esce «7000 €». */
    useGrouping: true,
  }).format(value);
}

export function formatNumber(value: number | null | undefined) {
  if (value == null) {
    return "Non disponibile";
  }

  /* Anche qui: senza raggruppamento «1000 giorni» esce «1000». */
  return new Intl.NumberFormat("it-IT", { useGrouping: true }).format(value);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Non disponibile";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Non disponibile";
  }

  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Non disponibile";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Non disponibile";
  }

  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
  }).format(date);
}

/** Solo l'ora: dentro una giornata la data è già scritta sopra. */
export function formatTime(value: string | null | undefined) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function formatPlainText(value: string | null | undefined) {
  if (!value) {
    return "Non disponibile";
  }

  return value;
}

/**
 * Un testo che il portale non ha dato davvero.
 *
 * Nelle schede compariva una «zona» che era un paragrafo intero — «Vai alla
 * mappa StreetView … Vicino a: Fermate dei mezzi pubblici a 140m…» — e una
 * «descrizione» che era la parola «Italiano», cioè il selettore della lingua
 * finito dentro al campo. Sono errori di lettura del sito, e mostrarli come
 * se fossero dati fa credere che li conosciamo.
 */
export function isUsableText(
  value: string | null | undefined,
  { minLength = 1, maxLength = Number.POSITIVE_INFINITY } = {},
) {
  const testo = value?.trim() ?? "";

  if (testo.length < minLength || testo.length > maxLength) return false;

  /* Frammenti dell'impaginazione del portale, non dell'annuncio. */
  return !/(streetview|vicino a:|^italiano$|^english$)/i.test(testo);
}

/**
 * I siti e i gestionali scrivono agli estremi: «VIA PIEPOLI» in stampatello,
 * «via anita garibaldi, 4» tutto minuscolo. Nessuno dei due si legge bene in
 * mezzo a un'interfaccia tranquilla: qui tornano al maiuscolo iniziale.
 * Un testo già scritto normalmente non viene toccato.
 */
export function formatShouty(value: string) {
  const grida = value === value.toLocaleUpperCase("it");
  const sussurra = value === value.toLocaleLowerCase("it");

  if (!grida && !sussurra) {
    return value;
  }

  return value
    .toLocaleLowerCase("it")
    .replace(/(^|[\s'"«(\-–/])([a-zàèéìòù])/g, (_, prefisso: string, lettera: string) =>
      `${prefisso}${lettera.toLocaleUpperCase("it")}`,
    );
}

/** «1 giorno», «24 giorni»: il singolare non si scrive mai «1 giorni». */
export function formatDays(value: number) {
  return `${formatNumber(value)} ${value === 1 ? "giorno" : "giorni"}`;
}

export function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
