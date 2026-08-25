import {
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  DoorOpen,
  History,
  Mail,
  MapPinned,
  Phone,
  Ruler,
  Settings2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MatchCard } from "@/components/matching/match-card";
import { formatShouty } from "@/lib/formatting";
import { ProgressiveList } from "@/components/progressive-list";
import { RecalculateButton, RequestControls } from "@/components/matching/management-panels";
import { RequestZonePicker } from "@/components/matching/request-zone-picker";
import {
  cleanRequestTitle,
  clientContact,
  crmField,
  displayValue,
  formatDate,
  requestActivities,
  requestArea,
  requestBudget,
  requestPayload,
  requestReference,
  requestRooms,
  requestSourceLabel,
} from "@/lib/matching/request-presentation";
import { getRequest, listClients, listZones } from "@/lib/matching/repository";
import type { Client, MatchClassification, PropertyRequest } from "@/lib/matching/types";

import styles from "../requests.module.css";

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dettaglio richiesta" };

export default async function RequestDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const [detail, clients, allZones] = await Promise.all([getRequest(id), listClients(), listZones()]);
  if (!detail) notFound();

  const request = detail.request as PropertyRequest & { clients?: Client | null };
  const payload = requestPayload(request);
  const fields = payload.fields ?? {};
  const headers = payload.headerFields ?? {};
  const contact = clientContact(request.clients);
  const activities = requestActivities(request);
  const zoneInference = payload._zone_inference ?? [];
  const clientSection = payload.relatedSections?.find((section) => section.heading === "Cliente")?.text ?? "";
  const workflowIndex = currentWorkflowIndex(payload.status, request.status);
  const desiredZoneCount = detail.zones.filter((item) => item.preference_level !== "excluded").length;
  const excludedZoneCount = detail.zones.filter((item) => item.preference_level === "excluded").length;
  const zones = detail.zones.filter((item) => item.preference_level !== "excluded").map((item) => item.zone?.name).filter(Boolean).join(", ");
  const excludedZones = detail.zones.filter((item) => item.preference_level === "excluded").map((item) => item.zone?.name).filter(Boolean).join(", ");
  const clientName = request.clients?.full_name || displayValue(fields.Cliente, "Cliente da collegare");
  const targetType = displayValue(fields["Tipologia Immobile"], propertyTypesLabel(request.property_types));

  return (
    <div className={styles.page}>
      <header className={styles.detailHeader}>
        <Link className={styles.backLink} href="/requests">
          <ArrowLeft aria-hidden="true" className="size-4" /> Tutte le richieste
        </Link>

        <div className={styles.detailTitleRow}>
          <div>
            {/* Il nome del cliente è il titolo: «RR - 3 locali - Mingolla» è il
              * codice con cui lo chiama il gestionale, non con cui lo chiami tu. */}
            <p className={styles.recordReference}>
              {request.contract_type === "sale" ? "Vuole comprare" : "Cerca in affitto"}
            </p>
            <h1 className={styles.detailTitle}>{clientName}</h1>
            <p className={styles.detailSubtitle}>
              {cleanRequestTitle(request.title)} · rif. {requestReference(request)}
            </p>
          </div>
          <div className={styles.detailActions}>
            {payload.url ? (
              <a className={styles.externalLink} href={payload.url} target="_blank" rel="noreferrer">
                Apri nel CRM <ArrowUpRight aria-hidden="true" className="size-4" />
              </a>
            ) : null}
            <RecalculateButton scope="request" id={id} />
          </div>
        </div>

        <div className={styles.contextLine} aria-label="Contesto della richiesta">
          <span><strong>{payload.status || statusLabel(request.status)}</strong> stato</span>
          <span><CalendarDays aria-hidden="true" className="size-3.5" /> inserita {displayValue(headers["Data Inserimento Richiesta"], formatDate(request.created_at))}</span>
          <span>{sourceDescription(request)}</span>
          <span>aggiornata da {displayValue(headers["Agenzia di aggiornamento"], "agenzia non indicata")}</span>
        </div>
      </header>

      <nav className={styles.workflow} aria-label="Avanzamento richiesta">
        <ol className={styles.workflowList}>
          {WORKFLOW.map((step, index) => (
            <li
              className={`${styles.workflowStep} ${index < workflowIndex ? styles.workflowComplete : ""} ${index === workflowIndex ? styles.workflowActive : ""}`}
              key={step}
              aria-current={index === workflowIndex ? "step" : undefined}
            >
              <span className={styles.stepDot}>{index < workflowIndex ? <Check aria-hidden="true" className="size-3" /> : index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </nav>

      <section className={styles.requestFocus} aria-label="Priorità della richiesta">
        <div className={styles.requestFocusMain}>
          <p className={styles.sectionEyebrow}>Obiettivo del cliente</p>
          <h2 className={styles.focusStatement}>{formatShouty(targetType)}</h2>
          <p className={styles.focusLocation}><MapPinned aria-hidden="true" className="size-4" /> {zones || "Nessuna zona preferita"}</p>
          <div className={styles.prioritySignals}>
            <Signal icon={Banknote} label="Budget" value={requestBudget(request)} />
            <Signal icon={Ruler} label="Superficie" value={requestArea(request)} />
            <Signal icon={DoorOpen} label="Locali" value={requestRooms(request)} />
            <Signal icon={Building2} label="Piano" value={displayValue(fields["Piano Immobile"], floorBandLabel(request.requested_floor_band))} />
          </div>
          {excludedZones ? <p className={styles.exclusionNote}>Da evitare: <strong>{excludedZones}</strong></p> : null}
        </div>
        <aside className={styles.clientFocus} aria-label="Contatto cliente">
          <div className={styles.clientIdentity}>
            <span><UserRound aria-hidden="true" className="size-4" /></span>
            {/* Il nome è già il titolo della pagina: qui servono i recapiti. */}
            <div><p className={styles.sectionEyebrow}>Come si raggiunge</p><h2>{clientName}</h2></div>
          </div>
          <div className={styles.contactActions}>
            {contact.phone ? <a href={`tel:${contact.phone}`}><Phone aria-hidden="true" className="size-4" /><span><small>Telefono</small>{contact.phone}</span></a> : <span className={styles.contactUnavailable}><Phone aria-hidden="true" className="size-4" /> Telefono non disponibile</span>}
            {contact.email ? <a href={`mailto:${contact.email}`}><Mail aria-hidden="true" className="size-4" /><span><small>Email</small>{contact.email}</span></a> : null}
          </div>
          <dl className={styles.clientContext}>
            <Field label="Responsabile" value={displayValue(fields.Responsabile)} />
            <Field label="Privacy" value={privacyValue(clientSection)} />
            {contact.address ? <Field label="Residenza" value={contact.address} /> : null}
          </dl>
        </aside>
      </section>

      <section className={styles.documentSection}>
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Localizzazione</p>
            <h2 className={styles.sectionTitle}>Zone desiderate e zone da evitare</h2>
          </div>
          <span className={styles.sectionCount}>{desiredZoneCount} desiderate · {excludedZoneCount} escluse</span>
        </header>
        <div className={`${styles.sectionBody} ${styles.zoneMapBody}`}>
          <RequestZonePicker
            requestId={id}
            zones={allZones}
            initialZoneIds={detail.zones.filter((item) => item.preference_level !== "excluded").map((item) => item.zone_id)}
            initialExcludedZoneIds={detail.zones.filter((item) => item.preference_level === "excluded").map((item) => item.zone_id)}
          />
          {zoneInference.length ? (
            <details className={styles.zoneEvidence}>
              <summary>Vedi come le zone sono state riconosciute dal testo CRM</summary>
              <ul>
                {zoneInference.map((item) => <li key={item.zone_id}><strong>{item.zone_name}</strong><span>{item.preference_level === "excluded" ? "Da evitare" : "Desiderata"}</span><q>{item.evidence}</q></li>)}
              </ul>
            </details>
          ) : null}
        </div>
      </section>

      <div className={styles.detailFlow}>
        <section className={styles.documentSection}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionEyebrow}>Profilo operativo</p>
              <h2 className={styles.sectionTitle}>Dettaglio dell’esigenza</h2>
            </div>
          </header>
          <div className={styles.sectionBody}>
            <dl className={styles.needGrid}>
              <Need label="Esigenze" value={displayValue(fields.Esigenze, request.notes || "Non indicate")} />
              <Need label="Dettaglio economico" value={displayValue(fields["Dettaglio Esigenza"], financingLabel(request.financing_method))} />
              <Need label="Destinazione" value={displayValue(fields["Destinazione Richiesta"], destinationLabel(request.destination))} />
              <Need label="Ascensore" value={displayValue(fields.Ascensore)} />
              <Need label="Arredato" value={displayValue(fields.Arredato)} />
              <Need label="Rimesse" value={displayValue(fields.Rimesse)} />
              <Need label="Permuta" value={displayValue(fields.Permuta)} />
              <Need label="Specifiche prezzo" value={displayValue(fields["Specifiche Prezzo"])} />
              <Need label="Merito creditizio" value={displayValue(fields["Merito creditizio"], creditLabel(request.credit_status))} />
              <Need label="Da soddisfare entro" value={displayValue(fields["Da Soddisfare Entro Il"])} />
            </dl>
          </div>
        </section>

        <section className={styles.documentSection}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionEyebrow}>CRM</p>
              <h2 className={styles.sectionTitle}>Attività ed evoluzione</h2>
            </div>
            <span className={styles.sectionCount}>{activities.length}</span>
          </header>
          <div className={styles.sectionBody}>
            {activities.length ? (
              <div className={styles.activityList}>
                {activities.map((activity, index) => (
                  <article className={styles.activityItem} key={activity.id || `${activity.heading}-${index}`}>
                    <div className={styles.activityMeta}>
                      {activity.date ? <time>{activity.date}</time> : null}
                      {activity.type ? <span>{activity.type}</span> : null}
                      {activity.status ? <span>{activity.status}</span> : null}
                    </div>
                    <h3 className={styles.activityTitle}>{activity.heading}</h3>
                    <p className={styles.activityText}>{activity.text}</p>
                    {activity.assignedTo || activity.agency ? <p className={styles.activityOwner}>{[activity.assignedTo, activity.agency].filter(Boolean).join(" · ")}</p> : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className={styles.emptyInline}>{payload.activityCaptureError ? "Lo storico attività non è stato leggibile durante l’ultima sincronizzazione." : "Nessuna attività completa è stata importata dal CRM per questa richiesta."}</p>
            )}
          </div>
        </section>
      </div>

      {detail.features.length ? (
        <section className={styles.documentSection}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionEyebrow}>Preferenze esplicite</p>
              <h2 className={styles.sectionTitle}>Caratteristiche richieste</h2>
            </div>
            <span className={styles.sectionCount}>{detail.features.length}</span>
          </header>
          <div className={styles.sectionBody}>
            <div className={styles.features}>
              {detail.features.map((item) => (
                <span className={styles.feature} key={item.id}>
                  {item.feature?.label ?? "Caratteristica"} · {preferenceLabel(item.preference_level)}
                </span>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className={styles.documentSection}>
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Sistema</p>
            <h2 className={styles.sectionTitle}>Dati di archivio</h2>
          </div>
        </header>
        <div className={styles.sectionBody}>
          <dl className={styles.systemGrid}>
            <Need label="Creato da" value={displayValue(fields["Creato da"])} />
            <Need label="Ultima modifica di" value={displayValue(fields["Ultima modifica di"])} />
            <Need label="Acquisito il" value={formatDate(payload.capturedAt || request.last_imported_at, true)} />
            <Need label="Fonte" value={requestSourceLabel(request)} />
            <Need label="ID CRM" value={payload.externalId || request.external_crm_id || "Non disponibile"} />
            <Need label="ID Listing Radar" value={request.id} />
          </dl>
        </div>
      </section>

      <section className={styles.documentSection}>
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Matching</p>
            <h2 className={styles.sectionTitle}>Immobili compatibili</h2>
          </div>
          <span className={styles.sectionCount}>{detail.matches.length} risultati</span>
        </header>
        <div className={styles.sectionBody}>
          {detail.matches.length ? (
            <ProgressiveList className={styles.matchesGrid} initialCount={4} step={4} noun="immobili">
              {detail.matches.map((match) => (
                <MatchCard
                  key={match.id}
                  match={{
                    ...match,
                    classification: match.classification as MatchClassification,
                  }}
                  counterpartHref={`/portfolio/${match.property_id}`}
                  counterpartTitle={match.property?.title ?? "Immobile"}
                  detailHref={match.id ? `/matching/${match.id}` : undefined}
                />
              ))}
            </ProgressiveList>
          ) : (
            <p className={styles.emptyInline}>Nessun confronto disponibile. Inserisci un immobile attivo e ricalcola i match.</p>
          )}
        </div>
      </section>

      <details className={styles.managementSection}>
        <summary className={styles.managementSummary}>
          <span className="inline-flex items-center gap-2"><Settings2 aria-hidden="true" className="size-4" /> Gestione richiesta</span>
          <ChevronDown aria-hidden="true" className="size-4" />
        </summary>
        <div className={styles.managementContent}>
          <RequestControls id={id} status={request.status} clients={clients} clientId={request.client_id} />
        </div>
      </details>

      <details className={styles.managementSection}>
        <summary className={styles.managementSummary}>
          <span className="inline-flex items-center gap-2"><History aria-hidden="true" className="size-4" /> Cronologia Listing Radar</span>
          <span className={styles.sectionCount}>{detail.logs.length}</span>
        </summary>
        <div className={styles.managementContent}>
          <div className={styles.activityList}>
            {detail.logs.map((log) => (
              <article className={styles.activityItem} key={log.id}>
                <h3 className={styles.activityTitle}>{String(log.action).replaceAll("_", " ")}</h3>
                <time className={styles.activityText}>{formatDate(log.created_at, true)}</time>
              </article>
            ))}
            {!detail.logs.length ? <p className={styles.emptyInline}>Nessuna modifica registrata.</p> : null}
          </div>
        </div>
      </details>
    </div>
  );
}

const WORKFLOW = ["Chiudi", "Analizza richiesta", "In gestione", "In visita", "Trattativa avanzata"];

function Field({ label, value, muted = false }: Readonly<{ label: string; value: string; muted?: boolean }>) {
  return <div className={styles.fieldRow}><dt className={styles.fieldLabel}>{label}</dt><dd className={`${styles.fieldValue} ${muted ? styles.fieldValueMuted : ""}`}>{value}</dd></div>;
}

function Signal({ icon: Icon, label, value }: Readonly<{ icon: typeof Banknote; label: string; value: string }>) {
  return <div className={styles.prioritySignal}><Icon aria-hidden="true" className="size-4" /><span><small>{label}</small><strong>{value}</strong></span></div>;
}

function Need({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div className={styles.needItem}><dt className={styles.fieldLabel}>{label}</dt><dd className={styles.needValue}>{value}</dd></div>;
}

function currentWorkflowIndex(rawStatus: string | null | undefined, status: string) {
  const source = `${rawStatus ?? ""} ${status}`.toLocaleLowerCase("it");
  if (/trattativa|soddisfatta|conclus/.test(source)) return 4;
  if (/visita|appuntamento/.test(source)) return 3;
  if (/gestione|active|urgent/.test(source)) return 2;
  if (/analizza|bozza|draft/.test(source)) return 1;
  return 0;
}

function sourceDescription(request: PropertyRequest) {
  const payload = requestPayload(request);
  const fromInternet = crmField(payload, "Da Internet");
  const ownListing = crmField(payload, "Da mio annuncio");
  if (fromInternet === true) return "Internet";
  if (ownListing === true || request.from_own_listing) return "Mio annuncio";
  return requestSourceLabel(request);
}

function privacyValue(text: string) {
  const match = text.match(/Privacy:\s*([^0-9]+?)(?:\s+Tipologia|$)/i);
  return match?.[1]?.trim() || "Non indicata";
}

function propertyTypesLabel(types: string[]) {
  if (!types.length) return "Non indicata";
  return types.map((type) => ({ apartment: "Appartamento", independent_house: "Casa indipendente", villa: "Villa", townhouse: "Villetta", penthouse: "Attico", ground_floor: "Piano terra", entire_building: "Intero stabile" }[type] ?? type)).join(", ");
}

function statusLabel(status: string) {
  return ({ draft: "Bozza", active: "Attiva", urgent: "Urgente", suspended: "Sospesa", satisfied: "Soddisfatta", cancelled: "Annullata", archived: "Archiviata" }[status] ?? status);
}

function destinationLabel(value?: string | null) {
  return ({ first_home: "Prima casa", investment: "Investimento", exchange: "Permuta", temporary: "Esigenza temporanea", other: "Altro" }[value ?? ""] ?? "Non indicata");
}

function financingLabel(value?: string | null) {
  return ({ cash: "Contanti", cash_and_mortgage: "Contanti + mutuo", full_mortgage: "Mutuo 100%", exchange: "Permuta", other: "Da definire" }[value ?? ""] ?? "Non indicato");
}

function floorBandLabel(value?: string | null) {
  return ({ any: "Qualsiasi", low: "Basso", medium: "Medio", high: "Alto", top: "Ultimo piano" }[value ?? ""] ?? "Qualsiasi");
}

function creditLabel(value?: string | null) {
  return ({ unknown: "Da verificare", in_progress: "Verifica in corso", positive: "Positivo", negative: "Criticità rilevate" }[value ?? ""] ?? "Non indicato");
}

function preferenceLabel(value: string) {
  return ({ required: "Indispensabile", preferred: "Preferita", indifferent: "Indifferente", avoid: "Da evitare" }[value] ?? value);
}
