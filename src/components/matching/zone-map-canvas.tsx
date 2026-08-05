"use client";

import { useEffect, useMemo, useRef } from "react";
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
import { readableTextColor } from "@/lib/map/colors";
import { polygonLabelPoint, polygonRings, type MapPoint } from "@/lib/map/geometry";
import type { GeoJsonGeometry } from "@/lib/map/types";
import styles from "./zone-map.module.css";

export type ZoneMapShape = {
  shapeId: string;
  zoneId: string;
  zoneNumber?: number | null;
  labelPoint?: MapPoint | null;
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
  vertexEditing?: boolean;
  editingZoneId?: string | null;
  editingGeometry?: GeoJsonGeometry | null;
  allowPointSelection?: boolean;
  compact?: boolean;
  fitRequest?: number;
  showZoneLabels?: boolean;
  onGeometryCreated?: (geometry: GeoJsonGeometry) => void;
  onGeometryEdited?: (geometry: GeoJsonGeometry) => void;
  onDrawingConsumed?: () => void;
  onZoneToggle?: (zoneId: string) => void;
  onPointChange?: (point: MapPoint) => void;
};

function geometryPositions(geometry?: GeoJsonGeometry | null): LatLngExpression[][] | null {
  const rings = polygonRings(geometry);
  return rings?.map((ring) => ring.map(([longitude, latitude]) => [latitude, longitude] as LatLngExpression)) ?? null;
}

function flatGeometryPositions(geometry?: GeoJsonGeometry | null): LatLngExpression[] {
  return geometryPositions(geometry)?.flat() ?? [];
}

function geometryFromLayer(layer: L.Layer) {
  const geoJson = (layer as L.Layer & { toGeoJSON?: () => { geometry?: GeoJsonGeometry } }).toGeoJSON?.();
  return geoJson?.geometry ?? null;
}

function ResizeController() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const invalidate = () => map.invalidateSize({ pan: false });
    const timer = window.setTimeout(invalidate, 100);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(invalidate);
    observer?.observe(container);
    window.addEventListener("resize", invalidate);
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener("resize", invalidate);
    };
  }, [map]);
  return null;
}

function FitController({ shapes, draftGeometry, point, highlightedZoneId }: Readonly<{ shapes: ZoneMapShape[]; draftGeometry?: GeoJsonGeometry | null; point?: MapPoint | null; highlightedZoneId?: string | null }>) {
  const map = useMap();
  useEffect(() => {
    if (point) {
      map.setView([point.latitude, point.longitude], 16, { animate: false });
      return;
    }
    const relevantShapes = highlightedZoneId
      ? shapes.filter((shape) => shape.zoneId === highlightedZoneId)
      : shapes;
    const positions = draftGeometry
      ? flatGeometryPositions(draftGeometry)
      : relevantShapes.flatMap((shape) => flatGeometryPositions(shape.geometry));
    if (positions.length >= 3) {
      map.fitBounds(positions as LatLngBoundsExpression, { padding: [18, 18], maxZoom: 15, animate: false });
    } else {
      map.setView([BITONTO_CENTER.latitude, BITONTO_CENTER.longitude], BITONTO_CENTER.zoom, { animate: false });
    }
  }, [draftGeometry, highlightedZoneId, map, point, shapes]);
  return null;
}

function FitAllController({ shapes, fitRequest }: Readonly<{ shapes: ZoneMapShape[]; fitRequest: number }>) {
  const map = useMap();
  useEffect(() => {
    if (fitRequest === 0) return;
    const positions = shapes.flatMap((shape) => flatGeometryPositions(shape.geometry));
    if (positions.length >= 3) {
      map.fitBounds(positions as LatLngBoundsExpression, { padding: [18, 18], maxZoom: 15, animate: false });
    } else {
      map.setView([BITONTO_CENTER.latitude, BITONTO_CENTER.longitude], BITONTO_CENTER.zoom, { animate: false });
    }
  }, [fitRequest, map, shapes]);
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

function EditController({ active, geometry, color, onEdited }: Readonly<{
  active: boolean;
  geometry?: GeoJsonGeometry | null;
  color?: string | null;
  onEdited?: (geometry: GeoJsonGeometry) => void;
}>) {
  const map = useMap();
  const geometryRef = useRef(geometry);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    if (!active || !wasActiveRef.current) geometryRef.current = geometry;
    wasActiveRef.current = active;
  }, [active, geometry]);

  useEffect(() => {
    if (!active) return;
    const positions = geometryPositions(geometryRef.current);
    if (!positions || positions[0].length < 3) return;

    const featureGroup = new L.FeatureGroup();
    const polygon = L.polygon(positions, {
      color: color || "#5fbf7a",
      weight: 4,
      fillColor: color || "#5fbf7a",
      fillOpacity: .28,
    });
    featureGroup.addLayer(polygon);
    map.addLayer(featureGroup);

    const editor = new L.EditToolbar.Edit(map as L.DrawMap, {
      featureGroup,
      poly: { allowIntersection: false },
      selectedPathOptions: {
        color: color || "#5fbf7a",
        weight: 4,
        fillColor: color || "#5fbf7a",
        fillOpacity: .3,
        dashArray: "8 6",
      },
    });
    const publishGeometry = () => {
      const updatedGeometry = geometryFromLayer(polygon);
      if (updatedGeometry) onEdited?.(updatedGeometry);
    };

    map.on(L.Draw.Event.EDITVERTEX, publishGeometry);
    editor.enable();
    return () => {
      editor.disable();
      map.off(L.Draw.Event.EDITVERTEX, publishGeometry);
      map.removeLayer(featureGroup);
    };
  }, [active, color, map, onEdited]);

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

