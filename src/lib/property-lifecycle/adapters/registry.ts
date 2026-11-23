import type { HttpClient } from "@/lib/http/client";
import { AdMaioraAdapter } from "@/lib/property-lifecycle/adapters/admaiora";
import { FuturaAdapter } from "@/lib/property-lifecycle/adapters/futura";
import { GarofaloAdapter } from "@/lib/property-lifecycle/adapters/garofalo";
import { IconacasaAdapter } from "@/lib/property-lifecycle/adapters/iconacasa";
import { MomentoAdapter } from "@/lib/property-lifecycle/adapters/momento";
import { PuntoCasaAdapter } from "@/lib/property-lifecycle/adapters/puntocasa";
import { StudioCasaAdapter } from "@/lib/property-lifecycle/adapters/studiocasa";
import { StudiSantiAdapter } from "@/lib/property-lifecycle/adapters/studisanti";
import { TrioAdapter } from "@/lib/property-lifecycle/adapters/trio";
import { VistocasaAdapter } from "@/lib/property-lifecycle/adapters/vistocasa";
import type { PropertyLifecycleAdapter } from "@/lib/property-lifecycle/adapters/types";

function basePropertyLifecycleAdapter(
  adapterKey: string, http?: HttpClient,
): PropertyLifecycleAdapter {
  switch (adapterKey) {
    case "admaiora":
      return new AdMaioraAdapter(http);
    case "futura":
      return new FuturaAdapter(http);
    case "garofalo":
      return new GarofaloAdapter(http);
    case "iconacasa":
      return new IconacasaAdapter(http);
    case "momento":
      return new MomentoAdapter(http);
    case "puntocasa":
      return new PuntoCasaAdapter(http);
    case "studiocasa":
      return new StudioCasaAdapter(http);
    case "studisanti":
      return new StudiSantiAdapter(http);
    case "trio":
      return new TrioAdapter(http);
    case "vistocasa":
      return new VistocasaAdapter(http);
    default:
      throw new Error(`Unsupported Property Lifecycle adapter: ${adapterKey}`);
  }
}
import {enrichPublicLocationEvidence} from './public-location-evidence';

export function createPropertyLifecycleAdapter(key:string,http?:HttpClient):PropertyLifecycleAdapter {
 const adapter=basePropertyLifecycleAdapter(key,http);const normalize=adapter.normalize.bind(adapter);
 adapter.normalize=async document=>enrichPublicLocationEvidence(await normalize(document),document);return adapter;
}
