/** End of the current civil day in Italy, independent of the server timezone. */
const zone = "Europe/Rome";

function offsetMinutes(at: Date): number {
  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, timeZoneName: "shortOffset", hour: "numeric",
  }).formatToParts(at).find(x => x.type === "timeZoneName")?.value ?? "GMT+1";
  const match = offsetPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) throw new Error(`Unexpected Rome offset: ${offsetPart}`);
  return (match[1] === "+" ? 1 : -1) *
    (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

export function romeLocalToUtc(raw: string): Date {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Data e ora locale non valide.");
  const [year,month,day,hour,minute] = match.slice(1).map(Number);
  const candidate = Date.UTC(year,month-1,day,hour,minute);
  const result = new Date(candidate - offsetMinutes(new Date(candidate)) * 60000);
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",
    hourCycle:"h23",
  }).format(result).replace(" ","T");
  if (local !== raw) throw new Error("Ora locale inesistente nel cambio d'ora.");
  return result;
}

export function utcToRomeLocalInput(raw: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",
    hourCycle:"h23",
  }).formatToParts(new Date(raw));
  const part = (type:string) => parts.find(x=>x.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function italianDayEnd(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(x => x.type === type)?.value ?? "";
  const year = Number(part("year")), month = Number(part("month")), day = Number(part("day"));
  // At 21:59 UTC the matching Rome date is still the selected date in both
  // CET and CEST. Its offset is also the offset of that day's final hour.
  const nearEnd = new Date(Date.UTC(year,month-1,day,21,59,59));
  return new Date(Date.UTC(year,month-1,day,23,59,59,999) - offsetMinutes(nearEnd) * 60000);
}
