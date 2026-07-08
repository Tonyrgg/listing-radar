"use client";

import { useEffect, useMemo } from "react";
import { clsx } from "clsx";
import L, { type LatLngExpression, type PathOptions } from "leaflet";
import "leaflet-draw";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";

import {
  BITONTO_CENTER,
  FALLBACK_AREA_COLOR,
  FALLBACK_STREET_COLOR,
  MAP_STATUS_LABELS,
  PIN_CATEGORY_LABELS,
  PIN_PRIORITY_COLORS,
  PIN_PRIORITY_LABELS,
  PIN_STATUS_LABELS,
} from "@/lib/map/constants";
import type {
  Agent,
  AreaStatus,
  GeoJsonGeometry,
  MapArea,
  MapDrawMode,
  MapSnapPoint,
  MapPin,
  MapStatus,
  MapStreet,
  PinStatus,
  SelectedMapElement,
} from "@/lib/map/types";

export type MapCanvasProps = {
  className?: string;
  agents: Agent[];
  areas: MapArea[];
  streets: MapStreet[];
  pins: MapPin[];
  mode: MapDrawMode;
  snapPoints: MapSnapPoint[];
  snapGeometry: GeoJsonGeometry | null;
  selected: SelectedMapElement;
  onModeConsumed: () => void;
  onCreatePin: (latitude: number, longitude: number) => void;
  onAddSnapPoint: (latitude: number, longitude: number) => void;
  onCreateArea: (geometry: GeoJsonGeometry) => void;
  onCreateStreet: (geometry: GeoJsonGeometry) => void;
  onSelect: (selected: SelectedMapElement) => void;
  onEdit: (selected: Exclude<SelectedMapElement, null>) => void;
  onDelete: (selected: Exclude<SelectedMapElement, null>) => void;
  onSetAreaStatus: (id: string, status: AreaStatus) => void;
  onSetStreetStatus: (id: string, status: MapStatus) => void;
  onSetPinStatus: (id: string, status: PinStatus) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasToGeoJson(layer: L.Layer): layer is L.Layer & { toGeoJSON: () => unknown } {
  return typeof (layer as { toGeoJSON?: unknown }).toGeoJSON === "function";
}

function geometryFromLayer(layer: L.Layer) {
  if (!hasToGeoJson(layer)) return null;
  const geoJson = layer.toGeoJSON();
  if (isRecord(geoJson) && isRecord(geoJson.geometry)) {
    return geoJson.geometry as GeoJsonGeometry;
  }
  if (isRecord(geoJson) && typeof geoJson.type === "string" && "coordinates" in geoJson) {
    return geoJson as GeoJsonGeometry;
  }
  return null;
}

function isLngLat(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function polygonPositions(geometry: GeoJsonGeometry): LatLngExpression[] | null {
  if (geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates)) {
    return null;
  }

  const ring = geometry.coordinates[0];
  if (!Array.isArray(ring)) {
    return null;
  }

  const positions = ring
    .filter(isLngLat)
    .map(([longitude, latitude]) => [latitude, longitude] as LatLngExpression);

  return positions.length >= 3 ? positions : null;
}

function linePositions(geometry: GeoJsonGeometry | null): LatLngExpression[] | null {
  if (!geometry || geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    return null;
  }

  const positions = geometry.coordinates
    .filter(isLngLat)
    .map(([longitude, latitude]) => [latitude, longitude] as LatLngExpression);

  return positions.length >= 2 ? positions : null;
}

function agentColor(agents: Agent[], agentId: string | null, fallback: string) {
  if (!agentId) return fallback;
  return agents.find((agent) => agent.id === agentId)?.color ?? fallback;
}

function pathOptions({
  color,
  status,
  selected,
  fill,
}: {
  color: string;
  status: MapStatus;
  selected: boolean;
  fill?: boolean;
}): PathOptions {
  const isDim = status === "not_started" || status === "not_useful";
  return {
    color: status === "not_useful" ? "#64748b" : color,
    weight: selected ? 5 : status === "completed" ? 4 : 3,
    opacity: selected ? 1 : isDim ? 0.48 : 0.88,
    fill,
    fillColor: color,
    fillOpacity: fill ? (selected ? 0.28 : status === "not_started" ? 0.09 : 0.16) : undefined,
    dashArray:
      status === "not_started"
        ? "8 8"
        : status === "to_recheck"
          ? "3 7"
          : undefined,
  };
}

function ResizeController() {
  const map = useMap();

  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 120);
    return () => window.clearTimeout(timer);
  }, [map]);

  return null;
}

function ClickController({
  mode,
  onCreatePin,
  onAddSnapPoint,
}: Readonly<{
  mode: MapDrawMode;
  onCreatePin: (latitude: number, longitude: number) => void;
  onAddSnapPoint: (latitude: number, longitude: number) => void;
}>) {
  useMapEvents({
    click(event) {
      if (mode === "pin") {
        onCreatePin(event.latlng.lat, event.latlng.lng);
        return;
      }

      if (mode === "street_snap") {
        onAddSnapPoint(event.latlng.lat, event.latlng.lng);
      }
    },
  });

  return null;
}

