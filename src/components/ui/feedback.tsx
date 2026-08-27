"use client";

import { clsx } from "clsx";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import { FLASH_COOKIE, type Flash } from "@/lib/flash-shared";
import { Button, buttonClass } from "@/components/ui/primitives";

/* ---------------------------------------------------------------------------
 * Conferma di un'azione riuscita, o spiegazione di un fallimento.
 * ------------------------------------------------------------------------- */

const toneStyle = {
  success: {
    stripe: "bg-[var(--lr-ok)]",
    icon: <Check aria-hidden="true" className="size-4 text-[var(--lr-ok)]" />,
  },
  danger: {
    stripe: "bg-[var(--lr-danger)]",
    icon: <AlertTriangle aria-hidden="true" className="size-4 text-[var(--lr-danger)]" />,
  },
  info: {
    stripe: "bg-[var(--lr-info)]",
    icon: <Info aria-hidden="true" className="size-4 text-[var(--lr-info)]" />,
  },
} as const;

export function FlashToast({ flash }: Readonly<{ flash: Flash | null }>) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!flash) return;

    /* Il messaggio è stato consegnato: il cookie ha esaurito il suo compito. */
    document.cookie = `${FLASH_COOKIE}=; Path=/; Max-Age=0`;

    // Gli errori restano finché non li si chiude: vanno letti.
    if (flash.tone === "danger") return;

    const timer = window.setTimeout(() => setDismissed(true), 6000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const visible = Boolean(flash) && !dismissed;
  const setVisible = (next: boolean) => setDismissed(!next);

  if (!flash || !visible) {
    return null;
  }

  const style = toneStyle[flash.tone];

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex justify-center px-4 pb-5"
    >
      <div className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)] p-3 shadow-[var(--lr-floating)]">
        <span aria-hidden="true" className={clsx("w-[3px] shrink-0 self-stretch rounded-full", style.stripe)} />
        <span className="mt-0.5 shrink-0">{style.icon}</span>
        <p className="min-w-0 flex-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink)]">
          {flash.message}
        </p>
        {flash.undoHref && flash.undoLabel ? (
          <Link
            href={flash.undoHref}
            onClick={() => setVisible(false)}
            className={buttonClass("quiet", { compact: true })}
          >
            {flash.undoLabel}
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Chiudi il messaggio"
          className="grid size-8 shrink-0 place-items-center rounded-[var(--lr-radius-control)] text-[var(--lr-ink-3)] transition-colors hover:bg-[var(--lr-raised)] hover:text-[var(--lr-ink)]"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Conferma prima di un'azione irreversibile — dentro il prodotto,
 * mai la finestra grigia del browser.
 * ------------------------------------------------------------------------- */

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "No, torna indietro",
  onConfirm,
  onCancel,
  pending = false,
}: Readonly<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}>) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[210] grid place-items-center bg-[rgb(0_0_0/0.6)] p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)] p-5 shadow-[var(--lr-floating)]"
      >
        <p className="text-[length:var(--lr-text-label)] font-[650] uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-danger)]">
          Conferma richiesta
        </p>
        <h2
          id={titleId}
          className="mt-2 text-[length:var(--lr-text-section)] font-[650] leading-tight tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]"
        >
          {title}
        </h2>
        <p className="mt-2 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">{description}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" compact onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            autoFocus
            type="button"
            variant="danger"
            compact
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Un istante…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Invia un form solo dopo una conferma disegnata nel prodotto.
 * Sostituisce ogni `window.confirm`.
 */
export function ConfirmSubmit({
  children,
  title,
  description,
  confirmLabel,
  className,
}: Readonly<{
  children: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  className?: string;
}>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  function submitOwnerForm() {
    const form = ref.current?.closest("form");
    setOpen(false);
    form?.requestSubmit();
  }

  return (
    <span ref={ref} className={className}>
      <span onClickCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
      }}>
        {children}
      </span>
      <ConfirmDialog
        open={open}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        onConfirm={submitOwnerForm}
        onCancel={() => setOpen(false)}
      />
    </span>
  );
}

/**
 * Bottone che chiede conferma dentro il prodotto prima di eseguire.
 * Sostituisce ogni `window.confirm` rimasto nei pannelli di gestione.
 */
export function ConfirmAction({
  children,
  title,
  description,
  confirmLabel,
  onConfirm,
  className,
  disabled = false,
  ariaLabel,
}: Readonly<{
  children: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen(true)}
        className={className}
      >
        {children}
      </button>
      <ConfirmDialog
        open={open}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        onConfirm={() => {
          setOpen(false);
          onConfirm();
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
