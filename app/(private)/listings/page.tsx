import { Building2, UserRound, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AutoSubmitFiltersForm } from "@/components/auto-submit-filters-form";
import { PageHeader } from "@/components/page-header";
import { RigaDiCasa, rigaDaMercato, rigaDaPortafoglio, type RigaCasa } from "@/components/casa/riga";
import {
  Campo,
  Card,
  Chip,
  EmptyState,
  Meta,
  Ricerca,
  Scelta,
  buttonClass,
} from "@/components/ui/primitives";
import { readNow } from "@/lib/clock";
import { formatNumber } from "@/lib/formatting";
import { signPropertyPhotos } from "@/lib/lifecycle-photos";
import { listProperties } from "@/lib/matching/repository";
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Le case" };

/**
 * L'archivio delle case. Tutte.
 *
 * Erano due elenchi in due sezioni diverse: le case osservate sul mercato in
 * «Immobili», quelle che teniamo noi in «Commerciale › Immobili disponibili».
 * Due liste, due righe, due filtri, e nessun posto dove vedere tutto il
 * mercato di Bitonto in una volta — che è esattamente la cosa che questo
 * programma sa fare e nessun portale sa.
 *
 * Adesso è una lista sola, e «chi la tiene» è un filtro come gli altri.
 */

const PER_PAGINA = 60;

type Chi = "tutte" | "noi" | "agenzie" | "privato";
type Stato = "attive" | "uscite" | "tutte";

function param(value: string | string[] | undefined, fallback: string) {
  return (Array.isArray(value) ? value[0] : value) ?? fallback;
}

function testoCercabile(riga: RigaCasa) {
  return [riga.indirizzo, riga.zona, riga.agenzia].filter(Boolean).join(" ").toLocaleLowerCase("it");
}

