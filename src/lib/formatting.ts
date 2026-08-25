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

export function formatPlainText(value: string | null | undefined) {
  if (!value) {
    return "Non disponibile";
  }

  return value;
}

export function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
