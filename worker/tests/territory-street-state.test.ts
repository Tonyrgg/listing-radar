import { describe, expect, it } from "vitest";
import { streetViewState } from "../src/territory/renderer/street-state.js";

const detail = (runs: Array<{ id?: string; operation: string; state: string }> = [], units: unknown[] = [], complete = false) => ({ street: { id: "20", progress: { complete, acquiredAt: "2026-10-10T08:00:00Z" } }, runs, units });
describe("Presentazione della via prima dell'acquisizione", () => {
  it("un tentativo non costituisce un inventario acquisito", () => {
    expect(streetViewState(detail(), null)).toMatchObject({ hasInventory: false, phase: "unacquired" });
    expect(streetViewState(detail([{ id: "r", operation: "scan", state: "paused" }]), null)).toMatchObject({ hasInventory: false, phase: "interrupted" });
    expect(streetViewState(detail(), { operation: "scan", streetId: "20" }).phase).toBe("acquiring");
    expect(streetViewState(detail(), { operation: "scan", streetId: "21" }).phase).toBe("unacquired");
  });
  it("mostra i dati parziali e distingue un inventario concluso vuoto", () => {
    expect(streetViewState(detail([], [{ key: "immobile" }]), null)).toMatchObject({ hasInventory: true, phase: "populated" });
    expect(streetViewState(detail([{ operation: "scan", state: "completed" }]), null).hasInventory).toBe(true);
    expect(streetViewState(detail([], [], true), null).hasInventory).toBe(true);
  });
});
