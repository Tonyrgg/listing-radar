"use client";

import { useEffect, useMemo } from "react";
import L, { type LatLngBoundsExpression, type LatLngExpression } from "leaflet";
import "leaflet-draw";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";

import { BITONTO_CENTER } from "@/lib/map/constants";
import { polygonRing, type MapPoint } from "@/lib/map/geometry";
import type { GeoJsonGeometry } from "@/lib/map/types";
import styles from "./zone-map.module.css";

export type ZoneMapShape = {
  shapeId: string;
  zoneId: string;
  name: string;
  color: string | null;
  geometry: GeoJsonGeometry;
};

export type ZoneMapCanvasProps = {
  shapes: ZoneMapShape[];
  selectedZoneIds?: string[];
  excludedZoneIds?: string[];
  highlightedZoneId?: string | null;
  draftGeometry?: GeoJsonGeometry | null;
  point?: MapPoint | null;
  drawing?: boolean;
  allowPointSelection?: boolean;
  compact?: boolean;
  onGeometryCreated?: (geometry: GeoJsonGeometry) => void;
  onDrawingConsumed?: () => void;
  onZoneToggle?: (zoneId: string) => void;
  onPointChange?: (point: MapPoint) => void;
};

function geometryPositions(geometry?: GeoJsonGeometry | null): LatLngExpression[] | null {
  const ring = polygonRing(geometry);
  return ring?.map(([longitude, latitude]) => [latitude, longitude] as LatLngExpression) ?? null;
}

function geometryFromLayer(layer: L.Layer) {
  const geoJson = (layer as L.Layer & { toGeoJSON?: () => { geometry?: GeoJsonGeometry } }).toGeoJSON?.();
  return geoJson?.geometry ?? null;
}

function ResizeController() {
  const map = useMap();
  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 100);
    return () => window.clearTimeout(timer);
  }, [map]);
  return null;
}

function FitController({ shapes, point, highlightedZoneId }: Readonly<{ shapes: ZoneMapShape[]; point?: MapPoint | null; highlightedZoneId?: string | null }>) {
  const map = useMap();
  useEffect(() => {
    if (point) {
      map.setView([point.latitude, point.longitude], 16, { animate: false });
      return;
    }
    const relevantShapes = highlightedZoneId
      ? shapes.filter((shape) => shape.zoneId === highlightedZoneId)
      : shapes;
    const positions = relevantShapes.flatMap((shape) => geometryPositions(shape.geometry) ?? []);
    if (positions.length >= 3) {
      map.fitBounds(positions as LatLngBoundsExpression, { padding: [18, 18], maxZoom: 15, animate: false });
    }
  }, [highlightedZoneId, map, point, shapes]);
  return null;
}

function DrawController({ active, onCreated, onConsumed }: Readonly<{
  active: boolean;
  onCreated?: (geometry: GeoJsonGeometry) => void;
  onConsumed?: () => void;
}>) {
  const map = useMap();
  useEffect(() => {
    if (!active) return;
    const drawer = new L.Draw.Polygon(map as L.DrawMap, {
      allowIntersection: false,
      showArea: true,
      shapeOptions: { color: "#5fbf7a", weight: 3, fillOpacity: .18 },
    });
    const handleCreated = (event: L.LeafletEvent) => {
      const layer = (event as L.LeafletEvent & { layer?: L.Layer }).layer;
      const geometry = layer ? geometryFromLayer(layer) : null;
      if (geometry) onCreated?.(geometry);
      onConsumed?.();
    };
    const handleStopped = () => onConsumed?.();
    map.on(L.Draw.Event.CREATED, handleCreated);
    map.on(L.Draw.Event.DRAWSTOP, handleStopped);
    drawer.enable();
    return () => {
      drawer.disable();
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.off(L.Draw.Event.DRAWSTOP, handleStopped);
    };
  }, [active, map, onConsumed, onCreated]);
  return null;
}

function PointController({ enabled, onPointChange }: Readonly<{ enabled: boolean; onPointChange?: (point: MapPoint) => void }>) {
  useMapEvents({
    click(event) {
      if (enabled) onPointChange?.({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });
  return null;
}

export function ZoneMapCanvas({
  shapes,
  selectedZoneIds = [],
  excludedZoneIds = [],
  highlightedZoneId,
  draftGeometry,
  point,
  drawing = false,
  allowPointSelection = false,
  compact = false,
  onGeometryCreated,
  onDrawingConsumed,
  onZoneToggle,
  onPointChange,
}: Readonly<ZoneMapCanvasProps>) {
  const rendered = useMemo(() => shapes.map((shape) => ({ ...shape, positions: geometryPositions(shape.geometry) })).filter((shape) => Boolean(shape.positions)), [shapes]);
  const draftPositions = geometryPositions(draftGeometry);

  return (
    <MapContainer
      center={[BITONTO_CENTER.latitude, BITONTO_CENTER.longitude]}
      zoom={BITONTO_CENTER.zoom}
      scrollWheelZoom
      className={`${styles.map} ${compact ? styles.compact : ""}`}
    >
      <ResizeController />
      <FitController shapes={shapes} point={point} highlightedZoneId={highlightedZoneId} />
      <DrawController active={drawing} onCreated={onGeometryCreated} onConsumed={onDrawingConsumed} />
      <PointController enabled={allowPointSelection} onPointChange={onPointChange} />
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {rendered.map((shape) => {
        const selected = selectedZoneIds.includes(shape.zoneId);
        const excluded = excludedZoneIds.includes(shape.zoneId);
        const highlighted = shape.zoneId === highlightedZoneId;
        const color = excluded ? "#d0746f" : shape.color || "#5fbf7a";
        return (
          <Polygon
            key={shape.shapeId}
            positions={shape.positions!}
            pathOptions={{
              color,
              weight: highlighted || selected ? 4 : 2,
              opacity: .9,
              fillColor: color,
              fillOpacity: selected ? .32 : highlighted ? .24 : .12,
              dashArray: excluded ? "5 5" : undefined,
            }}
            eventHandlers={{
              click: () => onZoneToggle?.(shape.zoneId),
            }}
          >
            <Tooltip sticky>{shape.name}</Tooltip>
          </Polygon>
        );
      })}

      {draftPositions ? (
        <Polygon positions={draftPositions} pathOptions={{ color: "#5fbf7a", weight: 4, fillColor: "#5fbf7a", fillOpacity: .28 }}>
          <Tooltip sticky>Nuovo perimetro</Tooltip>
        </Polygon>
      ) : null}

      {point ? (
        <CircleMarker center={[point.latitude, point.longitude]} radius={8} pathOptions={{ color: "#102019", fillColor: "#5fbf7a", fillOpacity: 1, weight: 3 }}>
          <Tooltip permanent direction="top" offset={[0, -8]}>Immobile</Tooltip>
        </CircleMarker>
      ) : null}
    </MapContainer>
  );
}