export default async function CasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();

  const query = await searchParams;
  const cerca = param(query.q, "").trim().toLocaleLowerCase("it");
  const chi = param(query.chi, "tutte") as Chi;
  const stato = param(query.stato, "attive") as Stato;
  const fermeDa = Number(param(query.ferme, "0")) || 0;

  const [vista, nostre, now] = await Promise.all([
    loadLifecycleView(async (repository) => ({
      proprieta: await repository.archive(),
      opportunita: await repository.opportunities(),
    })),
    listProperties(),
    readNow(),
  ]);

  const opportunitaPerCasa = new Map<string, { level: string; reasons: string[] }>();
  for (const opportunita of vista.data?.opportunita ?? []) {
    if (opportunitaPerCasa.has(opportunita.propertyId)) continue;
    opportunitaPerCasa.set(opportunita.propertyId, {
      level: opportunita.level,
      reasons: opportunita.reasons,
    });
  }

  const delMercato = (vista.data?.proprieta ?? []).map((property) =>
    rigaDaMercato(property, now, { opportunita: opportunitaPerCasa.get(property.id) }),
  );

  /* Le case nostre entrano nella stessa lista: cambia chi le tiene, non cosa
   * sono. Gli incarichi chiusi restano fuori dal filtro «attive», come le
   * case uscite dal mercato. */
  const nostreRighe = nostre.map((property) => rigaDaPortafoglio(property, now));
  const attiveNostre = new Set(
    nostre.filter((property) => property.mandate_status === "active").map((property) => property.id),
  );
  const attiveDelMercato = new Set(
    (vista.data?.proprieta ?? [])
      .filter((property) => property.propertyState.startsWith("ACTIVE"))
      .map((property) => property.id),
  );

  const tutte = [...delMercato, ...nostreRighe];

  const filtrate = tutte.filter((riga) => {
    if (cerca && !testoCercabile(riga).includes(cerca)) return false;

    if (chi === "noi" && riga.chi !== "noi") return false;
    if (chi === "agenzie" && riga.chi !== "agenzia") return false;
    if (chi === "privato" && riga.chi !== "privato") return false;

    const attiva = riga.chi === "noi" ? attiveNostre.has(riga.id) : attiveDelMercato.has(riga.id);
    if (stato === "attive" && !attiva) return false;
    if (stato === "uscite" && attiva) return false;

    if (fermeDa && (riga.giorni ?? 0) < fermeDa) return false;

    return true;
  });

  /* Prima quelle che hanno qualcosa da dire, poi le viste più di recente.
   * Ordinare per anzianità metteva in cima «da almeno 3.646 giorni», che è il
   * dato meno affidabile che abbiamo: chi vuole le case ferme ha il filtro. */
  const peso = { alta: 2, media: 1, bassa: 0 } as const;
  const ordinate = [...filtrate].sort((a, b) => {
    const pesoA = peso[a.segnali?.livello ?? "bassa"];
    const pesoB = peso[b.segnali?.livello ?? "bassa"];
    if (pesoA !== pesoB) return pesoB - pesoA;

    return b.vista - a.vista;
  });

  const visibili = ordinate.slice(0, PER_PAGINA);

  /* Le foto del mercato vanno firmate; quelle nostre sono già indirizzi. */
  const daFirmare = (vista.data?.proprieta ?? []).filter((property) =>
    visibili.some((riga) => riga.chi !== "noi" && riga.id === property.id),
  );
  const foto = await signPropertyPhotos(daFirmare);
  const conFoto = visibili.map((riga) =>
    riga.chi === "noi" ? riga : { ...riga, foto: foto.get(riga.id) },
  );

  const filtriAttivi = Boolean(cerca) || chi !== "tutte" || stato !== "attive" || fermeDa > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Immobili"
        title="Le case"
        description="Tutte insieme: quelle che teniamo noi e quelle che tengono gli altri. Con la loro storia e chi le vende adesso."
        actions={
          <Chip tone="neutral">
            {filtrate.length === tutte.length
              ? `${formatNumber(tutte.length)} case`
              : `${formatNumber(filtrate.length)} di ${formatNumber(tutte.length)}`}
          </Chip>
        }
      />

      <AutoSubmitFiltersForm className="flex flex-wrap items-center gap-2">
        <Ricerca
          label="Cerca fra le case"
          defaultValue={param(query.q, "")}
          placeholder="via, zona, agenzia…"
        />

        <Campo label="Chi la tiene" labelHidden className="min-w-44">
          <Scelta name="chi" defaultValue={chi}>
            <option value="tutte">Chiunque la tenga</option>
            <option value="noi">Le teniamo noi</option>
            <option value="agenzie">Le tengono le agenzie</option>
            <option value="privato">Le vende un privato</option>
          </Scelta>
        </Campo>

        <Campo label="Stato" labelHidden className="min-w-44">
          <Scelta name="stato" defaultValue={stato}>
            <option value="attive">Ancora sul mercato</option>
            <option value="uscite">Uscite dal mercato</option>
            <option value="tutte">Tutte</option>
          </Scelta>
        </Campo>

        <Campo label="In vendita da" labelHidden className="min-w-44">
          <Scelta name="ferme" defaultValue={String(fermeDa)}>
            <option value="0">Da quanto vuoi</option>
            <option value="60">Da oltre 2 mesi</option>
            <option value="150">Da oltre 5 mesi</option>
            <option value="365">Da oltre un anno</option>
          </Scelta>
        </Campo>

        {filtriAttivi ? (
          <Link href="/listings" className={buttonClass("quiet", { compact: true })}>
            <X aria-hidden="true" className="size-4" />
            Azzera
          </Link>
        ) : null}
      </AutoSubmitFiltersForm>

      <Card>
        {conFoto.length ? (
          <div>
            {conFoto.map((riga) => (
              <RigaDiCasa key={`${riga.chi}-${riga.id}`} riga={riga} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nessuna casa con questi filtri"
            description="Prova ad allargare la ricerca: potrebbero esserci case escluse da un filtro attivo."
            action={
              <Link href="/listings" className={buttonClass("primary", { compact: true })}>
                Mostra tutte
              </Link>
            }
          />
        )}
      </Card>

      {filtrate.length > visibili.length ? (
        <Meta className="px-1">
          Ne vedi {formatNumber(visibili.length)} di {formatNumber(filtrate.length)}: restringi la
          ricerca per arrivare alle altre.
        </Meta>
      ) : null}

      <Meta className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
        <span className="inline-flex items-center gap-1.5">
          <UserRound aria-hidden="true" className="size-3.5 text-[var(--lr-ink)]" /> la teniamo
          noi
        </span>
        <span className="inline-flex items-center gap-1.5">
          <UserRound aria-hidden="true" className="size-3.5 text-[var(--lr-warn)]" /> la vende un
          privato
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Building2 aria-hidden="true" className="size-3.5" /> la tiene un&apos;agenzia
        </span>
        <span>Il testo tratteggiato è dedotto, non dichiarato dalla fonte.</span>
      </Meta>
    </div>
  );
}
