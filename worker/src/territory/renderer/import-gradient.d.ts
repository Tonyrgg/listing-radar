import type { ImportDistribution } from "../progress.js";
type Point = { x: number; y: number };
export function gradientStops(distribution: Partial<ImportDistribution> | undefined, palette: Record<"recent" | "aging" | "stale" | "never", string>): Array<{ at: number; color: string }>;
export function traceMetrics(rings: Point[][]): { edges: Array<{ a: Point; b: Point; length: number; start: number }>; total: number };
export function importGradientRenderer(L: unknown, options: Record<string, unknown>): unknown;
