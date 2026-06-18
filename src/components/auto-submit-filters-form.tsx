"use client";

import { type ReactNode, useRef, useTransition } from "react";

export function AutoSubmitFiltersForm({
  children,
  className,
}: Readonly<{
  children: ReactNode;
  className?: string;
}>) {
  const formRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, startTransition] = useTransition();

  function scheduleSubmit() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      startTransition(() => {
        formRef.current?.requestSubmit();
      });
    }, 500);
  }

  return (
    <form
      ref={formRef}
      className={className}
      onChange={scheduleSubmit}
      onInput={scheduleSubmit}
    >
      {children}
    </form>
  );
}
