import Link from "next/link";
import { categoryLabel,eventHref,eventLabel,formatEventTime,type LogbookEvent } from "@/lib/logbook";

export function LogbookEventRow({event}:{event:LogbookEvent}) {
  const href = eventHref(event);
  return <article className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 border-b border-[var(--lr-line-quiet)] py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)]">
    <time dateTime={event.occurred_at} className="pt-0.5 text-xs tabular-nums text-[var(--lr-ink-3)]">
      {formatEventTime(event.occurred_at,true)}
    </time>
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-semibold text-[var(--lr-ink)]">{eventLabel(event)}</span>
        <span className="text-xs text-[var(--lr-ink-3)]">{categoryLabel[event.event_category] ?? "Attività"}</span>
        {event.importance === "urgent" && <span className="text-xs font-semibold text-red-700">Urgente</span>}
        {event.requires_action && <span className="text-xs font-semibold text-amber-700">Richiede azione</span>}
        {event.sensitive && <span className="text-xs font-semibold text-amber-700">Fonte sensibile</span>}
      </div>
      <div className="flex flex-wrap gap-x-2 text-sm text-[var(--lr-ink-2)]">
        {href ? <Link href={href} className="font-medium underline underline-offset-2">
          {event.address ?? event.person_name ?? "Apri scheda"}
        </Link> : <span>{event.address ?? event.person_name ?? "Attività generale"}</span>}
        {event.person_name && event.address && <span>· {event.person_name}</span>}
        {event.locality && <span>· {event.locality}</span>}
      </div>
      {(event.description || event.outcome) && <p className="line-clamp-2 text-sm text-[var(--lr-ink-2)]">
        {event.description}{event.outcome && event.outcome !== "unverified" ? ` · ${event.outcome.replaceAll("_"," ")}` : ""}
      </p>}
      {event.requires_action && event.next_action_at && <p className="text-xs font-medium text-amber-800">
        {event.next_action_type ?? "Prossima azione"} · {formatEventTime(event.next_action_at,true)}
      </p>}
      {event.event_category === "MARKET" && event.importance === "attention" && event.lead_id
        && <p className="text-xs text-amber-800">Valuta la prossima azione sull’opportunità.</p>}
    </div>
  </article>;
}
