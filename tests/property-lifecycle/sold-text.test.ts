import {describe,it,expect} from "vitest";
import {isExplicitSoldText} from "@/lib/property-lifecycle/assets/sold-text";
describe("sold overlay evidence",()=>{
 it("accepts an explicit legible mark",()=>{expect(isExplicitSoldText("VENDUTO",92)).toBe(true);expect(isExplicitSoldText("VENDUTA",88)).toBe(true);});
 it("rejects weak OCR and negated sales",()=>{expect(isExplicitSoldText("VENDUTO",50)).toBe(false);expect(isExplicitSoldText("NON ANCORA VENDUTO",95)).toBe(false);});
});
