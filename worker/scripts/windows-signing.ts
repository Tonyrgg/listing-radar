/**
 * Traduce l'ambiente nella configurazione di firma di electron-builder.
 *
 * I nomi delle opzioni sono quelli della versione installata (electron-builder
 * 26.15.3): dalla 26 le opzioni signtool vivono sotto `win.signtoolOptions` e
 * la firma Azure sotto `win.azureSignOptions`. Le vecchie chiavi piatte
 * `win.certificateFile` / `win.publisherName` non esistono piu' e lo schema di
 * configurazione ha `additionalProperties: false`, quindi usarle non produce
 * una firma mancante silenziosa ma un errore di configurazione.
 *
 * Nessun segreto viene letto, stampato o scritto da questo modulo: legge solo
 * i valori non sensibili e verifica la *presenza* delle variabili di
 * credenziale, mai il loro contenuto.
 */

export type SigningMode = "azure-trusted-signing" | "signtool-pfx" | "unsigned";

/** Timestamp di default del servizio Azure Trusted Signing. */
export const AZURE_DEFAULT_TIMESTAMP_URL = "http://timestamp.acs.microsoft.com";
/** Timestamp RFC 3161 di default di electron-builder per signtool. */
export const SIGNTOOL_DEFAULT_TIMESTAMP_URL = "http://timestamp.digicert.com";

/**
 * Variabili che contengono un segreto: ne verifichiamo soltanto la presenza e
 * non vanno mai stampate, nemmeno troncate.
 */
const AZURE_CREDENTIAL_VARIABLES = ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"] as const;
const SIGNTOOL_CREDENTIAL_VARIABLES = ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"] as const;

export class SigningConfigurationError extends Error {}

export interface WindowsSigningOverlay {
  forceCodeSigning?: boolean;
  signExts?: string[];
  azureSignOptions?: Record<string, string>;
  signtoolOptions?: Record<string, unknown>;
}

export interface SigningPlan {
  mode: SigningMode;
  /** Subject atteso nella firma; `null` solo in modalita' unsigned. */
  publisherName: string | null;
  timestampServer: string | null;
  /** Frammento da fondere in `build.win`. */
  windowsOverlay: WindowsSigningOverlay;
  /** Nomi (mai valori) delle variabili di credenziale richieste dalla modalita'. */
  credentialVariables: readonly string[];
  /** Richiede un runner Windows: signtool e il modulo TrustedSigning sono Windows-only. */
  requiresWindowsHost: boolean;
}

type Environment = Record<string, string | undefined>;

function readValue(environment: Environment, name: string) {
  const value = environment[name];
  return value === undefined ? undefined : value.trim();
}

function requireValue(environment: Environment, name: string, mode: SigningMode) {
  const value = readValue(environment, name);
  if (!value) {
    throw new SigningConfigurationError(
      `Firma ${mode}: manca la variabile ${name}. Configurala come secret del repository, non nel codice.`,
    );
  }
  return value;
}

function requireCredentials(environment: Environment, names: readonly string[], mode: SigningMode) {
  const missing = names.filter((name) => !readValue(environment, name));
  if (missing.length > 0) {
    throw new SigningConfigurationError(
      `Firma ${mode}: credenziali assenti (${missing.join(", ")}). Vanno fornite come secret, mai committate.`,
    );
  }
}

function requireHttpsEndpoint(value: string, name: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SigningConfigurationError(`${name} non e' un URL valido.`);
  }
  if (parsed.protocol !== "https:") {
    throw new SigningConfigurationError(`${name} deve usare https, trovato ${parsed.protocol}`);
  }
  return parsed.toString();
}

export function parseSigningMode(raw: string | undefined): SigningMode {
  const value = (raw ?? "unsigned").trim().toLowerCase();
  if (value === "azure-trusted-signing" || value === "signtool-pfx" || value === "unsigned") return value;
  throw new SigningConfigurationError(
    `WORKER_SIGNING_MODE non riconosciuto: "${raw}". Valori ammessi: azure-trusted-signing, signtool-pfx, unsigned.`,
  );
}

/**
 * Risolve la modalita' di firma dall'ambiente.
 *
 * `WORKER_SIGNING_REQUIRED=true` rende la modalita' unsigned un errore: e' il
 * comando che la pipeline usa per non pubblicare mai per sbaglio un installer
 * non firmato quando i secret non sono stati montati.
 */
