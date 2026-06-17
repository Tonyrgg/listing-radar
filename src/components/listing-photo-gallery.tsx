"use client";

/* External portal images must be requested directly because their hosts are dynamic. */
/* eslint-disable @next/next/no-img-element */

import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { useMemo, useState } from "react";

export function ListingPhotoGallery({
  title,
  imageUrls,
}: Readonly<{
  title: string;
  imageUrls: string[];
}>) {
  const [selectedUrl, setSelectedUrl] = useState(imageUrls[0] ?? null);
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const availableUrls = useMemo(
    () => imageUrls.filter((url) => !failedUrls.includes(url)),
    [failedUrls, imageUrls],
  );
  const activeUrl =
    selectedUrl && availableUrls.includes(selectedUrl)
      ? selectedUrl
      : availableUrls[0] ?? null;

  function markFailed(url: string) {
    setFailedUrls((current) =>
      current.includes(url) ? current : [...current, url],
    );
  }

  function selectAdjacent(direction: -1 | 1) {
    if (!activeUrl || availableUrls.length < 2) return;

    const currentIndex = availableUrls.indexOf(activeUrl);
    const nextIndex =
      (currentIndex + direction + availableUrls.length) % availableUrls.length;
    setSelectedUrl(availableUrls[nextIndex]);
  }

  if (!activeUrl) {
    return (
      <section className="flex h-56 items-center justify-center rounded-[7px] border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)] sm:h-72 xl:h-[360px]">
        <div className="text-center text-[var(--ink-subtle)]">
          <ImageOff aria-hidden="true" className="mx-auto size-7" />
          <p className="mt-3 text-sm font-medium">Nessuna foto acquisita</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="relative space-y-3"
      aria-label={`Foto di ${title}`}
    >
      <a
        href={activeUrl}
        target="_blank"
        rel="noreferrer"
        className="group relative block h-56 overflow-hidden rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] sm:h-72 xl:h-[360px]"
      >
        <img
          src={activeUrl}
          alt={title}
          className="size-full object-contain"
          referrerPolicy="no-referrer"
          onError={() => markFailed(activeUrl)}
        />
        <span className="absolute bottom-3 right-3 rounded-md bg-[var(--surface-canvas)] px-3 py-2 text-xs font-medium text-[var(--ink-strong)] opacity-90 transition-opacity group-hover:opacity-100">
          Apri foto
          <span className="sr-only">Apri la foto originale</span>
        </span>
      </a>

      {availableUrls.length > 1 ? (
        <div className="pointer-events-none absolute inset-x-3 top-1/2 flex -translate-y-1/2 justify-between">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              selectAdjacent(-1);
            }}
            className="pointer-events-auto inline-flex size-9 items-center justify-center rounded-full border border-[var(--line-soft)] bg-[var(--surface-canvas)] text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]"
            aria-label="Foto precedente"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              selectAdjacent(1);
            }}
            className="pointer-events-auto inline-flex size-9 items-center justify-center rounded-full border border-[var(--line-soft)] bg-[var(--surface-canvas)] text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]"
            aria-label="Foto successiva"
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}

      {availableUrls.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {availableUrls.map((url, index) => (
            <button
              key={url}
              type="button"
              onClick={() => setSelectedUrl(url)}
              className={
                url === activeUrl
                  ? "h-16 w-24 shrink-0 overflow-hidden rounded-md border-2 border-[var(--surface-accent)] bg-[var(--surface-muted)] sm:h-20 sm:w-28"
                  : "h-16 w-24 shrink-0 overflow-hidden rounded-md border border-[var(--line-soft)] bg-[var(--surface-muted)] sm:h-20 sm:w-28"
              }
              aria-label={`Mostra foto ${index + 1}`}
            >
              <img
                src={url}
                alt=""
                className="size-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => markFailed(url)}
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
