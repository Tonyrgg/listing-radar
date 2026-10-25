'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateSellerCase } from '@/lib/actions/seller-workbench';
import { ACTIONS, CASE_STATUSES } from '@/lib/seller-intake/model';
import type { SellerCase } from '@/lib/seller-intake/repository';
import { buttonClass, controlClass } from './ui/primitives';
export function SellerCaseReview({ item }: { item: SellerCase }) {
  const [message, setMessage] = useState(''), [pending, startTransition] = useTransition();
  const router = useRouter();
  const dateInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!dateInput.current || !item.next_action_at) return;
    const d = new Date(item.next_action_at);
    dateInput.current.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  }, [item.next_action_at]);
  return <form className="grid gap-4" onSubmit={e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    startTransition(async () => {
      const status = String(f.get('status')), terminal = ['CLOSED','MANDATE','DO_NOT_CONTACT'].includes(status);
      const date = String(f.get('at') ?? '');
      const result = await updateSellerCase({ id: item.id, revision: item.revision, status,
        nextAction: terminal ? 'NONE' : f.get('action'),
        nextActionAt: terminal || !date ? null : new Date(date).toISOString(), note: f.get('note') });
      setMessage(result.error ?? 'Esito salvato.'); if (!result.error) router.refresh();
    });
  }}>
    <label className="grid gap-1">Esito / stato<select name="status" defaultValue={item.status} className={controlClass()}>
      {Object.entries(CASE_STATUSES).filter(([key]) => item.status==='DO_NOT_CONTACT' ? key==='DO_NOT_CONTACT' : item.kind === 'INBOUND' || ['NEW','IN_REVIEW','CLOSED','DO_NOT_CONTACT'].includes(key)).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
    </select></label>
    <label className="grid gap-1">Prossimo passo<select name="action" defaultValue={item.next_action} className={controlClass()}>
      {Object.entries(ACTIONS).filter(([key]) => item.status==='DO_NOT_CONTACT' ? key==='NONE' : item.kind === 'INBOUND' || ['VERIFY','NONE'].includes(key)).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
    </select></label>
    <label className="grid gap-1">Quando (orario del dispositivo)<input ref={dateInput} name="at" type="datetime-local" className={controlClass()} /></label>
    <p className="text-[var(--lr-ink-2)]">Per una pratica aperta indica giorno e ora. La chiusura annulla il prossimo passo e le consegne in attesa. “Non contattare” non può essere riaperto da questo flusso.</p>
    <label className="grid gap-1">Che cosa hai verificato o concordato?<textarea required name="note" maxLength={2000} className={controlClass('min-h-24')} /></label>
    <div><button disabled={pending} className={buttonClass('primary')}>{pending ? 'Salvataggio…' : 'Registra esito e prossimo passo'}</button></div>
    <p role="status" aria-live="polite">{message}</p>
  </form>;
}
