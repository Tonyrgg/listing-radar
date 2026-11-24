import { unitPosition } from "./unit-order.js";
import type { SourceProperty } from "../import-v2/model.js";
import type { NewsPin } from "./news-pins.js";

function portalFloors(value: string | null | undefined) {
  const floor = value?.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("it");
  if (!floor) return [];
  if (/^(?:t|terra|piano terra|rialzato|piano rialzato)$/.test(floor)) return [0];
  const parsed = floor.match(/^(?:piano\s*)?(-?\d+)\s*(?:°|º|o|piano)?$/);
  return parsed ? [Number(parsed[1])] : [];
}

export function comparePinUnit(pin: Pick<NewsPin, "floor" | "rooms">, source: SourceProperty) {
  const { floors } = unitPosition(source);
  const expectedFloors = portalFloors(pin.floor);
  const roomsValue = /^(\d+(?:[.,]\d+)?)(?:\s*vani?)?$/i.exec(source.consistency?.trim() ?? "")?.[1];
  const rooms = /^A\s*\/?\s*\d/i.test(source.category) && roomsValue ? Number(roomsValue.replace(",", ".")) : null;
  const floorMatch = expectedFloors.length && floors.length ? floors.some(floor => expectedFloors.includes(floor)) : null;
  const roomsDiff = pin.rooms != null && rooms != null ? Math.abs(pin.rooms - rooms) : null;
  const score = 60 + (floorMatch === true ? 25 : floorMatch === false ? -20 : 0) +
    (roomsDiff == null ? 0 : roomsDiff === 0 ? 15 : roomsDiff <= 1 ? 5 : -10);
  return {
    score, floors, rooms,
    floorNote: floorMatch === null ? "Piano non confrontabile" : floorMatch ? "Piano compatibile" : "Piano diverso",
    roomsNote: roomsDiff === null ? "Vani non confrontabili" : roomsDiff === 0 ? "Vani coincidenti" : roomsDiff <= 1 ? "Vani simili" : "Vani diversi",
  };
}
