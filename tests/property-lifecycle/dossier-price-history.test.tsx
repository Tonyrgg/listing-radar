import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,it,expect} from "vitest";
import {PropertyPriceHistory} from "@/components/casa/property-price-history";
describe("price history evidence in the redesigned dossier",()=>{
 it("does not invent a trend from a current price alone",()=>{
  const html=renderToStaticMarkup(<PropertyPriceHistory currentPrice={120000} events={[]}/>);
  expect(html).toContain("Nessuna variazione");expect(html).not.toContain("<svg");
 });
 it("shows conflicting source prices without merging them into a chart",()=>{
  const html=renderToStaticMarkup(<PropertyPriceHistory currentPrice={120000} conflict events={[{occurredAt:"2026-11-01",oldPrice:140000,newPrice:120000}]}/>);
  expect(html).toContain("discordanti");expect(html).not.toContain("<svg");expect(html).toContain("#pubblicazioni");
 });
 it("orders observed changes by their actual dates and keeps the values accessible",()=>{
  const html=renderToStaticMarkup(<PropertyPriceHistory currentPrice={100000} events={[{occurredAt:"2026-11-10",oldPrice:120000,newPrice:100000},{occurredAt:"2026-10-01",oldPrice:140000,newPrice:120000}]}/>);
  expect(html).toContain("<svg");expect(html).toContain("<table");expect(html.indexOf("01 ott 2026")).toBeLessThan(html.indexOf("10 nov 2026"));expect(html).toContain("140.000");expect(html).toContain("100.000");
 });
});
