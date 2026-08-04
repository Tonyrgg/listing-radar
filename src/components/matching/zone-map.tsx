"use client";

import dynamic from "next/dynamic";
import { MapPinned } from "lucide-react";

import type { ZoneMapCanvasProps } from "./zone-map-canvas";
import styles from "./zone-map.module.css";

const DynamicZoneMap = dynamic<ZoneMapCanvasProps>(
  () => import("./zone-map-canvas").then((module) => module.ZoneMapCanvas),
  {
    ssr: false,
    loading: () => <div className={styles.loading}><MapPinned aria-hidden="true" className="size-5" /> Carico la mappa…</div>,
  },
);

export function ZoneMap(props: Readonly<ZoneMapCanvasProps>) {
  return <DynamicZoneMap {...props} />;
}