type RenderedZoneShape = ZoneMapShape & {
  positions: LatLngExpression[][] | null;
  resolvedLabelPoint: MapPoint | null;
};

function ZoneLabels({ shapes, highlightedZoneId }: Readonly<{
  shapes: RenderedZoneShape[];
  highlightedZoneId?: string | null;
}>) {
  const labels = shapes.filter((shape) => shape.resolvedLabelPoint);

  return labels.map((shape) => (
    <CircleMarker
      key={`label-${shape.shapeId}`}
      center={[shape.resolvedLabelPoint!.latitude, shape.resolvedLabelPoint!.longitude]}
      radius={0}
      interactive={false}
      pathOptions={{ opacity: 0, fillOpacity: 0 }}
    >
      <Tooltip
        permanent
        direction="center"
        className={`${styles.zoneLabel} ${styles.zoneLabelDetailed} ${shape.zoneId === highlightedZoneId ? styles.zoneLabelHighlighted : ""}`}
      >
        <span className={styles.zoneLabelContent}>
          {shape.zoneNumber ? (
            <span className={styles.zoneLabelNumber} style={{ backgroundColor: shape.color || "#5fbf7a", color: readableTextColor(shape.color || "#5fbf7a") }}>
              {shape.zoneNumber}
            </span>
          ) : null}
          <span className={styles.zoneLabelName}>{shape.name}</span>
        </span>
      </Tooltip>
    </CircleMarker>
  ));
}

export function ZoneMapCanvas({
  shapes,
  selectedZoneIds = [],
  excludedZoneIds = [],
  highlightedZoneId,
  draftGeometry,
  point,
  drawing = false,
  vertexEditing = false,
  editingZoneId,
  editingGeometry,
  allowPointSelection = false,
  compact = false,
  fitRequest = 0,
  showZoneLabels = false,
  onGeometryCreated,
  onGeometryEdited,
  onDrawingConsumed,
  onZoneToggle,
  onPointChange,
}: Readonly<ZoneMapCanvasProps>) {
  const rendered = useMemo(() => shapes.map((shape) => ({
    ...shape,
    positions: geometryPositions(shape.geometry),
    resolvedLabelPoint: shape.labelPoint ?? polygonLabelPoint(shape.geometry),
  })).filter((shape): shape is RenderedZoneShape => Boolean(shape.positions)), [shapes]);
  const draftPositions = geometryPositions(draftGeometry);

  return (
    <MapContainer
      center={[BITONTO_CENTER.latitude, BITONTO_CENTER.longitude]}
      zoom={BITONTO_CENTER.zoom}
      scrollWheelZoom
      className={`${styles.map} ${compact ? styles.compact : ""}`}
    >
      <ResizeController />
      <FitController shapes={shapes} draftGeometry={draftGeometry} point={point} highlightedZoneId={highlightedZoneId} />
      <FitAllController shapes={shapes} fitRequest={fitRequest} />
      <DrawController active={drawing} onCreated={onGeometryCreated} onConsumed={onDrawingConsumed} />
      <EditController
        active={vertexEditing}
        geometry={editingGeometry}
        color={shapes.find((shape) => shape.zoneId === editingZoneId)?.color}
        onEdited={onGeometryEdited}
      />
      <PointController enabled={allowPointSelection} onPointChange={onPointChange} />
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {rendered.map((shape) => {
        if (vertexEditing && shape.zoneId === editingZoneId) return null;
        const selected = selectedZoneIds.includes(shape.zoneId);
        const excluded = excludedZoneIds.includes(shape.zoneId);
        const highlighted = shape.zoneId === highlightedZoneId;
        const color = excluded ? "#d0746f" : shape.color || "#5fbf7a";
        const strokeColor = showZoneLabels && !excluded ? "#eef3ef" : color;
        return (
          <Polygon
            key={shape.shapeId}
            positions={shape.positions!}
            pathOptions={{
              color: strokeColor,
              weight: highlighted || selected ? 4 : showZoneLabels ? 2.5 : 2,
              opacity: .9,
              fillColor: color,
              fillOpacity: selected ? .32 : highlighted ? .28 : showZoneLabels ? .24 : .12,
              dashArray: excluded ? "5 5" : undefined,
            }}
            eventHandlers={{
              click: () => onZoneToggle?.(shape.zoneId),
            }}
          >
            {!showZoneLabels ? <Tooltip sticky>{shape.name}</Tooltip> : null}
          </Polygon>
        );
      })}

      {showZoneLabels ? <ZoneLabels shapes={rendered} highlightedZoneId={highlightedZoneId} /> : null}

      {draftPositions && !vertexEditing ? (
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
