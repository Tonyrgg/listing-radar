import { setMonthlyFocusAction } from "@/app/(private)/logbook/actions";

export function FocusToggle({month,entity,id,active}:{
  month:string;entity:"lead"|"contact"|"client"|"property";id:string;active:boolean;
}) {
  return <form action={setMonthlyFocusAction}>
    <input type="hidden" name="month" value={month}/>
    <input type="hidden" name="entity" value={entity}/>
    <input type="hidden" name="entity_id" value={id}/>
    <input type="hidden" name="enabled" value={String(!active)}/>
    <button className="rounded border border-[var(--lr-line)] px-2 py-1 text-xs font-medium hover:bg-[var(--lr-raised)]">
      {active ? "Rimuovi dal Focus" : "+ Focus del mese"}
    </button>
  </form>;
}
