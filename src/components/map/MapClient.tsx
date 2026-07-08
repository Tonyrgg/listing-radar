"use client";

import dynamic from "next/dynamic";
import { clsx } from "clsx";
import {
  Filter,
  Loader2,
  MapPin,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCcw,
  Route,
  Shapes,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MapFilters } from "@/components/map/MapFilters";
import { MapLegend } from "@/components/map/MapLegend";
import { MapModals, type MapModalState } from "@/components/map/MapModals";
import { MapSidebar } from "@/components/map/MapSidebar";
import {
  DEFAULT_MAP_FILTERS,
} from "@/lib/map/constants";
import {
  createMapActivityLog,
  createMapArea,
  createMapPin,
  createMapStreet,
  deleteMapArea,
  deleteMapPin,
  deleteMapStreet,
  listAgents,
  listMapActivityLogs,
  listMapAreas,
  listMapPins,
  listMapStreets,
  updateMapArea,
  updateMapPin,
  updateMapStreet,
} from "@/lib/map/queries";
import type {
  Agent,
  AreaStatus,
  CreateMapActivityLogInput,
  CreateMapAreaInput,
  CreateMapPinInput,
  CreateMapStreetInput,
  GeoJsonGeometry,
  MapActivityLog,
  MapArea,
  MapDrawMode,
  MapFiltersState,
  MapPin as MapPinType,
  MapSnapPoint,
  MapStats,
  MapStatus,
  MapStreet,
  PinStatus,
  SelectedMapElement,
  UpdateMapAreaInput,
  UpdateMapPinInput,
  UpdateMapStreetInput,
} from "@/lib/map/types";
import type { MapCanvasProps } from "@/components/map/MapCanvas";

const MapCanvas = dynamic<MapCanvasProps>(
  () => import("@/components/map/MapCanvas").then((module) => module.MapCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[620px] items-center justify-center rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)]">
        <div className="flex items-center gap-3 text-sm font-semibold text-[var(--ink-soft)]">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Carico mappa
        </div>
      </div>
    ),
  },
);

function isOverdue(value: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time < Date.now();
}

function isUpcoming(value: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  const now = Date.now();
  const sevenDays = 1000 * 60 * 60 * 24 * 7;
  return Number.isFinite(time) && time >= now && time <= now + sevenDays;
}

function matchesAgent(filters: MapFiltersState, agentId: string | null) {
  return filters.agentId === "all" || agentId === filters.agentId;
}

function filterAreas(areas: MapArea[], filters: MapFiltersState) {
  if (!filters.showAreas) return [];
  return areas.filter((area) => {
    if (!matchesAgent(filters, area.agentId)) return false;
    if (filters.areaStatus !== "all" && area.status !== filters.areaStatus) return false;
    return true;
  });
}

function filterStreets(streets: MapStreet[], filters: MapFiltersState) {
  if (!filters.showStreets) return [];
  return streets.filter((street) => {
    if (!matchesAgent(filters, street.agentId)) return false;
    if (filters.streetStatus !== "all" && street.status !== filters.streetStatus) return false;
    return true;
  });
}

function filterPins(pins: MapPinType[], filters: MapFiltersState) {
  if (!filters.showPins) return [];
  return pins.filter((pin) => {
    if (!matchesAgent(filters, pin.agentId)) return false;
    if (filters.pinCategory !== "all" && pin.category !== filters.pinCategory) return false;
    if (filters.pinStatus !== "all" && pin.status !== filters.pinStatus) return false;
    if (filters.pinPriority !== "all" && pin.priority !== filters.pinPriority) return false;
    if (filters.followUp === "overdue" && !isOverdue(pin.followUpAt)) return false;
    if (filters.followUp === "next7" && !isUpcoming(pin.followUpAt)) return false;
    return true;
  });
}

