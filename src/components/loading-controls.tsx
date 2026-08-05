"use client";

import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  MouseEvent,
  ReactNode,
} from "react";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { clsx } from "clsx";

type PendingSubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  pendingLabel?: string;
  icon?: ReactNode;
};

export function PendingSubmitButton({
  children,
  pendingLabel = "Operazione in corso",
  icon,
  className,
  disabled,
  ...props
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <button
      {...props}
      disabled={isDisabled}
      aria-busy={pending}
      className={clsx(className, pending && "cursor-wait opacity-75")}
    >
      {pending ? (
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        icon
      )}
      {pending ? pendingLabel : children}
    </button>
  );
}

type LoadingAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
  pendingLabel?: string;
  icon?: ReactNode;
  href: string;
};

export function LoadingAnchor({
  children,
  pendingLabel = "Apertura",
  icon,
  className,
  onClick,
  href,
  ...props
}: LoadingAnchorProps) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!pending) {
      return;
    }

    const timer = window.setTimeout(() => setPending(false), 1600);
    return () => window.clearTimeout(timer);
  }, [pending]);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);

    if (
      !event.defaultPrevented &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      setPending(true);
    }
  }

  return (
    <a
      {...props}
      href={href}
      aria-busy={pending}
      onClick={handleClick}
      className={clsx(className, pending && "cursor-wait opacity-80")}
    >
      {pending ? (
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        icon
      )}
      {pending ? pendingLabel : children}
    </a>
  );
}

type LoadingLinkProps = {
  children: ReactNode;
  className?: string;
  href: string;
  pendingLabel?: string;
};

export function LoadingLink({
  children,
  className,
  href,
  pendingLabel = "Apertura",
}: LoadingLinkProps) {
  const [pending, setPending] = useState(false);

  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-busy={pending}
      onClick={() => setPending(true)}
      className={clsx(className, pending && "cursor-wait opacity-80")}
    >
      {pending ? (
        <>
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Link>
  );
}
