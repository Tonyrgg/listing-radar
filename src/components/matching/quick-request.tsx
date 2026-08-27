"use client";

import {
  ArrowRight,
  Ban,
  Check,
  ChevronLeft,
  Circle,
  Minus,
  Plus,
  Star,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  getQuickRequestOptionsAction,
  saveClientAction,
  saveRequestAction,
} from "@/app/(private)/matching-actions";
import type {
  FeatureDefinition,
  InternalZone,
  PreferenceLevel,
} from "@/lib/matching/types";

export const OPEN_QUICK_REQUEST_EVENT = "listing-radar:open-quick-request";

export function QuickRequestButton({
  compact = false,
  className,
}: Readonly<{ compact?: boolean; className?: string }>) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_QUICK_REQUEST_EVENT))}
      title="Nuova richiesta rapida"
      className={clsx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--lr-radius-control)] bg-[var(--lr-accent)] px-4 text-[length:var(--lr-text-body)] font-bold text-[var(--lr-accent-ink)] transition-colors hover:bg-[var(--lr-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lr-accent)]",
        className,
      )}
    >
      <Plus aria-hidden="true" className="size-4" />
      {compact ? (
        <span className="sr-only">Nuova richiesta rapida</span>
      ) : (
        "Nuova richiesta rapida"
      )}
    </button>
  );
}

const propertyTypes = [
  ["apartment", "Appartamento"],
  ["independent_house", "Casa indipendente"],
  ["villa", "Villa"],
  ["townhouse", "Villetta a schiera"],
  ["penthouse", "Attico"],
  ["ground_floor", "Piano terra"],
  ["entire_building", "Intero stabile"],
  ["commercial_space", "Locale commerciale"],
  ["office", "Ufficio"],
  ["warehouse", "Deposito / magazzino"],
  ["garage", "Garage / box"],
  ["land", "Terreno"],
  ["other", "Altra tipologia"],
] as const;

const quickPropertyTypes = propertyTypes.filter(([value]) =>
  ["apartment", "independent_house", "villa", "ground_floor", "commercial_space", "other"].includes(value),
);

const commonFeatures = new Set([
  "elevator",
  "balcony",
  "terrace",
  "garden",
  "garage",
  "parking_space",
  "cellar",
  "independent_entrance",
  "eat_in_kitchen",
  "furnished",
  "ground_floor_accepted",
]);

const steps = [
  {
    number: 1,
    title: "Cliente e casa",
    description: "Chi cerca, cosa e dove",
  },
  {
    number: 2,
    title: "Budget e dimensioni",
    description: "I limiti essenziali",
  },
] as const;

type Draft = {
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  contract_type: "sale" | "rent";
  property_types: string[];
  zones: string[];
  ideal: string;
  maximum: string;
  sqmMin: string;
  sqmMax: string;
  rooms: string;
  bedrooms: string;
  bathrooms: string;
  featurePreferences: Record<string, PreferenceLevel>;
  floorMin: string;
  floorMax: string;
  floorBand: "any" | "low" | "medium" | "high" | "top";
  conditions: string[];
  destination: "first_home" | "investment" | "exchange" | "temporary" | "other";
  financingMethod: "" | "cash" | "cash_and_mortgage" | "full_mortgage" | "exchange" | "other";
  creditStatus: "unknown" | "in_progress" | "positive" | "negative";
  fromOwnListing: boolean;
  availableBy: string;
  priority: "low" | "normal" | "high" | "urgent";
  notes: string;
};

const initialDraft: Draft = {
  clientName: "",
  clientPhone: "",
  clientEmail: "",
  contract_type: "sale",
  property_types: ["apartment"],
  zones: [],
  ideal: "",
  maximum: "",
  sqmMin: "",
  sqmMax: "",
  rooms: "",
  bedrooms: "",
  bathrooms: "",
  featurePreferences: {},
  floorMin: "",
  floorMax: "",
  floorBand: "any",
  conditions: [],
  destination: "first_home",
  financingMethod: "",
  creditStatus: "unknown",
  fromOwnListing: false,
  availableBy: "",
  priority: "normal",
  notes: "",
};

