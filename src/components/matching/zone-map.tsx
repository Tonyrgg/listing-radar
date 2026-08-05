"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { MapPinned, Maximize2, Minimize2 } from "lucide-react";

import type { ZoneMapCanvasProps } from "./zone-map-canvas";
import styles from "./zone-map.module.css";

const DynamicZoneMap = dynamic<ZoneMapCanvasProps>(
  () => import("./zone-map-canvas").then((module) => module.ZoneMapCanvas),
  {
    ssr: false,
    loading: () => <div className={styles.loading}><MapPinned aria-hidden="true" className="size-5" /> Carico la mappa…</div>,
  },
);

type ZoneMapProps = ZoneMapCanvasProps & {
  controls?: ReactNode;
  showFullscreenControl?: boolean;
};

export function ZoneMap({ controls, showFullscreenControl = false, ...props }: Readonly<ZoneMapProps>) {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
    };
  }, [fullscreen]);

  return (
    <div className={`${styles.shell} ${fullscreen ? styles.fullscreen : ""}`}>
      <DynamicZoneMap {...props} compact={fullscreen ? false : props.compact} />
      {controls ? <div className={styles.mapControls}>{controls}</div> : null}
      {showFullscreenControl ? (
        <button
          type="button"
          className={styles.fullscreenButton}
          onClick={() => setFullscreen((current) => !current)}
          aria-label={fullscreen ? "Esci dalla mappa a schermo intero" : "Apri la mappa a schermo intero"}
          title={fullscreen ? "Esci da schermo intero" : "Schermo intero"}
        >
          {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </button>
      ) : null}
    </div>
  );
}
