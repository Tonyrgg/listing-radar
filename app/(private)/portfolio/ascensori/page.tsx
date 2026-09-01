import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ElevatorSurvey, type RilievoAscensore } from "@/components/matching/elevator-survey";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import { formatNumber } from "@/lib/formatting";
import {
  elevatorIsRelevant,
  propertyElevatorState,
  requestRequiresElevator,
} from "@/lib/matching/elevator";
import { listProperties, listRequests } from "@/lib/matching/repository";

export const metadata: Metadata = { title: "L'ascensore delle nostre case" };

/**
 * Il rilievo dell'ascensore.
 *
 * Il gestionale l'ascensore non lo dice: nessuno dei nostri incarichi lo
 * portava, e la regola dell'ascensore tratta un dato mancante come un no. Il
 * risultato era che un cliente che pretende l'ascensore non poteva vedere
 * nemmeno una casa, e nessuno se ne accorgeva perche' la scheda scriveva
 * «ascensore no» come se fosse un dato accertato.
 *
 * Questa pagina esiste per chiudere quel vuoto una volta, e per riaprirsi da
 * sola ogni volta che dal gestionale entra un incarico nuovo.
 */

const TIPI: Record<string, string> = {
  apartment: "appartamento",
  independent_house: "casa indipendente",
  villa: "villa",
  townhouse: "villetta",
  penthouse: "attico",
  ground_floor: "piano terra",
  entire_building: "intero stabile",
  commercial_space: "locale commerciale",
  office: "ufficio",
  warehouse: "deposito",
  garage: "garage",
  land: "terreno",
  other: "altro",
};

export default async function AscensoriPage() {
  const [properties, requests] = await Promise.all([listProperties(), listRequests()]);

  /* Il piano terra non entra: li' l'ascensore non serve e chiederlo e' tempo
   * perso. Chi non ha il piano compilato invece entra, perche' senza il piano
   * la regola non puo' dire che sia superfluo. */
  const daChiedere = properties
    .filter((property) => property.mandate_status === "active")
    .filter((property) => elevatorIsRelevant(property) !== false);

  const immobili: RilievoAscensore[] = daChiedere
    .map((property) => ({
      id: property.id,
      nome: property.address || property.title || "Immobile senza nome",
      piano: property.floor ?? null,
      tipologia: TIPI[property.property_type] ?? property.property_type,
      zona: property.zone?.name ?? null,
      stato: propertyElevatorState(property),
    }))
    .sort((primo, secondo) => {
      if (primo.stato !== secondo.stato) return primo.stato === "undeclared" ? -1 : 1;
      return primo.nome.localeCompare(secondo.nome, "it");
    });

  const mancanti = immobili.filter((immobile) => immobile.stato === "undeclared").length;
  const pretendono = requests.filter(
    (request) => ["active", "urgent"].includes(request.status) && requestRequiresElevator(request),
  ).length;

  return (
    <div className="space-y-5">
      <MatchingSectionHeader
        eyebrow="Portafoglio"
        title="L'ascensore delle nostre case"
        description={
          mancanti
            ? `${formatNumber(mancanti)} immobili su ${formatNumber(immobili.length)} non dicono se hanno l'ascensore. Finché non lo dicono, per il motore non ce l'hanno.`
            : `Tutti e ${formatNumber(immobili.length)} gli immobili dove l'ascensore conta hanno la loro risposta.`
        }
      />

      <p className="text-[length:var(--lr-text-body)] leading-6 text-[var(--lr-ink-2)]">
        Chi chiede l’ascensore non sta esprimendo una preferenza: sta dicendo che
        le scale non le fa, quindi un immobile che non ce l’ha esce dalla sua
        lista invece di perdere punti.
        {pretendono ? (
          <>
            {" "}Oggi lo pretendono{" "}
            <strong className="font-[650] text-[var(--lr-ink)]">
              {formatNumber(pretendono)} richieste attive
            </strong>
            : ogni casa lasciata senza risposta resta invisibile a tutte.
          </>
        ) : null}{" "}
        I piani terra non compaiono in questa lista: lì l’ascensore non serve.
      </p>

      <ElevatorSurvey immobili={immobili} />

      <p className="text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
        <Link
          href="/portfolio"
          className="inline-flex items-center gap-1.5 rounded-[var(--lr-radius-control)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lr-accent)]"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          Torna al portafoglio
        </Link>
      </p>
    </div>
  );
}
