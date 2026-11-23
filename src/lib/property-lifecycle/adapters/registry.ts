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

export function basePropertyLifecycleAdapter(
  adapterKey: string,
): PropertyLifecycleAdapter {
  switch (adapterKey) {
    case "admaiora":
      return new AdMaioraAdapter();
    case "futura":
      return new FuturaAdapter();
    case "garofalo":
      return new GarofaloAdapter();
    case "iconacasa":
      return new IconacasaAdapter();
    case "momento":
      return new MomentoAdapter();
    case "puntocasa":
      return new PuntoCasaAdapter();
    case "studiocasa":
      return new StudioCasaAdapter();
    case "studisanti":
      return new StudiSantiAdapter();
    case "trio":
      return new TrioAdapter();
    case "vistocasa":
      return new VistocasaAdapter();
    default:
      throw new Error(`Unsupported Property Lifecycle adapter: ${adapterKey}`);
  }
}
import {enrichPublicLocationEvidence} from './public-location-evidence';

export function createPropertyLifecycleAdapter(key:string):PropertyLifecycleAdapter {
 const adapter=basePropertyLifecycleAdapter(key);const normalize=adapter.normalize.bind(adapter);
 adapter.normalize=async document=>enrichPublicLocationEvidence(await normalize(document),document);return adapter;
}