export function resolveWindowsSigningPlan(environment: Environment): SigningPlan {
  const mode = parseSigningMode(environment.WORKER_SIGNING_MODE);
  const signingRequired = readValue(environment, "WORKER_SIGNING_REQUIRED") === "true";

  if (mode === "unsigned") {
    if (signingRequired) {
      throw new SigningConfigurationError(
        "WORKER_SIGNING_REQUIRED=true ma WORKER_SIGNING_MODE e' unsigned: la build firmata non puo' procedere.",
      );
    }
    return {
      mode,
      publisherName: null,
      timestampServer: null,
      windowsOverlay: {},
      credentialVariables: [],
      requiresWindowsHost: false,
    };
  }

  const publisherName = requireValue(environment, "WORKER_SIGNING_PUBLISHER", mode);
  // Le DLL native (Playwright, moduli Electron) non sono firmate dal default di
  // electron-builder, che si limita ai .exe: le includiamo esplicitamente.
  const signExts = [".dll", ".node"];

  if (mode === "azure-trusted-signing") {
    requireCredentials(environment, AZURE_CREDENTIAL_VARIABLES, mode);
    const endpoint = requireHttpsEndpoint(
      requireValue(environment, "WORKER_SIGNING_ENDPOINT", mode),
      "WORKER_SIGNING_ENDPOINT",
    );
    const timestampServer = readValue(environment, "WORKER_SIGNING_TIMESTAMP_URL") || AZURE_DEFAULT_TIMESTAMP_URL;
    return {
      mode,
      publisherName,
      timestampServer,
      windowsOverlay: {
        forceCodeSigning: true,
        signExts,
        azureSignOptions: {
          publisherName,
          endpoint,
          codeSigningAccountName: requireValue(environment, "WORKER_SIGNING_ACCOUNT", mode),
          certificateProfileName: requireValue(environment, "WORKER_SIGNING_CERT_PROFILE", mode),
          fileDigest: "SHA256",
          timestampRfc3161: timestampServer,
          timestampDigest: "SHA256",
        },
      },
      credentialVariables: AZURE_CREDENTIAL_VARIABLES,
      requiresWindowsHost: true,
    };
  }

  requireCredentials(environment, SIGNTOOL_CREDENTIAL_VARIABLES, mode);
  const timestampServer = readValue(environment, "WORKER_SIGNING_TIMESTAMP_URL") || SIGNTOOL_DEFAULT_TIMESTAMP_URL;
  return {
    mode,
    publisherName,
    timestampServer,
    windowsOverlay: {
      forceCodeSigning: true,
      signExts,
      signtoolOptions: {
        publisherName,
        // Un certificato emesso oggi non produce una firma sha1 accettabile:
        // niente dual signing, solo sha256.
        signingHashAlgorithms: ["sha256"],
        rfc3161TimeStampServer: timestampServer,
      },
    },
    credentialVariables: SIGNTOOL_CREDENTIAL_VARIABLES,
    requiresWindowsHost: true,
  };
}

/**
 * Fonde il piano di firma nella configurazione `build` letta da package.json.
 *
 * `extends: null` impedisce a electron-builder di applicare i preset che
 * altrimenti cercherebbe quando la configurazione arriva da un file esterno.
 */
export function mergeSigningIntoBuildConfig(
  buildConfig: Record<string, unknown>,
  plan: SigningPlan,
): Record<string, unknown> {
  const windows = (buildConfig.win ?? {}) as Record<string, unknown>;
  return {
    ...buildConfig,
    extends: null,
    win: { ...windows, ...plan.windowsOverlay },
  };
}

/** Riepilogo stampabile: contiene solo nomi di variabili, mai i loro valori. */
export function describeSigningPlan(plan: SigningPlan): string {
  if (plan.mode === "unsigned") return "Modalita' firma: unsigned (nessuna firma verra' applicata).";
  const lines = [
    `Modalita' firma: ${plan.mode}`,
    `Publisher atteso: ${plan.publisherName}`,
    `Timestamp: ${plan.timestampServer}`,
    `Estensioni firmate oltre a .exe: ${(plan.windowsOverlay.signExts ?? []).join(", ") || "nessuna"}`,
    `Credenziali richieste (presenti): ${plan.credentialVariables.join(", ")}`,
  ];
  return lines.join("\n");
}
