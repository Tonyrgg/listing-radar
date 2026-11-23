"use client";

import Image from "next/image";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/primitives";
import { SOURCE_SCAN_ACTIVE, type SourceScanTarget } from "@/lib/property-lifecycle/jobs/source-scan-targets";

type Scan = { id?: string; status: string; quality?: string; signalled?: boolean; details?: string[]; discovered?: number };

function scanLabel(scan: Scan | undefined) {
  switch (scan?.status) {
    case "SENDING": return "Accodamento…";
    case "QUEUED": return scan.signalled ? "In coda al runner" : "In coda al prossimo giro";
    case "RUNNING": return "Lettura in corso";
    case "RETRY": return "In attesa di riprovare";
    case "SUCCEEDED": return scan.quality === "PARTIAL" ? "Lettura parziale" :
      scan.quality === "SAMPLE" && scan.discovered != null ? `${scan.discovered} URL raccolti` : "Lettura completata";
    case "FAILED": case "DEAD_LETTER": case "CANCELLED": return "Lettura non completata";
    case "UNAVAILABLE": return "Stato non disponibile";
    case "ERROR": return "Scansione non accodata";
    default: return "Avvia lettura";
  }
}

function isActive(status: string) {
  return SOURCE_SCAN_ACTIVE.some(value => value === status);
}

function ScanButton({ source }: { source: SourceScanTarget }) {
  const [scan, setScan] = useState<Scan>();
  const active = Boolean(scan?.id && isActive(scan.status));
  const id = scan?.id;
  useEffect(() => {
    if (!active || !id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        const response = await fetch(`/api/source-scan?id=${id}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Stato non disponibile");
        const next: Scan = await response.json();
        if (controller.signal.aborted) return;
        failures = 0;
        setScan(previous => ({ ...previous, ...next }));
        if (!isActive(next.status)) return;
      } catch {
        if (controller.signal.aborted) return;
        if (++failures >= 3) {
          setScan(previous => ({ ...previous, status: "UNAVAILABLE" }));
          return;
        }
      }
      timer = setTimeout(poll, 8000);
    }
    timer = setTimeout(poll, 5000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [active, id]);
  async function start() {
    if (scan?.status === "UNAVAILABLE" && scan.id) {
      setScan({ ...scan, status: "QUEUED" });
      return;
    }
    setScan({ status: "SENDING" });
    try {
      const response = await fetch("/api/source-scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: source.kind, key: source.key }),
      });
      if (!response.ok) throw new Error("Scansione non accodata");
      setScan(await response.json());
    } catch { setScan({ status: "ERROR" }); }
  }
  return <li className="lr-source-control">
    <button type="button" className={buttonClass("secondary")} disabled={active || scan?.status === "SENDING"}
      aria-label={scan?.status === "UNAVAILABLE" ? `Controlla ${source.name}` : `Scansiona ${source.name}`}
      onClick={() => void start()}>
      {source.icon ? <Image src={source.icon} alt="" width={22} height={22} unoptimized /> :
        <span className="lr-source-monogram" aria-hidden="true">{source.name.trim().slice(0, 2).toUpperCase()}</span>}
      <span>{source.name}</span>
      <Play size={14} aria-hidden="true" />
    </button>
    <span role="status" className="lr-source-result">{scanLabel(scan)}{scan?.details?.length ? ` · ${scan.details.join(" · ")}` : ""}</span>
  </li>;
}

export function SourceScanControls({ agencies, portals }: { agencies: SourceScanTarget[]; portals: SourceScanTarget[] }) {
  return <section className="lr-source-controls" aria-labelledby="source-controls-heading">
    <h2 id="source-controls-heading">Scansiona una fonte</h2>
    <h3>Agenzie</h3>
    <ul>{agencies.map(source => <ScanButton key={source.key} source={source} />)}</ul>
    <h3>Portali privati</h3>
    <ul>{portals.map(source => <ScanButton key={source.key} source={source} />)}</ul>
  </section>;
}