function DrawController({
  mode,
  onCreateArea,
  onCreateStreet,
  onModeConsumed,
}: Readonly<{
  mode: MapDrawMode;
  onCreateArea: (geometry: GeoJsonGeometry) => void;
  onCreateStreet: (geometry: GeoJsonGeometry) => void;
  onModeConsumed: () => void;
}>) {
  const map = useMap();

  useEffect(() => {
    if (mode !== "area" && mode !== "street") {
      return;
    }

    const drawMap = map as L.DrawMap;
    const drawer =
      mode === "area"
        ? new L.Draw.Polygon(drawMap, {
            allowIntersection: false,
            showArea: true,
            shapeOptions: {
              color: FALLBACK_AREA_COLOR,
              weight: 3,
            },
          })
        : new L.Draw.Polyline(drawMap, {
            shapeOptions: {
              color: FALLBACK_STREET_COLOR,
              weight: 4,
            },
          });

    const handleCreated = (event: L.LeafletEvent) => {
      const layer = (event as L.LeafletEvent & { layer?: L.Layer }).layer;
      if (!layer) return;
      const geometry = geometryFromLayer(layer);
      if (!geometry) return;

      if (mode === "area") {
        onCreateArea(geometry);
      } else {
        onCreateStreet(geometry);
      }

      onModeConsumed();
    };

    const handleDrawStop = () => {
      onModeConsumed();
    };

    map.on(L.Draw.Event.CREATED, handleCreated);
    map.on(L.Draw.Event.DRAWSTOP, handleDrawStop);
    drawer.enable();

    return () => {
      drawer.disable();
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.off(L.Draw.Event.DRAWSTOP, handleDrawStop);
    };
  }, [map, mode, onCreateArea, onCreateStreet, onModeConsumed]);

  return null;
}

