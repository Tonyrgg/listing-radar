"use client";

import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { LoaderCircle } from "lucide-react";

export function AutoSubmitFiltersForm({
  children,
  className,
}: Readonly<{
  children: ReactNode;
  className?: string;
}>) {
  const formRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isScheduled, setIsScheduled] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isBusy = isScheduled || isPending;

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  function scheduleSubmit() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    setIsScheduled(true);
    timerRef.current = setTimeout(() => {
      startTransition(() => {
        setIsScheduled(false);
        formRef.current?.requestSubmit();
      });
    }, 500);
  }

  return (
    <form
      ref={formRef}
      className={className}
      aria-busy={isBusy}
      onChange={scheduleSubmit}
      onInput={scheduleSubmit}
    >
      {children}
      {isBusy ? (
        <span
          className="fixed bottom-4 right-4 z-50 inline-flex h-10 items-center gap-2 rounded-[6px] border border-[var(--line-strong)] bg-[var(--surface-panel)] px-3 text-xs font-semibold text-[var(--ink-strong)] shadow-lg shadow-black/20"
          role="status"
        >
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          Aggiorno elenco
        </span>
      ) : null}
    </form>
  );
}
