export function ArchiveLoading({label="Caricamento dell’archivio"}:{label?:string}){
 return <div role="status" aria-live="polite" aria-busy="true" className="space-y-3 py-6">
  <p className="font-medium">{label}…</p>
  <div role="progressbar" aria-label={label} className="h-1.5 overflow-hidden rounded-full bg-[var(--lr-raised)]">
   <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--lr-ink-2)] motion-reduce:animate-none"/>
  </div>
  <p className="text-sm text-[var(--lr-ink-3)]">Sto leggendo i dati. La pagina apparirà appena la lettura sarà completa.</p>
 </div>;
}