function ChoiceButton({
  selected,
  children,
  onClick,
  compact = false,
}: Readonly<{
  selected: boolean;
  children: React.ReactNode;
  onClick: () => void;
  compact?: boolean;
}>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={clsx(
        "rounded-[var(--lr-radius-control)] border font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lr-accent)]",
        compact ? "min-h-10 px-3 text-[length:var(--lr-text-body)]" : "min-h-12 px-4 text-[length:var(--lr-text-body)]",
        selected
          ? "border-[var(--lr-accent)] bg-[var(--lr-accent-soft)] text-[var(--lr-ink)]"
          : "border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] text-[var(--lr-ink-2)] hover:border-[var(--lr-line)] hover:text-[var(--lr-ink)]",
      )}
    >
      {children}
    </button>
  );
}

function Question({
  title,
  help,
  children,
}: Readonly<{
  title: string;
  help?: string;
  children: React.ReactNode;
}>) {
  return (
    <section className="border-b border-[var(--lr-line-quiet)] py-6 first:pt-0 last:border-b-0 last:pb-0">
      <div className="max-w-2xl">
        <h3 className="text-[length:var(--lr-text-record)] font-semibold text-[var(--lr-ink)]">
          {title}
        </h3>
        {help ? (
          <p className="mt-1 text-[length:var(--lr-text-body)] leading-5 text-[var(--lr-ink-2)]">{help}</p>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const preferenceOptions: Array<{
  value: PreferenceLevel;
  label: string;
  icon: typeof Circle;
}> = [
  { value: "indifferent", label: "Non importa", icon: Minus },
  { value: "preferred", label: "Sarebbe utile", icon: Star },
  { value: "required", label: "Indispensabile", icon: Check },
  { value: "avoid", label: "Da evitare", icon: Ban },
];

function FeatureChoice({
  feature,
  value,
  onChange,
}: Readonly<{
  feature: FeatureDefinition;
  value: PreferenceLevel;
  onChange: (value: PreferenceLevel) => void;
}>) {
  return (
    <div className="grid gap-3 border-b border-[var(--lr-line-quiet)] py-4 last:border-b-0 md:grid-cols-[minmax(150px,.65fr)_minmax(0,1.35fr)] md:items-center">
      <p className="font-semibold text-[var(--lr-ink)]">{feature.label}</p>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {preferenceOptions.map((option) => {
          const Icon = option.icon;
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={clsx(
                "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--lr-radius-control)] border px-2 text-[length:var(--lr-text-meta)] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lr-accent)]",
                selected
                  ? "border-[var(--lr-accent)] bg-[var(--lr-accent-soft)] text-[var(--lr-ink)]"
                  : "border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] text-[var(--lr-ink-2)] hover:border-[var(--lr-line)]",
              )}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function QuickRequestDrawer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(initialDraft);
  const [zones, setZones] = useState<InternalZone[]>([]);
  const [features, setFeatures] = useState<FeatureDefinition[]>([]);
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const [customBudget, setCustomBudget] = useState(false);
  const [customSqm, setCustomSqm] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const listener = () => {
      setOpen(true);
      setError("");
      getQuickRequestOptionsAction()
        .then((result) => {
          setZones(result.zones as InternalZone[]);
          setFeatures(result.features as FeatureDefinition[]);
        })
        .catch(() =>
          setError("Prima di continuare, applica la migration Richieste e Matching in Supabase."),
        );
    };
    window.addEventListener(OPEN_QUICK_REQUEST_EVENT, listener);
    return () => window.removeEventListener(OPEN_QUICK_REQUEST_EVENT, listener);
  }, []);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", escape);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", escape);
      document.body.style.overflow = "";
    };
  }, [open]);

  const visibleFeatures = useMemo(
    () =>
      features.filter(
        (feature) => showAllFeatures || commonFeatures.has(feature.key),
      ),
    [features, showAllFeatures],
  );

  const currentStep = steps[step - 1];

  const toggle = (
    key: "property_types" | "zones" | "conditions",
    value: string,
  ) =>
    setDraft((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function chooseBudget(value: number) {
    setCustomBudget(false);
    set("maximum", String(value));
    set("ideal", "");
  }

  function chooseSqm(minimum: number, maximum: number | null) {
    setCustomSqm(false);
    set("sqmMin", String(minimum));
    set("sqmMax", maximum == null ? "" : String(maximum));
  }

  function chooseFloorBand(band: Draft["floorBand"]) {
    const ranges: Record<Draft["floorBand"], [string, string]> = {
      any: ["", ""],
      low: ["0", "2"],
      medium: ["3", "4"],
      high: ["5", ""],
      top: ["", ""],
    };
    const [minimum, maximum] = ranges[band];
    setDraft((current) => ({
      ...current,
      floorBand: band,
      floorMin: minimum,
      floorMax: maximum,
    }));
  }

  function save(status: "draft" | "active", showMatches: boolean) {
    setError("");
    startTransition(async () => {
      try {
        const client = draft.clientName.trim() || draft.clientPhone.trim() || draft.clientEmail.trim()
          ? await saveClientAction({
              full_name: draft.clientName.trim() || null,
              phone: draft.clientPhone.trim() || null,
              email: draft.clientEmail.trim() || null,
              notes: null,
            })
          : null;
        const primaryType = propertyTypes.find(([value]) => value === draft.property_types[0])?.[1]
          ?? "Immobile";
        const requestLabel = draft.rooms
          ? `${draft.rooms} ${Number(draft.rooms) === 1 ? "locale" : "locali"}`
          : primaryType;
        const clientLabel = draft.clientName.trim().split(/\s+/).at(-1) || "Nuova";
        const result = await saveRequestAction({
          client_id: client?.id ?? null,
          title: `RR - ${requestLabel} - ${clientLabel}`,
          contract_type: draft.contract_type,
          property_types: draft.property_types,
          municipality: "Bitonto",
          status,
          priority: draft.priority,
          destination: draft.destination,
          financing_method:
            draft.contract_type === "sale" && draft.financingMethod
              ? draft.financingMethod
              : null,
          credit_status: draft.creditStatus,
          requested_floor_band: draft.floorBand,
          from_own_listing: draft.fromOwnListing,
          budget_ideal:
            draft.contract_type === "sale" && draft.ideal
              ? Number(draft.ideal)
              : null,
          budget_max:
            draft.contract_type === "sale" && draft.maximum
              ? Number(draft.maximum)
              : null,
          monthly_rent_ideal:
            draft.contract_type === "rent" && draft.ideal
              ? Number(draft.ideal)
              : null,
          monthly_rent_max:
            draft.contract_type === "rent" && draft.maximum
              ? Number(draft.maximum)
              : null,
          internal_sqm_min: draft.sqmMin ? Number(draft.sqmMin) : null,
          internal_sqm_ideal: null,
          internal_sqm_max: draft.sqmMax ? Number(draft.sqmMax) : null,
          rooms_min: draft.rooms ? Number(draft.rooms) : null,
          rooms_ideal: draft.rooms ? Number(draft.rooms) : null,
          rooms_max: null,
          bedrooms_min: draft.bedrooms ? Number(draft.bedrooms) : null,
          bathrooms_min: draft.bathrooms ? Number(draft.bathrooms) : null,
          floor_min: draft.floorMin ? Number(draft.floorMin) : null,
          floor_max: draft.floorMax ? Number(draft.floorMax) : null,
          accepted_conditions: draft.conditions,
          available_by: draft.availableBy || null,
          availability_requirement: null,
          notes: draft.notes || null,
          zone_preferences: draft.zones.map((zone_id) => ({
            zone_id,
            preference_level: "preferred",
          })),
          feature_preferences: Object.entries(draft.featurePreferences)
            .filter(([, preference_level]) => preference_level !== "indifferent")
            .map(([feature_definition_id, preference_level]) => ({
              feature_definition_id,
              preference_level,
              desired_value: true,
            })),
        });
        setOpen(false);
        setStep(1);
        setDraft(initialDraft);
        setCustomBudget(false);
        setCustomSqm(false);
        router.push(showMatches ? `/requests/${result.id}` : "/requests");
        router.refresh();
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Non sono riuscito a salvare la richiesta.",
        );
      }
    });
  }

  if (!open) return null;

  const saleBudgets = [80000, 100000, 120000, 150000, 180000, 200000];
  const rentBudgets = [400, 500, 600, 700, 800];
  const budgets = draft.contract_type === "sale" ? saleBudgets : rentBudgets;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-[var(--lr-scrim)] p-3 sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-request-title"
        className="flex max-h-[94vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)]"
      >
        <header className="flex shrink-0 items-start justify-between gap-5 border-b border-[var(--lr-line-quiet)] px-5 py-4 sm:px-7 sm:py-5">
          <div>
            <p className="text-[length:var(--lr-text-label)] font-bold uppercase tracking-[.14em] text-[var(--lr-accent)]">
              Nuova richiesta
            </p>
            <h2
              id="quick-request-title"
              className="mt-1 text-[length:var(--lr-text-section)] font-semibold text-[var(--lr-ink)]"
            >
              Cosa sta cercando il cliente?
            </h2>
            <p className="mt-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
              Scegli le risposte. Potrai modificare tutto anche dopo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Chiudi"
            className="grid size-11 shrink-0 place-items-center rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] text-[var(--lr-ink-2)] transition-colors hover:border-[var(--lr-line)] hover:text-[var(--lr-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lr-accent)]"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[270px_minmax(0,1fr)]">
          <aside className="hidden border-r border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] p-5 lg:block">
            <p className="text-[length:var(--lr-text-label)] font-bold uppercase tracking-[.12em] text-[var(--lr-ink-3)]">
              I passaggi
            </p>
            <ol className="mt-4 space-y-2">
              {steps.map((item) => {
                const active = item.number === step;
                const completed = item.number < step;
                return (
                  <li key={item.number}>
                    <button
                      type="button"
                      disabled={item.number > step}
                      onClick={() => setStep(item.number)}
                      className={clsx(
                        "flex min-h-16 w-full items-center gap-3 rounded-[var(--lr-radius-control)] px-3 text-left transition-colors",
                        active && "bg-[var(--lr-surface)]",
                        !active &&
                          item.number <= step &&
                          "hover:bg-[var(--lr-raised)]",
                        item.number > step && "opacity-45",
                      )}
                    >
                      <span
                        className={clsx(
                          "grid size-8 shrink-0 place-items-center rounded-full text-[length:var(--lr-text-meta)] font-bold",
                          active || completed
                            ? "bg-[var(--lr-accent)] text-[var(--lr-accent-ink)]"
                            : "border border-[var(--lr-line)] text-[var(--lr-ink-3)]",
                        )}
                      >
                        {completed ? <Check className="size-4" /> : item.number}
                      </span>
                      <span>
                        <strong className="block text-[length:var(--lr-text-body)] text-[var(--lr-ink)]">
                          {item.title}
                        </strong>
                        <span className="mt-0.5 block text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                          {item.description}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>

          <div className="flex min-h-0 flex-col">
            <div className="shrink-0 border-b border-[var(--lr-line-quiet)] px-5 py-3 lg:hidden">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink)]">
                  {currentStep.title}
                </p>
                <span className="text-[length:var(--lr-text-meta)] font-semibold text-[var(--lr-ink-3)]">
                  {step} di {steps.length}
                </span>
              </div>
              <div className="mt-3 flex gap-1.5">
                {steps.map((item) => (
                  <span
                    key={item.number}
                    className={clsx(
                      "h-1 flex-1 rounded-full",
                      item.number <= step
                        ? "bg-[var(--lr-accent)]"
                        : "bg-[var(--lr-raised)]",
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-7">
              <div className="mx-auto max-w-[800px]">
                {error ? (
                  <p
                    role="alert"
                    className="mb-5 rounded-[var(--lr-radius-control)] border border-[var(--lr-danger)] bg-[var(--lr-danger-soft)] p-3 text-[length:var(--lr-text-body)] text-[var(--lr-danger)]"
                  >
                    {error}
                  </p>
                ) : null}

                <div className="mb-7">
                  <p className="text-[length:var(--lr-text-meta)] font-bold uppercase tracking-[.12em] text-[var(--lr-accent)]">
                    Passaggio {step}
                  </p>
                  <h3 className="mt-1 text-[length:var(--lr-text-section)] font-semibold text-[var(--lr-ink)]">
                    {currentStep.title}
                  </h3>
                </div>

                {step === 1 ? (
                  <div>
                    <Question
                      title="Chi sta cercando casa?"
                      help="Nome e recapito aiutano a riconoscere subito la richiesta. Puoi completarli anche dopo."
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="grid gap-1.5 text-[length:var(--lr-text-meta)] font-semibold text-[var(--lr-ink-2)] sm:col-span-2">
                          Nome e cognome
                          <input
                            type="text"
                            value={draft.clientName}
                            onChange={(event) => set("clientName", event.target.value)}
                            placeholder="Per esempio: Franco Abbondanza"
                            className="h-11 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-raised)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none placeholder:text-[var(--lr-ink-3)] focus:border-[var(--lr-accent)]"
                          />
                        </label>
                        <label className="grid gap-1.5 text-[length:var(--lr-text-meta)] font-semibold text-[var(--lr-ink-2)]">
                          Telefono
                          <input
                            type="tel"
                            value={draft.clientPhone}
                            onChange={(event) => set("clientPhone", event.target.value)}
                            placeholder="Cellulare o fisso"
                            className="h-11 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-raised)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none placeholder:text-[var(--lr-ink-3)] focus:border-[var(--lr-accent)]"
                          />
                        </label>
                        <label className="grid gap-1.5 text-[length:var(--lr-text-meta)] font-semibold text-[var(--lr-ink-2)]">
                          Email
                          <input
                            type="email"
                            value={draft.clientEmail}
                            onChange={(event) => set("clientEmail", event.target.value)}
                            placeholder="Facoltativa"
                            className="h-11 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-raised)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none placeholder:text-[var(--lr-ink-3)] focus:border-[var(--lr-accent)]"
                          />
                        </label>
                      </div>
                    </Question>

                    <Question title="Vuole comprare o prendere in affitto?">
                      <div className="grid grid-cols-2 gap-3">
                        <ChoiceButton
                          selected={draft.contract_type === "sale"}
                          onClick={() => set("contract_type", "sale")}
                        >
                          Comprare
                        </ChoiceButton>
                        <ChoiceButton
                          selected={draft.contract_type === "rent"}
                          onClick={() => set("contract_type", "rent")}
                        >
                          Prendere in affitto
                        </ChoiceButton>
                      </div>
                    </Question>

                    <Question
                      title="Che tipo di immobile cerca?"
                      help="Puoi scegliere più di una risposta."
                    >
                      <div className="flex flex-wrap gap-2">
                        {quickPropertyTypes.map(([value, label]) => (
                          <ChoiceButton
                            key={value}
                            compact
                            selected={draft.property_types.includes(value)}
                            onClick={() => toggle("property_types", value)}
                          >
                            {label}
                          </ChoiceButton>
                        ))}
                      </div>
                    </Question>

                    <details className="rounded-[var(--lr-radius-control)] border border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] px-4">
                      <summary className="min-h-12 cursor-pointer py-3 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink-2)]">
                        Aggiungi informazioni facoltative
                      </summary>
                    <Question
                      title="Per quale motivo cerca l’immobile?"
                      help="È la destinazione usata nelle richieste del gestionale."
                    >
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["first_home", "Prima casa"],
                          ["investment", "Investimento"],
                          ["exchange", "Permuta"],
                          ["temporary", "Esigenza temporanea"],
                          ["other", "Altro"],
                        ].map(([value, label]) => (
                          <ChoiceButton
                            key={value}
                            compact
                            selected={draft.destination === value}
                            onClick={() => set("destination", value as Draft["destination"])}
                          >
                            {label}
                          </ChoiceButton>
                        ))}
                      </div>
                    </Question>

                    {draft.contract_type === "sale" ? (
                      <Question
                        title="Come pensa di acquistare?"
                        help="La modalità economica resta separata dal budget."
                      >
                        <div className="flex flex-wrap gap-2">
                          {[
                            ["cash", "Contanti"],
                            ["cash_and_mortgage", "Contanti + mutuo"],
                            ["full_mortgage", "Mutuo 100%"],
                            ["exchange", "Permuta"],
                            ["other", "Da definire"],
                          ].map(([value, label]) => (
                            <ChoiceButton
                              key={value}
                              compact
                              selected={draft.financingMethod === value}
                              onClick={() => set("financingMethod", value as Draft["financingMethod"])}
                            >
                              {label}
                            </ChoiceButton>
                          ))}
                        </div>
                      </Question>
                    ) : null}
                    </details>

                    <Question
                      title="In quali zone?"
                      help="Se non ha preferenze, lascia tutto vuoto."
                    >
                      {zones.length ? (
                        <div className="flex flex-wrap gap-2">
                          {zones.map((zone) => (
                            <ChoiceButton
                              key={zone.id}
                              compact
                              selected={draft.zones.includes(zone.id)}
                              onClick={() => toggle("zones", zone.id)}
                            >
                              {zone.name}
                            </ChoiceButton>
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)] p-4 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
                          Non hai ancora configurato le zone. Puoi continuare:
                          le aggiungerai alla richiesta in seguito.
                        </p>
                      )}
                    </Question>
                  </div>
                ) : null}

                {step === 2 ? (
                  <div>
                    <Question
                      title={
                        draft.contract_type === "sale"
                          ? "Qual è il budget massimo?"
                          : "Qual è il canone mensile massimo?"
                      }
                      help="Scegli una cifra oppure inseriscila manualmente."
                    >
                      <div className="flex flex-wrap gap-2">
                        {budgets.map((value) => (
                          <ChoiceButton
                            key={value}
                            compact
                            selected={
                              !customBudget &&
                              draft.maximum === String(value)
                            }
                            onClick={() => chooseBudget(value)}
                          >
                            € {value.toLocaleString("it-IT")}
                            {value === budgets.at(-1) ? "+" : ""}
                          </ChoiceButton>
                        ))}
                        <ChoiceButton
                          compact
                          selected={customBudget}
                          onClick={() => setCustomBudget(true)}
                        >
                          Scrivi la cifra
                        </ChoiceButton>
                      </div>
                      {customBudget ? (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <label className="grid gap-1.5 text-[length:var(--lr-text-meta)] font-semibold text-[var(--lr-ink-2)]">
                            Cifra ideale
                            <input
                              autoFocus
                              type="number"
                              min="0"
                              value={draft.ideal}
                              onChange={(event) =>
                                set("ideal", event.target.value)
                              }
                              className="h-11 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-raised)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none focus:border-[var(--lr-accent)]"
                            />
                          </label>
                          <label className="grid gap-1.5 text-[length:var(--lr-text-meta)] font-semibold text-[var(--lr-ink-2)]">
                            Massimo da non superare
                            <input
                              type="number"
                              min="0"
                              value={draft.maximum}
                              onChange={(event) =>
                                set("maximum", event.target.value)
                              }
                              className="h-11 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-raised)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none focus:border-[var(--lr-accent)]"
                            />
                          </label>
                        </div>
                      ) : null}
                    </Question>

                    <Question
                      title="Quanto deve essere grande?"
                      help="Parliamo di metri quadrati interni."
                    >
                      <div className="flex flex-wrap gap-2">
                        {[
                          [50, 70, "50–70 mq"],
                          [70, 90, "70–90 mq"],
                          [90, 110, "90–110 mq"],
                          [110, 130, "110–130 mq"],
                          [130, null, "Più di 130 mq"],
                        ].map(([minimum, maximum, label]) => (
                          <ChoiceButton
                            key={String(label)}
                            compact
                            selected={
                              !customSqm &&
                              draft.sqmMin === String(minimum) &&
                              draft.sqmMax ===
                                (maximum == null ? "" : String(maximum))
                            }
                            onClick={() =>
                              chooseSqm(
                                Number(minimum),
                                maximum == null ? null : Number(maximum),
                              )
                            }
                          >
                            {label}
                          </ChoiceButton>
                        ))}
                        <ChoiceButton
                          compact
                          selected={customSqm}
                          onClick={() => setCustomSqm(true)}
                        >
                          Misura personalizzata
                        </ChoiceButton>
                      </div>
                      {customSqm ? (
                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <label className="grid gap-1.5 text-[length:var(--lr-text-meta)] font-semibold text-[var(--lr-ink-2)]">
                            Da mq
                            <input
                              type="number"
                              min="0"
                              value={draft.sqmMin}
                              onChange={(event) =>
                                set("sqmMin", event.target.value)
                              }
                              className="h-11 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-raised)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)]"
                            />
                          </label>
                          <label className="grid gap-1.5 text-[length:var(--lr-text-meta)] font-semibold text-[var(--lr-ink-2)]">
                            A mq
                            <input
                              type="number"
                              min="0"
                              value={draft.sqmMax}
                              onChange={(event) =>
                                set("sqmMax", event.target.value)
                              }
                              className="h-11 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-raised)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)]"
                            />
                          </label>
                        </div>
                      ) : null}
                    </Question>

                    <Question
                      title="Quanti vani servono almeno?"
                      help="Se non è importante, scegli “Non importa”."
                    >
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["", "Non importa"],
                          ["1", "1 vano"],
                          ["2", "2 vani"],
                          ["3", "3 vani"],
                          ["4", "4 vani"],
                          ["5", "5 o più"],
                        ].map(([value, label]) => (
                          <ChoiceButton
                            key={label}
                            compact
                            selected={draft.rooms === value}
                            onClick={() => set("rooms", value)}
                          >
                            {label}
                          </ChoiceButton>
                        ))}
                      </div>
                    </Question>

                    <Question title="Camere e bagni minimi">
                      <div className="grid gap-5 sm:grid-cols-2">
                        <SimpleNumberChoice
                          label="Camere"
                          value={draft.bedrooms}
                          onChange={(value) => set("bedrooms", value)}
                        />
                        <SimpleNumberChoice
                          label="Bagni"
                          value={draft.bathrooms}
                          onChange={(value) => set("bathrooms", value)}
                        />
                      </div>
                    </Question>
                  </div>
                ) : null}

                {step === 3 ? (
                  <div>
                    <p className="mb-4 text-[length:var(--lr-text-body)] leading-6 text-[var(--lr-ink-2)]">
                      Per ogni caratteristica scegli quanto conta. Se non ne
                      avete parlato, lascia “Non importa”.
                    </p>
                    <div>
                      {visibleFeatures.map((feature) => (
                        <FeatureChoice
                          key={feature.id}
                          feature={feature}
                          value={
                            draft.featurePreferences[feature.id] ??
                            "indifferent"
                          }
                          onChange={(value) =>
                            setDraft((current) => ({
                              ...current,
                              featurePreferences: {
                                ...current.featurePreferences,
                                [feature.id]: value,
                              },
                            }))
                          }
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAllFeatures((value) => !value)}
                      className="mt-5 min-h-11 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] px-4 text-[length:var(--lr-text-body)] font-bold text-[var(--lr-ink)]"
                    >
                      {showAllFeatures
                        ? "Mostra solo le caratteristiche principali"
                        : "Mostra altre caratteristiche"}
                    </button>
                  </div>
                ) : null}

                {step === 4 ? (
                  <div>
                    <Question
                      title="Quale fascia di piano preferisce?"
                      help="Scegli l’opzione più vicina alla richiesta."
                    >
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["any", "Qualsiasi"],
                          ["low", "Basso, dal terra al 2°"],
                          ["medium", "Medio, 3° o 4°"],
                          ["high", "Alto, dal 5°"],
                          ["top", "Ultimo piano"],
                        ].map(([value, label]) => (
                          <ChoiceButton
                            key={label}
                            compact
                            selected={draft.floorBand === value}
                            onClick={() => chooseFloorBand(value as Draft["floorBand"])}
                          >
                            {label}
                          </ChoiceButton>
                        ))}
                      </div>
                    </Question>

                    <Question
                      title="In quali condizioni può essere?"
                      help="Puoi scegliere più risposte oppure lasciare vuoto."
                    >
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["new", "Nuovo"],
                          ["renovated", "Ristrutturato"],
                          ["normal", "Normale"],
                          ["to_renovate", "Da ristrutturare"],
                          ["poor", "Scarso"],
                        ].map(([value, label]) => (
                          <ChoiceButton
                            key={value}
                            compact
                            selected={draft.conditions.includes(value)}
                            onClick={() => toggle("conditions", value)}
                          >
                            {label}
                          </ChoiceButton>
                        ))}
                      </div>
                    </Question>

                    <Question
                      title="A che punto è la verifica economica?"
                      help="Se non ne avete ancora parlato, lascia “Da verificare”."
                    >
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["unknown", "Da verificare"],
                          ["in_progress", "Verifica in corso"],
                          ["positive", "Merito positivo"],
                          ["negative", "Criticità rilevate"],
                        ].map(([value, label]) => (
                          <ChoiceButton
                            key={value}
                            compact
                            selected={draft.creditStatus === value}
                            onClick={() => set("creditStatus", value as Draft["creditStatus"])}
                          >
                            {label}
                          </ChoiceButton>
                        ))}
                      </div>
                    </Question>

                    <Question title="La richiesta arriva da un tuo annuncio?">
                      <div className="grid grid-cols-2 gap-2">
                        <ChoiceButton
                          selected={!draft.fromOwnListing}
                          onClick={() => set("fromOwnListing", false)}
                        >
                          No
                        </ChoiceButton>
                        <ChoiceButton
                          selected={draft.fromOwnListing}
                          onClick={() => set("fromOwnListing", true)}
                        >
                          Sì
                        </ChoiceButton>
                      </div>
                    </Question>

                    <Question title="Quanto è urgente?">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[
                          ["low", "Senza fretta"],
                          ["normal", "Normale"],
                          ["high", "Importante"],
                          ["urgent", "Urgente"],
                        ].map(([value, label]) => (
                          <ChoiceButton
                            key={value}
                            compact
                            selected={draft.priority === value}
                            onClick={() =>
                              set(
                                "priority",
                                value as Draft["priority"],
                              )
                            }
                          >
                            {label}
                          </ChoiceButton>
                        ))}
                      </div>
                    </Question>

                    <Question
                      title="C’è altro da ricordare?"
                      help="Scrivi qui solo ciò che non hai già indicato."
                    >
                      <textarea
                        rows={4}
                        value={draft.notes}
                        onChange={(event) => set("notes", event.target.value)}
                        placeholder="Per esempio: deve essere vicino ai genitori, niente strade rumorose…"
                        className="w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-raised)] p-3 text-[length:var(--lr-text-body)] leading-6 text-[var(--lr-ink)] outline-none placeholder:text-[var(--lr-ink-3)] focus:border-[var(--lr-accent)]"
                      />
                    </Question>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-col-reverse gap-3 border-t border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((value) => value - 1)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] px-4 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink-2)] disabled:opacity-30"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Indietro
          </button>

          {step === 2 ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                disabled={isPending}
                onClick={() => save("draft", false)}
                className="min-h-11 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] px-4 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink-2)]"
              >
                Salva e completa dopo
              </button>
              <button
                type="button"
                disabled={isPending || draft.property_types.length === 0}
                onClick={() => save("active", true)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--lr-radius-control)] bg-[var(--lr-accent)] px-5 text-[length:var(--lr-text-body)] font-bold text-[var(--lr-accent-ink)] disabled:opacity-50"
              >
                <Check aria-hidden="true" className="size-4" />
                {isPending ? "Salvataggio…" : "Salva e cerca immobili"}
              </button>
            </div>
          ) : step < 2 ? (
            <button
              type="button"
              disabled={draft.property_types.length === 0}
              onClick={() => setStep((value) => value + 1)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--lr-radius-control)] bg-[var(--lr-accent)] px-5 text-[length:var(--lr-text-body)] font-bold text-[var(--lr-accent-ink)] disabled:opacity-40"
            >
              Continua
              <ArrowRight aria-hidden="true" className="size-4" />
            </button>
          ) : (
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                disabled={isPending}
                onClick={() => save("draft", false)}
                className="min-h-11 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] px-4 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink-2)]"
              >
                Salva e completa dopo
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => save("active", true)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--lr-radius-control)] bg-[var(--lr-accent)] px-5 text-[length:var(--lr-text-body)] font-bold text-[var(--lr-accent-ink)] disabled:opacity-50"
              >
                <Check aria-hidden="true" className="size-4" />
                {isPending ? "Salvataggio…" : "Salva e cerca immobili"}
              </button>
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}

function SimpleNumberChoice({
  label,
  value,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
}>) {
  return (
    <div>
      <p className="mb-2 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink-2)]">{label}</p>
      <div className="grid grid-cols-4 gap-2">
        {[
          ["", "Qualsiasi"],
          ["1", "1+"],
          ["2", "2+"],
          ["3", "3+"],
        ].map(([optionValue, optionLabel]) => (
          <ChoiceButton
            key={optionLabel}
            compact
            selected={value === optionValue}
            onClick={() => onChange(optionValue)}
          >
            {optionLabel}
          </ChoiceButton>
        ))}
      </div>
    </div>
  );
}