function getStats(areas: MapArea[], streets: MapStreet[], pins: MapPinType[]): MapStats {
  return {
    totalAreas: areas.length,
    completedAreas: areas.filter((area) => area.status === "completed").length,
    totalStreets: streets.length,
    completedStreets: streets.filter((street) => street.status === "completed").length,
    totalPins: pins.length,
    hotPins: pins.filter((pin) => pin.status === "hot").length,
    followUpPins: pins.filter((pin) => pin.status === "follow_up").length,
    overdueFollowUps: pins.filter((pin) => isOverdue(pin.followUpAt)).length,
    upcomingFollowUps: pins.filter((pin) => isUpcoming(pin.followUpAt)).length,
  };
}

function modeButtonClass(active: boolean) {
  return clsx(
    "inline-flex h-10 items-center justify-center gap-2 rounded-[7px] border px-3 text-sm font-semibold transition-colors",
    active
      ? "border-[var(--surface-accent)] bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]"
      : "border-[var(--line-soft)] bg-[var(--surface-panel)] text-[var(--ink-strong)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-muted)]",
  );
}

function drawModeHint(mode: MapDrawMode) {
  switch (mode) {
    case "pin":
      return "Clicca sulla mappa per creare un pin.";
    case "area":
      return "Disegna il perimetro dell'area, poi chiudi il poligono.";
    case "street":
      return "Disegna la strada con una linea, doppio click per finire.";
    case "street_snap":
      return "Clicca i punti della strada: ogni punto e un vincolo della linea.";
    default:
      return "Seleziona elementi gia presenti oppure scegli uno strumento.";
  }
}

function activeFilterCount(filters: MapFiltersState) {
  let count = 0;
  if (filters.agentId !== DEFAULT_MAP_FILTERS.agentId) count += 1;
  if (filters.areaStatus !== DEFAULT_MAP_FILTERS.areaStatus) count += 1;
  if (filters.streetStatus !== DEFAULT_MAP_FILTERS.streetStatus) count += 1;
  if (filters.pinCategory !== DEFAULT_MAP_FILTERS.pinCategory) count += 1;
  if (filters.pinStatus !== DEFAULT_MAP_FILTERS.pinStatus) count += 1;
  if (filters.pinPriority !== DEFAULT_MAP_FILTERS.pinPriority) count += 1;
  if (filters.followUp !== DEFAULT_MAP_FILTERS.followUp) count += 1;
  if (!filters.showAreas) count += 1;
  if (!filters.showStreets) count += 1;
  if (!filters.showPins) count += 1;
  return count;
}

async function fetchMapData() {
  const [agents, areas, streets, pins, activityLogs] = await Promise.all([
    listAgents(),
    listMapAreas(),
    listMapStreets(),
    listMapPins(),
    listMapActivityLogs(20),
  ]);

  return { agents, areas, streets, pins, activityLogs };
}

type SnapRoute = {
  geometry: GeoJsonGeometry;
  distance: number | null;
  duration: number | null;
};

type SnapRouteResponse =
  | {
      ok: true;
      geometry: GeoJsonGeometry;
      distance: number | null;
      duration: number | null;
    }
  | {
      ok: false;
      error: string;
    };

function formatMeters(value: number | null) {
  if (value == null) return "";
  if (value >= 1000) return `${(value / 1000).toFixed(1)} km`;
  return `${Math.round(value)} m`;
}

async function requestSnapRoute(points: MapSnapPoint[]): Promise<SnapRoute> {
  const response = await fetch("/api/map/route-snap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ points }),
  });
  const data = (await response.json()) as SnapRouteResponse;

  if (!response.ok || !data.ok) {
    throw new Error(data.ok ? "Routing non riuscito." : data.error);
  }

  return {
    geometry: data.geometry,
    distance: data.distance,
    duration: data.duration,
  };
}

