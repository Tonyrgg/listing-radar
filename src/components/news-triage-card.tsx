'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { decideNews, observeNews } from '@/lib/actions/news-triage';
import { REJECTION_REASONS, type NewsCandidate, type NewsFeedback, type NewsDecision } from '@/lib/property-lifecycle/buildings/news-triage';
import { NewsCardContent } from './news-card';
import { buttonClass } from './ui/primitives';
export function NewsTriageCard({ candidate, initialFeedback }: {
    candidate: NewsCandidate;
    initialFeedback?: NewsFeedback;
}) {
    const [feedback, setFeedback] = useState(initialFeedback), [rejecting, setRejecting] = useState(false), [message, setMessage] = useState(''), [pending, startTransition] = useTransition(), ref = useRef<HTMLElement>(null), router = useRouter();
    useEffect(() => {
        const node = ref.current;
        if (!node)
            return;
        let reported = false;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting) && !reported) {
                reported = true;
                observeNews(candidate.id).catch(() => { reported = false; });
            }
        }, { threshold: .25 });
        observer.observe(node);
        return () => observer.disconnect();
    }, [candidate.id]);
    function decide(decision: NewsDecision, reason: string | null = null) {
        startTransition(async () => {
            setMessage('');
            const result = await decideNews(candidate.id, decision, reason, feedback?.revision ?? 0);
            if (result.feedback) {
                setFeedback(result.feedback);
                setRejecting(false);
            }
            setMessage(result.error ?? 'Valutazione salvata.');
            router.refresh();
        });
    }
    return <article ref={ref} id={`notizia-${candidate.id}`} className="space-y-4 border-b border-[var(--lr-line)] py-8 first:pt-5">
  <NewsCardContent candidate={candidate} feedback={feedback} actions={<div className="space-y-3"><div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><button disabled={pending} onClick={() => decide('INTERESTING')} className={buttonClass('secondary')}>Interessante</button><button disabled={pending} onClick={() => decide('DEEPEN')} className={buttonClass('primary')}>{pending ? 'Salvataggio / lettura…' : 'Approfondisci'}</button><button disabled={pending} onClick={() => setRejecting(!rejecting)} aria-expanded={rejecting} className={buttonClass('quiet')}>Non utile</button></div>{rejecting ? <fieldset className="space-y-2"><legend className="font-medium">Perché non è utile? Facoltativo</legend><div className="flex flex-wrap gap-2">{Object.entries(REJECTION_REASONS).map(([key, label]) => <button key={key} disabled={pending} onClick={() => decide('NOT_USEFUL', key)} className={buttonClass('secondary')}>{label}</button>)}<button disabled={pending} onClick={() => decide('NOT_USEFUL')} className={buttonClass('quiet')}>Scarta senza motivo</button></div></fieldset> : null}<p role="status" aria-live="polite" className="text-[var(--lr-ink-2)]">{message}</p></div>}/>
 </article>;
}