export function MapCanvas({
  className,
  agents,
  areas,
  streets,
  pins,
  mode,
  snapPoints,
  snapGeometry,
  selected,
  onModeConsumed,
  onCreatePin,
  onAddSnapPoint,
  onCreateArea,
  onCreateStreet,
  onSelect,
  onEdit,
  onDelete,
  onSetAreaStatus,
  onSetStreetStatus,
  onSetPinStatus,
}: Readonly<MapCanvasProps>) {
  const areaShapes = useMemo(
    () =>
      areas
        .map((area) => ({ area, positions: polygonPositions(area.geometry) }))
        .filter(
          (item): item is { area: MapArea; positions: LatLngExpression[] } =>
            Boolean(item.positions),
        ),
    [areas],
  );
  const streetShapes = useMemo(
    () =>
      streets
        .map((street) => ({ street, positions: linePositions(street.geometry) }))
        .filter(
          (item): item is { street: MapStreet; positions: LatLngExpression[] } =>
            Boolean(item.positions),
        ),
    [streets],
  );
  const snapPositions = useMemo(() => linePositions(snapGeometry), [snapGeometry]);

  return (
    <MapContainer
      center={[BITONTO_CENTER.latitude, BITONTO_CENTER.longitude]}
      zoom={BITONTO_CENTER.zoom}
      scrollWheelZoom
      className={clsx(
        "h-full min-h-[620px] w-full overflow-hidden rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)]",
        className,
      )}
    >
      <ResizeController />
      <ClickController
        mode={mode}
        onCreatePin={onCreatePin}
        onAddSnapPoint={onAddSnapPoint}
      />
      <DrawController
        mode={mode}
        onCreateArea={onCreateArea}
        onCreateStreet={onCreateStreet}
        onModeConsumed={onModeConsumed}
      />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {areaShapes.map(({ area, positions }) => {
        const color = area.color ?? agentColor(agents, area.agentId, FALLBACK_AREA_COLOR);
        const isSelected = selected?.type === "area" && selected.id === area.id;
        return (
          <Polygon
            key={area.id}
            positions={positions}
            pathOptions={pathOptions({
              color,
              status: area.status,
              selected: isSelected,
              fill: true,
            })}
            eventHandlers={{
              click: () => onSelect({ type: "area", id: area.id }),
            }}
          >
            <Tooltip sticky>{area.name}</Tooltip>
            <Popup>
              <div className="grid min-w-52 gap-2 text-sm">
                <strong>{area.name}</strong>
                <span>{MAP_STATUS_LABELS[area.status]}</span>
                <div className="flex flex-wrap gap-1">
                  <button type="button" onClick={() => onEdit({ type: "area", id: area.id })}>
                    Modifica
                  </button>
                  <button type="button" onClick={() => onSetAreaStatus(area.id, "completed")}>
                    Completata
                  </button>
                  <button type="button" onClick={() => onSetAreaStatus(area.id, "to_recheck")}>
                    Da ripassare
                  </button>
                  <button type="button" onClick={() => onDelete({ type: "area", id: area.id })}>
                    Elimina
                  </button>
                </div>
              </div>
            </Popup>
          </Polygon>
        );
      })}

      {streetShapes.map(({ street, positions }) => {
        const color = agentColor(agents, street.agentId, FALLBACK_STREET_COLOR);
        const isSelected = selected?.type === "street" && selected.id === street.id;
        return (
          <Polyline
            key={street.id}
            positions={positions}
            pathOptions={pathOptions({
              color,
              status: street.status,
              selected: isSelected,
            })}
            eventHandlers={{
              click: () => onSelect({ type: "street", id: street.id }),
            }}
          >
            <Tooltip sticky>{street.name}</Tooltip>
            <Popup>
              <div className="grid min-w-52 gap-2 text-sm">
                <strong>{street.name}</strong>
                <span>{MAP_STATUS_LABELS[street.status]}</span>
                <div className="flex flex-wrap gap-1">
                  <button type="button" onClick={() => onEdit({ type: "street", id: street.id })}>
                    Modifica
                  </button>
                  <button type="button" onClick={() => onSetStreetStatus(street.id, "completed")}>
                    Completata
                  </button>
                  <button type="button" onClick={() => onSetStreetStatus(street.id, "to_recheck")}>
                    Da ripassare
                  </button>
                  <button type="button" onClick={() => onDelete({ type: "street", id: street.id })}>
                    Elimina
                  </button>
                </div>
              </div>
            </Popup>
          </Polyline>
        );
      })}

      {snapPositions ? (
        <Polyline
          positions={snapPositions}
          pathOptions={{
            color: "#22c55e",
            weight: 6,
            opacity: 0.92,
            dashArray: "10 8",
          }}
        >
          <Tooltip sticky>Anteprima strada agganciata</Tooltip>
        </Polyline>
      ) : snapPoints.length > 1 ? (
        <Polyline
          positions={snapPoints.map(
            (point) => [point.latitude, point.longitude] as LatLngExpression,
          )}
          pathOptions={{
            color: "#f59e0b",
            weight: 4,
            opacity: 0.75,
            dashArray: "4 7",
          }}
        />
      ) : null}

      {snapPoints.map((point, index) => (
        <CircleMarker
          key={`${point.latitude}-${point.longitude}-${index}`}
          center={[point.latitude, point.longitude]}
          radius={index === 0 ? 6 : 5}
          pathOptions={{
            color: "#111827",
            fillColor: index === 0 ? "#22c55e" : "#f59e0b",
            fillOpacity: 0.95,
            weight: 2,
          }}
        >
          <Tooltip
            permanent
            direction="top"
            offset={[0, -8]}
            className="map-snap-point-label"
          >
            {index + 1}
          </Tooltip>
        </CircleMarker>
      ))}

      {pins.map((pin) => {
        const isSelected = selected?.type === "pin" && selected.id === pin.id;
        const color = PIN_PRIORITY_COLORS[pin.priority];
        const radius = pin.priority === "urgent" ? 11 : pin.priority === "high" ? 9 : 7;
        return (
          <CircleMarker
            key={pin.id}
            center={[pin.latitude, pin.longitude]}
            radius={isSelected ? radius + 3 : radius}
            pathOptions={{
              color: "#111827",
              fillColor: color,
              fillOpacity: pin.priority === "low" ? 0.66 : 0.9,
              weight: isSelected ? 4 : 2,
            }}
            eventHandlers={{
              click: () => onSelect({ type: "pin", id: pin.id }),
            }}
          >
            <Tooltip sticky>{pin.title}</Tooltip>
            <Popup>
              <div className="grid min-w-56 gap-2 text-sm">
                <strong>{pin.title}</strong>
                <span>
                  {PIN_CATEGORY_LABELS[pin.category]} - {PIN_PRIORITY_LABELS[pin.priority]} - {PIN_STATUS_LABELS[pin.status]}
                </span>
                {pin.notes ? <span>{pin.notes}</span> : null}
                <div className="flex flex-wrap gap-1">
                  <button type="button" onClick={() => onEdit({ type: "pin", id: pin.id })}>
                    Modifica
                  </button>
                  <button type="button" onClick={() => onSetPinStatus(pin.id, "hot")}>
                    Caldo
                  </button>
                  <button type="button" onClick={() => onSetPinStatus(pin.id, "follow_up")}>
                    Richiamo
                  </button>
                  <button type="button" onClick={() => onSetPinStatus(pin.id, "closed")}>
                    Chiuso
                  </button>
                  <button type="button" onClick={() => onSetPinStatus(pin.id, "discarded")}>
                    Scartato
                  </button>
                  <button type="button" onClick={() => onDelete({ type: "pin", id: pin.id })}>
                    Elimina
                  </button>
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