export function MapClient() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [areas, setAreas] = useState<MapArea[]>([]);
  const [streets, setStreets] = useState<MapStreet[]>([]);
  const [pins, setPins] = useState<MapPinType[]>([]);
  const [activityLogs, setActivityLogs] = useState<MapActivityLog[]>([]);
  const [filters, setFilters] = useState<MapFiltersState>(DEFAULT_MAP_FILTERS);
  const [drawMode, setDrawMode] = useState<MapDrawMode>("select");
  const [selected, setSelected] = useState<SelectedMapElement>(null);
  const [modal, setModal] = useState<MapModalState>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const [snapPoints, setSnapPoints] = useState<MapSnapPoint[]>([]);
  const [snapRoute, setSnapRoute] = useState<SnapRoute | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);
  const snapRequestIdRef = useRef(0);

  const applyLoadedData = useCallback(
    (data: Awaited<ReturnType<typeof fetchMapData>>) => {
      setAgents(data.agents);
      setAreas(data.areas);
      setStreets(data.streets);
      setPins(data.pins);
      setActivityLogs(data.activityLogs);
    },
    [],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applyLoadedData(await fetchMapData());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Caricamento mappa non riuscito.");
    } finally {
      setLoading(false);
    }
  }, [applyLoadedData]);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialData() {
      try {
        const data = await fetchMapData();
        if (!isMounted) return;
        applyLoadedData(data);
      } catch (loadError) {
        if (!isMounted) return;
        setError(loadError instanceof Error ? loadError.message : "Caricamento mappa non riuscito.");
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void loadInitialData();

    return () => {
      isMounted = false;
    };
  }, [applyLoadedData]);

  const writeLog = useCallback(async (input: CreateMapActivityLogInput) => {
    try {
      await createMapActivityLog(input);
      setActivityLogs(await listMapActivityLogs(20));
    } catch {
      // The primary edit should not be rolled back if historical logging fails.
    }
  }, []);

  const visibleAreas = useMemo(() => filterAreas(areas, filters), [areas, filters]);
  const visibleStreets = useMemo(() => filterStreets(streets, filters), [streets, filters]);
  const visiblePins = useMemo(() => filterPins(pins, filters), [pins, filters]);
  const mapAreas = drawMode === "street_snap" ? [] : visibleAreas;
  const stats = useMemo(
    () => getStats(visibleAreas, visibleStreets, visiblePins),
    [visibleAreas, visibleStreets, visiblePins],
  );
  const filterCount = activeFilterCount(filters);
  const hasAnyVisibleElement =
    visibleAreas.length + visibleStreets.length + visiblePins.length > 0;

  const handleSelect = useCallback((nextSelected: SelectedMapElement) => {
    setSelected(nextSelected);
    if (nextSelected) {
      setSidePanelOpen(true);
    }
  }, []);

  const openEditModal = useCallback(
    (nextSelected: Exclude<SelectedMapElement, null>) => {
      if (nextSelected.type === "pin") {
        const pin = pins.find((item) => item.id === nextSelected.id);
        if (pin) setModal({ type: "pin", mode: "edit", pin });
      }
      if (nextSelected.type === "area") {
        const area = areas.find((item) => item.id === nextSelected.id);
        if (area) setModal({ type: "area", mode: "edit", area });
      }
      if (nextSelected.type === "street") {
        const street = streets.find((item) => item.id === nextSelected.id);
        if (street) setModal({ type: "street", mode: "edit", street });
      }
    },
    [areas, pins, streets],
  );

  const handleCreatePin = useCallback((latitude: number, longitude: number) => {
    setDrawMode("select");
    setSidePanelOpen(true);
    setModal({ type: "pin", mode: "create", latitude, longitude });
  }, []);

  const handleCreateArea = useCallback((geometry: GeoJsonGeometry) => {
    setSidePanelOpen(true);
    setModal({ type: "area", mode: "create", geometry });
  }, []);

  const handleCreateStreet = useCallback((geometry: GeoJsonGeometry) => {
    setSidePanelOpen(true);
    setModal({ type: "street", mode: "create", geometry });
  }, []);

  const routeSnapPoints = useCallback(async (nextPoints: MapSnapPoint[]) => {
    const requestId = snapRequestIdRef.current + 1;
    snapRequestIdRef.current = requestId;
    setSnapError(null);
    setSnapRoute(null);

    if (nextPoints.length < 2) {
      setSnapLoading(false);
      return;
    }

    setSnapLoading(true);
    try {
      const nextRoute = await requestSnapRoute(nextPoints);
      if (snapRequestIdRef.current === requestId) {
        setSnapRoute(nextRoute);
      }
    } catch (routeError) {
      if (snapRequestIdRef.current === requestId) {
        setSnapError(
          routeError instanceof Error
            ? routeError.message
            : "Aggancio strada non riuscito.",
        );
      }
    } finally {
      if (snapRequestIdRef.current === requestId) {
        setSnapLoading(false);
      }
    }
  }, []);

  const handleAddSnapPoint = useCallback(
    (latitude: number, longitude: number) => {
      const nextPoints = [...snapPoints, { latitude, longitude }];
      setSnapPoints(nextPoints);
      void routeSnapPoints(nextPoints);
    },
    [routeSnapPoints, snapPoints],
  );

  const clearSnapDraft = useCallback(() => {
    snapRequestIdRef.current += 1;
    setSnapPoints([]);
    setSnapRoute(null);
    setSnapError(null);
    setSnapLoading(false);
  }, []);

  const removeLastSnapPoint = useCallback(() => {
    const nextPoints = snapPoints.slice(0, -1);
    setSnapPoints(nextPoints);
    void routeSnapPoints(nextPoints);
  }, [routeSnapPoints, snapPoints]);

  const openSnapStreetModal = useCallback(() => {
    if (!snapRoute) return;
    setSidePanelOpen(true);
    setModal({ type: "street", mode: "create", geometry: snapRoute.geometry });
  }, [snapRoute]);

  const activateDrawMode = useCallback(
    (mode: MapDrawMode) => {
      clearSnapDraft();
      setDrawMode(mode);
    },
    [clearSnapDraft],
  );

  const handleSavePin = useCallback(
    async (id: string | null, input: CreateMapPinInput | UpdateMapPinInput) => {
      setError(null);
      if (id) {
        const updated = await updateMapPin(id, input as UpdateMapPinInput);
        setPins((current) => current.map((pin) => (pin.id === updated.id ? updated : pin)));
        setSelected({ type: "pin", id: updated.id });
        setModal(null);
        await writeLog({
          agentId: updated.agentId,
          areaId: updated.areaId,
          streetId: updated.streetId,
          pinId: updated.id,
          actionType: "pin_updated",
          notes: updated.title,
        });
        return;
      }

      const created = await createMapPin(input as CreateMapPinInput);
      setPins((current) => [created, ...current]);
      setSelected({ type: "pin", id: created.id });
      setModal(null);
      await writeLog({
        agentId: created.agentId,
        areaId: created.areaId,
        streetId: created.streetId,
        pinId: created.id,
        actionType: "pin_created",
        notes: created.title,
      });
    },
    [writeLog],
  );

  const handleSaveArea = useCallback(
    async (id: string | null, input: CreateMapAreaInput | UpdateMapAreaInput) => {
      setError(null);
      if (id) {
        const updated = await updateMapArea(id, input as UpdateMapAreaInput);
        setAreas((current) => current.map((area) => (area.id === updated.id ? updated : area)));
        setSelected({ type: "area", id: updated.id });
        setModal(null);
        await writeLog({
          agentId: updated.agentId,
          areaId: updated.id,
          actionType: updated.status === "completed" ? "area_completed" : "area_updated",
          notes: updated.name,
        });
        return;
      }

      const created = await createMapArea(input as CreateMapAreaInput);
      setAreas((current) => [created, ...current]);
      setSelected({ type: "area", id: created.id });
      setModal(null);
      await writeLog({
        agentId: created.agentId,
        areaId: created.id,
        actionType: "area_created",
        notes: created.name,
      });
    },
    [writeLog],
  );

  const handleSaveStreet = useCallback(
    async (id: string | null, input: CreateMapStreetInput | UpdateMapStreetInput) => {
      setError(null);
      if (id) {
        const updated = await updateMapStreet(id, input as UpdateMapStreetInput);
        setStreets((current) =>
          current.map((street) => (street.id === updated.id ? updated : street)),
        );
        setSelected({ type: "street", id: updated.id });
        setModal(null);
        await writeLog({
          agentId: updated.agentId,
          areaId: updated.areaId,
          streetId: updated.id,
          actionType:
            updated.status === "completed"
              ? "street_completed"
              : updated.status === "to_recheck"
                ? "street_recheck"
                : "street_updated",
          notes: updated.name,
        });
        return;
      }

      const created = await createMapStreet(input as CreateMapStreetInput);
      setStreets((current) => [created, ...current]);
      setSelected({ type: "street", id: created.id });
      setModal(null);
      clearSnapDraft();
      await writeLog({
        agentId: created.agentId,
        areaId: created.areaId,
        streetId: created.id,
        actionType: "street_created",
        notes: created.name,
      });
    },
    [clearSnapDraft, writeLog],
  );

  const handleSetAreaStatus = useCallback(
    async (id: string, status: AreaStatus) => {
      const updated = await updateMapArea(id, { status });
      setAreas((current) => current.map((area) => (area.id === id ? updated : area)));
      setSelected({ type: "area", id });
      await writeLog({
        agentId: updated.agentId,
        areaId: updated.id,
        actionType: status === "completed" ? "area_completed" : "area_updated",
        notes: updated.name,
      });
    },
    [writeLog],
  );

  const handleSetStreetStatus = useCallback(
    async (id: string, status: MapStatus) => {
      const updated = await updateMapStreet(id, {
        status,
        lastCompletedAt: status === "completed" ? new Date().toISOString() : undefined,
      });
      setStreets((current) =>
        current.map((street) => (street.id === id ? updated : street)),
      );
      setSelected({ type: "street", id });
      await writeLog({
        agentId: updated.agentId,
        areaId: updated.areaId,
        streetId: updated.id,
        actionType:
          status === "completed"
            ? "street_completed"
            : status === "to_recheck"
              ? "street_recheck"
              : "street_updated",
        notes: updated.name,
      });
    },
    [writeLog],
  );

  const handleSetPinStatus = useCallback(
    async (id: string, status: PinStatus) => {
      const updated = await updateMapPin(id, { status });
      setPins((current) => current.map((pin) => (pin.id === id ? updated : pin)));
      setSelected({ type: "pin", id });
      await writeLog({
        agentId: updated.agentId,
        areaId: updated.areaId,
        streetId: updated.streetId,
        pinId: updated.id,
        actionType:
          status === "follow_up" ? "pin_follow_up_set" : "pin_status_changed",
        notes: updated.title,
      });
    },
    [writeLog],
  );

  const handleDelete = useCallback(
    async (nextSelected: Exclude<SelectedMapElement, null>) => {
      const ok = window.confirm("Eliminare questo elemento dalla mappa?");
      if (!ok) return;

      if (nextSelected.type === "pin") {
        const pin = pins.find((item) => item.id === nextSelected.id);
        if (pin) {
          await writeLog({
            agentId: pin.agentId,
            areaId: pin.areaId,
            streetId: pin.streetId,
            pinId: pin.id,
            actionType: "pin_deleted",
            notes: pin.title,
          });
        }
        await deleteMapPin(nextSelected.id);
        setPins((current) => current.filter((item) => item.id !== nextSelected.id));
      }

      if (nextSelected.type === "area") {
        const area = areas.find((item) => item.id === nextSelected.id);
        if (area) {
          await writeLog({
            agentId: area.agentId,
            areaId: area.id,
            actionType: "area_deleted",
            notes: area.name,
          });
        }
        await deleteMapArea(nextSelected.id);
        setAreas((current) => current.filter((item) => item.id !== nextSelected.id));
      }

      if (nextSelected.type === "street") {
        const street = streets.find((item) => item.id === nextSelected.id);
        if (street) {
          await writeLog({
            agentId: street.agentId,
            areaId: street.areaId,
            streetId: street.id,
            actionType: "street_deleted",
            notes: street.name,
          });
        }
        await deleteMapStreet(nextSelected.id);
        setStreets((current) => current.filter((item) => item.id !== nextSelected.id));
      }

      setSelected(null);
      setModal(null);
    },
    [areas, pins, streets, writeLog],
  );

  return (
    <div
      className={clsx(
        "grid h-[calc(100vh-40px)] min-h-[720px] gap-3",
        sidePanelOpen ? "xl:grid-cols-[minmax(0,1fr)_380px]" : "xl:grid-cols-1",
      )}
    >
      <section className="relative min-h-[620px] min-w-0 overflow-hidden rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)]">
        <MapCanvas
          className="min-h-full rounded-none border-0"
          agents={agents}
          areas={mapAreas}
          streets={visibleStreets}
          pins={visiblePins}
          mode={drawMode}
          snapPoints={snapPoints}
          snapGeometry={snapRoute?.geometry ?? null}
          selected={selected}
          onModeConsumed={() => setDrawMode("select")}
          onCreatePin={handleCreatePin}
          onAddSnapPoint={handleAddSnapPoint}
          onCreateArea={handleCreateArea}
          onCreateStreet={handleCreateStreet}
          onSelect={handleSelect}
          onEdit={openEditModal}
          onDelete={handleDelete}
          onSetAreaStatus={handleSetAreaStatus}
          onSetStreetStatus={handleSetStreetStatus}
          onSetPinStatus={handleSetPinStatus}
        />

        <div className="absolute left-3 right-3 top-3 z-[850] flex flex-col gap-2 2xl:flex-row 2xl:items-start 2xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-[10px] border border-[var(--line-soft)] bg-[oklch(0.13_0.01_160_/_0.96)] p-2 shadow-[var(--shadow-panel)]">
            <div className="min-w-40 px-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--surface-accent)]">
                Territorio
              </p>
              <h1 className="text-sm font-semibold text-[var(--ink-strong)]">Mappa Zone</h1>
            </div>
            <button
              type="button"
              onClick={() => activateDrawMode("select")}
              className={modeButtonClass(drawMode === "select")}
            >
              <MousePointer2 className="size-4" aria-hidden="true" />
              Seleziona
            </button>
            <button
              type="button"
              onClick={() => activateDrawMode("pin")}
              className={modeButtonClass(drawMode === "pin")}
            >
              <MapPin className="size-4" aria-hidden="true" />
              Pin
            </button>
            <button
              type="button"
              onClick={() => activateDrawMode("area")}
              className={modeButtonClass(drawMode === "area")}
            >
              <Shapes className="size-4" aria-hidden="true" />
              Area
            </button>
            <button
              type="button"
              onClick={() => activateDrawMode("street")}
              className={modeButtonClass(drawMode === "street")}
            >
              <Route className="size-4" aria-hidden="true" />
              Libera
            </button>
            <button
              type="button"
              onClick={() => activateDrawMode("street_snap")}
              className={modeButtonClass(drawMode === "street_snap")}
            >
              <Route className="size-4" aria-hidden="true" />
              Guidata
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="hidden rounded-[10px] border border-[var(--line-soft)] bg-[oklch(0.13_0.01_160_/_0.96)] p-1.5 shadow-[var(--shadow-panel)] md:flex md:items-center md:gap-1.5">
              <span className="rounded-[7px] bg-[var(--surface-canvas)] px-2.5 py-2 text-xs font-semibold text-[var(--ink-strong)]">
                Aree {stats.completedAreas}/{stats.totalAreas}
              </span>
              <span className="rounded-[7px] bg-[var(--surface-canvas)] px-2.5 py-2 text-xs font-semibold text-[var(--ink-strong)]">
                Strade {stats.completedStreets}/{stats.totalStreets}
              </span>
              <span className="rounded-[7px] bg-[var(--surface-canvas)] px-2.5 py-2 text-xs font-semibold text-[var(--ink-strong)]">
                Pin {stats.totalPins}
              </span>
              {stats.overdueFollowUps ? (
                <span className="rounded-[7px] bg-[oklch(0.29_0.06_55)] px-2.5 py-2 text-xs font-semibold text-[var(--status-warning)]">
                  Scaduti {stats.overdueFollowUps}
                </span>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setFiltersOpen((current) => !current)}
              className={clsx(
                "inline-flex h-10 items-center justify-center gap-2 rounded-[7px] border px-3 text-sm font-semibold shadow-[var(--shadow-panel)] transition-colors",
                filtersOpen || filterCount > 0
                  ? "border-[var(--surface-accent)] bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]"
                  : "border-[var(--line-soft)] bg-[oklch(0.13_0.01_160_/_0.96)] text-[var(--ink-strong)] hover:border-[var(--line-strong)]",
              )}
            >
              <Filter className="size-4" aria-hidden="true" />
              Filtri
              {filterCount ? (
                <span className="rounded-full bg-[var(--surface-accent)] px-1.5 text-[10px] text-[var(--button-ink)]">
                  {filterCount}
                </span>
              ) : null}
            </button>

            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              aria-label="Ricarica dati mappa"
              title="Ricarica"
              className="inline-flex size-10 items-center justify-center rounded-[7px] border border-[var(--line-soft)] bg-[oklch(0.13_0.01_160_/_0.96)] text-[var(--ink-strong)] shadow-[var(--shadow-panel)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-muted)] disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCcw className={clsx("size-4", loading && "animate-spin")} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setSidePanelOpen((current) => !current)}
              aria-label={sidePanelOpen ? "Nascondi pannello" : "Apri pannello"}
              title={sidePanelOpen ? "Nascondi pannello" : "Apri pannello"}
              className="inline-flex size-10 items-center justify-center rounded-[7px] border border-[var(--line-soft)] bg-[oklch(0.13_0.01_160_/_0.96)] text-[var(--ink-strong)] shadow-[var(--shadow-panel)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-muted)]"
            >
              {sidePanelOpen ? (
                <PanelRightClose className="size-4" aria-hidden="true" />
              ) : (
                <PanelRightOpen className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {filtersOpen ? (
          <div className="absolute left-3 top-[148px] z-[840] max-h-[calc(100%-170px)] w-[min(520px,calc(100%-24px))] overflow-y-auto rounded-[10px] border border-[var(--line-soft)] bg-[oklch(0.13_0.01_160_/_0.98)] p-4 shadow-[var(--shadow-panel)] 2xl:top-[76px]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--ink-strong)]">Filtri e legenda</p>
                <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
                  Riduci la mappa agli elementi che stai lavorando adesso.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                aria-label="Chiudi filtri"
                title="Chiudi"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-[6px] border border-[var(--line-strong)] text-[var(--ink-strong)] hover:bg-[var(--surface-muted)]"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <MapFilters agents={agents} filters={filters} onChange={setFilters} />
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--line-soft)] pt-4">
              <button
                type="button"
                onClick={() => setFilters(DEFAULT_MAP_FILTERS)}
                className="inline-flex h-9 items-center rounded-[6px] border border-[var(--line-strong)] px-3 text-xs font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-muted)]"
              >
                Azzera filtri
              </button>
              <p className="text-xs text-[var(--ink-subtle)]">
                {visibleAreas.length + visibleStreets.length + visiblePins.length} visibili
              </p>
            </div>
            <div className="mt-4 border-t border-[var(--line-soft)] pt-4">
              <MapLegend agents={agents} />
            </div>
          </div>
        ) : null}

        <div className="absolute bottom-3 left-3 z-[830] max-w-[min(520px,calc(100%-24px))] rounded-[10px] border border-[var(--line-soft)] bg-[oklch(0.13_0.01_160_/_0.96)] px-3 py-2 shadow-[var(--shadow-panel)]">
          <p className="text-sm font-semibold text-[var(--ink-strong)]">{drawModeHint(drawMode)}</p>
          {drawMode === "street_snap" || snapPoints.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--line-soft)] pt-2">
              <span className="rounded-full bg-[var(--surface-canvas)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-soft)]">
                Punti {snapPoints.length}
              </span>
              <span className="rounded-full bg-[var(--surface-canvas)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-soft)]">
                Aree nascoste
              </span>
              {snapLoading ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-canvas)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-soft)]">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  Aggancio
                </span>
              ) : null}
              {snapRoute ? (
                <span className="rounded-full bg-[var(--surface-accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--surface-accent)]">
                  Pronta {formatMeters(snapRoute.distance)}
                </span>
              ) : null}
              {snapError ? (
                <span className="text-xs font-semibold text-[var(--status-error)]">
                  {snapError}
                </span>
              ) : null}
              <button
                type="button"
                onClick={removeLastSnapPoint}
                disabled={!snapPoints.length}
                className="inline-flex h-8 items-center rounded-[6px] border border-[var(--line-strong)] px-2.5 text-xs font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Indietro
              </button>
              <button
                type="button"
                onClick={() => {
                  clearSnapDraft();
                  setDrawMode("select");
                }}
                disabled={!snapPoints.length && drawMode !== "street_snap"}
                className="inline-flex h-8 items-center rounded-[6px] border border-[var(--line-strong)] px-2.5 text-xs font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={openSnapStreetModal}
                disabled={!snapRoute}
                className="inline-flex h-8 items-center rounded-[6px] bg-[var(--surface-accent)] px-3 text-xs font-semibold text-[var(--button-ink)] hover:bg-[var(--surface-accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Salva strada
              </button>
            </div>
          ) : null}
          {!hasAnyVisibleElement && !loading ? (
            <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
              Parti da Area o Pin. I dati restano interni a Listing Radar.
            </p>
          ) : null}
        </div>

        {error ? (
          <div className="absolute bottom-3 right-3 z-[830] max-w-md rounded-[8px] border border-[oklch(0.48_0.08_28)] bg-[oklch(0.22_0.035_28)] p-3 text-sm font-medium leading-6 text-[var(--status-error)] shadow-[var(--shadow-panel)]">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="pointer-events-none absolute inset-0 z-[820] flex items-center justify-center bg-[oklch(0.08_0.01_160_/_0.18)]">
            <div className="inline-flex items-center gap-2 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-panel)] px-3 py-2 text-xs font-semibold text-[var(--ink-soft)]">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Sincronizzo
            </div>
          </div>
        ) : null}
      </section>

      {sidePanelOpen ? (
        <MapSidebar
          agents={agents}
          areas={visibleAreas}
          streets={visibleStreets}
          pins={visiblePins}
          activityLogs={activityLogs}
          stats={stats}
          selected={selected}
          onSelect={handleSelect}
          onEdit={openEditModal}
          onDelete={handleDelete}
          onSetAreaStatus={handleSetAreaStatus}
          onSetStreetStatus={handleSetStreetStatus}
          onSetPinStatus={handleSetPinStatus}
        />
      ) : null}

      <MapModals
        modal={modal}
        agents={agents}
        areas={areas}
        streets={streets}
        onClose={() => setModal(null)}
        onSavePin={handleSavePin}
        onSaveArea={handleSaveArea}
        onSaveStreet={handleSaveStreet}
      />
    </div>
  );
}
