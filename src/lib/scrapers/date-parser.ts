const MONTHS: Record<string, number> = {
  gennaio: 0,
  gen: 0,
  febbraio: 1,
  feb: 1,
  marzo: 2,
  mar: 2,
  aprile: 3,
  apr: 3,
  maggio: 4,
  mag: 4,
  giugno: 5,
  giu: 5,
  luglio: 6,
  lug: 6,
  agosto: 7,
  ago: 7,
  settembre: 8,
  set: 8,
  ottobre: 9,
  ott: 9,
  novembre: 10,
  nov: 10,
  dicembre: 11,
  dic: 11,
};

function applyTime(date: Date, text: string) {
  const timeMatch = text.match(/(?:alle|ore)?\s*(\d{1,2})[:.](\d{2})/i);

  if (!timeMatch) {
    return date;
  }

  date.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
  return date;
}

function safeIso(date: Date) {
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseItalianDate(text: string | null | undefined) {
  if (!text) {
    return null;
  }

  const value = text.toLowerCase().replace(/\s+/g, " ").trim();
  const directDate = new Date(text);

  if (!Number.isNaN(directDate.getTime()) && /\d{4}/.test(text)) {
    return directDate.toISOString();
  }

  const now = new Date();

  if (/\boggi\b/.test(value)) {
    return safeIso(applyTime(new Date(now), value));
  }

  if (/\bieri\b/.test(value)) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return safeIso(applyTime(date, value));
  }

  const relativeMatch = value.match(
    /(\d+)\s*(minut[oi]|ore?|giorn[oi]|settimane?|mesi|ann[oi])\s+fa/,
  );

  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2];
    const date = new Date(now);

    if (unit.startsWith("minut")) {
      date.setMinutes(date.getMinutes() - amount);
    } else if (unit.startsWith("or")) {
      date.setHours(date.getHours() - amount);
    } else if (unit.startsWith("giorn")) {
      date.setDate(date.getDate() - amount);
    } else if (unit.startsWith("settiman")) {
      date.setDate(date.getDate() - amount * 7);
    } else if (unit.startsWith("mes")) {
      date.setMonth(date.getMonth() - amount);
    } else if (unit.startsWith("ann")) {
      date.setFullYear(date.getFullYear() - amount);
    }

    return safeIso(date);
  }

  const numericMatch = value.match(
    /(\d{1,2})[/. -](\d{1,2})(?:[/. -](\d{2,4}))?/,
  );

  if (numericMatch) {
    const day = Number(numericMatch[1]);
    const month = Number(numericMatch[2]) - 1;
    const year = numericMatch[3]
      ? Number(numericMatch[3].length === 2 ? `20${numericMatch[3]}` : numericMatch[3])
      : now.getFullYear();
    const date = applyTime(new Date(year, month, day), value);

    if (!numericMatch[3] && date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      date.setFullYear(date.getFullYear() - 1);
    }

    return safeIso(date);
  }

  const monthNames = Object.keys(MONTHS).join("|");
  const monthMatch = value.match(
    new RegExp(`(\\d{1,2})\\s+(${monthNames})(?:\\s+(\\d{4}))?`, "i"),
  );

  if (monthMatch) {
    const day = Number(monthMatch[1]);
    const month = MONTHS[monthMatch[2]];
    const year = monthMatch[3] ? Number(monthMatch[3]) : now.getFullYear();
    const date = applyTime(new Date(year, month, day), value);

    if (!monthMatch[3] && date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      date.setFullYear(date.getFullYear() - 1);
    }

    return safeIso(date);
  }

  return null;
}
