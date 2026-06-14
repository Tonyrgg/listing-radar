"use client";

/* External portal images must be requested directly because their hosts are dynamic. */
/* eslint-disable @next/next/no-img-element */

import { ImageOff } from "lucide-react";
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

  if (!activeUrl) {
    return (
      <section className="flex aspect-[16/7] min-h-56 items-center justify-center rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)]">
        <div className="text-center text-[var(--ink-subtle)]">
          <ImageOff aria-hidden="true" className="mx-auto size-7" />
          <p className="mt-3 text-sm font-medium">Nessuna foto acquisita</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_112px]"
      aria-label={`Foto di ${title}`}
    >
      <a
        href={activeUrl}
        target="_blank"
        rel="noreferrer"
        className="relative block aspect-[16/9] min-h-64 overflow-hidden rounded-lg border border-[var(--line-soft)] bg-[var(--surface-muted)]"
      >
        <img
          src={activeUrl}
          alt={title}
          className="size-full object-contain"
          referrerPolicy="no-referrer"
          onError={() => markFailed(activeUrl)}
        />
      </a>

      {availableUrls.length > 1 ? (
        <div className="grid grid-cols-4 gap-2 lg:max-h-[min(34rem,56vw)] lg:grid-cols-1 lg:overflow-y-auto lg:pr-1">
          {availableUrls.map((url, index) => (
            <button
              key={url}
              type="button"
              onClick={() => setSelectedUrl(url)}
              className={
                url === activeUrl
                  ? "aspect-[4/3] overflow-hidden rounded-md border-2 border-[var(--surface-accent)] bg-[var(--surface-muted)]"
                  : "aspect-[4/3] overflow-hidden rounded-md border border-[var(--line-soft)] bg-[var(--surface-muted)]"
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
