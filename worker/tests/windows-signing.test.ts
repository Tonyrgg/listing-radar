import { describe, expect, it } from "vitest";

import {
  AZURE_DEFAULT_TIMESTAMP_URL,
  SIGNTOOL_DEFAULT_TIMESTAMP_URL,
  SigningConfigurationError,
  describeSigningPlan,
  mergeSigningIntoBuildConfig,
  parseSigningMode,
  resolveWindowsSigningPlan,
} from "../scripts/windows-signing.js";

const azureEnvironment = {
  WORKER_SIGNING_MODE: "azure-trusted-signing",
  WORKER_SIGNING_PUBLISHER: "CN=Esempio Non Reale",
  WORKER_SIGNING_ENDPOINT: "https://weu.codesigning.azure.net",
  WORKER_SIGNING_ACCOUNT: "account-di-esempio",
  WORKER_SIGNING_CERT_PROFILE: "profilo-di-esempio",
  AZURE_TENANT_ID: "tenant-placeholder",
  AZURE_CLIENT_ID: "client-placeholder",
  AZURE_CLIENT_SECRET: "segreto-placeholder",
};

const signtoolEnvironment = {
  WORKER_SIGNING_MODE: "signtool-pfx",
  WORKER_SIGNING_PUBLISHER: "CN=Esempio Non Reale",
  WIN_CSC_LINK: "base64-placeholder",
  WIN_CSC_KEY_PASSWORD: "password-placeholder",
};

describe("parseSigningMode", () => {
  it("usa unsigned quando la variabile non e' impostata", () => {
    expect(parseSigningMode(undefined)).toBe("unsigned");
  });

  it("rifiuta una modalita' sconosciuta invece di ripiegare su unsigned", () => {
    expect(() => parseSigningMode("firma-a-caso")).toThrow(SigningConfigurationError);
  });
});

describe("resolveWindowsSigningPlan in modalita' unsigned", () => {
  it("non produce alcuna configurazione di firma", () => {
    const plan = resolveWindowsSigningPlan({});
    expect(plan.mode).toBe("unsigned");
    expect(plan.windowsOverlay).toEqual({});
    expect(plan.publisherName).toBeNull();
    expect(plan.requiresWindowsHost).toBe(false);
  });

  it("fallisce se la firma e' dichiarata obbligatoria", () => {
    expect(() => resolveWindowsSigningPlan({ WORKER_SIGNING_REQUIRED: "true" })).toThrow(
      /non puo' procedere/,
    );
  });
});

describe("resolveWindowsSigningPlan con Azure Trusted Signing", () => {
  it("produce le chiavi attese da electron-builder 26", () => {
    const plan = resolveWindowsSigningPlan(azureEnvironment);
    expect(plan.mode).toBe("azure-trusted-signing");
    expect(plan.requiresWindowsHost).toBe(true);
    expect(plan.windowsOverlay.forceCodeSigning).toBe(true);
    expect(plan.windowsOverlay.signtoolOptions).toBeUndefined();
    expect(plan.windowsOverlay.azureSignOptions).toEqual({
      publisherName: "CN=Esempio Non Reale",
      endpoint: "https://weu.codesigning.azure.net/",
      codeSigningAccountName: "account-di-esempio",
      certificateProfileName: "profilo-di-esempio",
      fileDigest: "SHA256",
      timestampRfc3161: AZURE_DEFAULT_TIMESTAMP_URL,
      timestampDigest: "SHA256",
    });
  });

  it("firma anche DLL e moduli nativi, che il default di electron-builder ignora", () => {
    expect(resolveWindowsSigningPlan(azureEnvironment).windowsOverlay.signExts).toEqual([".dll", ".node"]);
  });

  it("fallisce quando manca una credenziale, senza mai stamparne il valore", () => {
    const { AZURE_CLIENT_SECRET: _omesso, ...incompleto } = azureEnvironment;
    expect(() => resolveWindowsSigningPlan(incompleto)).toThrow(/AZURE_CLIENT_SECRET/);
    expect(() => resolveWindowsSigningPlan(incompleto)).toThrow(SigningConfigurationError);
  });

  it("fallisce quando manca il publisher atteso", () => {
    const { WORKER_SIGNING_PUBLISHER: _omesso, ...incompleto } = azureEnvironment;
    expect(() => resolveWindowsSigningPlan(incompleto)).toThrow(/WORKER_SIGNING_PUBLISHER/);
  });

  it("rifiuta un endpoint non https", () => {
    expect(() =>
      resolveWindowsSigningPlan({ ...azureEnvironment, WORKER_SIGNING_ENDPOINT: "http://weu.codesigning.azure.net" }),
    ).toThrow(/deve usare https/);
  });

  it("permette di sostituire il timestamp server", () => {
    const plan = resolveWindowsSigningPlan({
      ...azureEnvironment,
      WORKER_SIGNING_TIMESTAMP_URL: "http://timestamp.example.invalid",
    });
    expect(plan.timestampServer).toBe("http://timestamp.example.invalid");
    expect(plan.windowsOverlay.azureSignOptions?.timestampRfc3161).toBe("http://timestamp.example.invalid");
  });
});

describe("resolveWindowsSigningPlan con certificato pfx", () => {
  it("usa signtoolOptions e non la vecchia forma piatta", () => {
    const plan = resolveWindowsSigningPlan(signtoolEnvironment);
    expect(plan.windowsOverlay.azureSignOptions).toBeUndefined();
    expect(plan.windowsOverlay.signtoolOptions).toEqual({
      publisherName: "CN=Esempio Non Reale",
      signingHashAlgorithms: ["sha256"],
      rfc3161TimeStampServer: SIGNTOOL_DEFAULT_TIMESTAMP_URL,
    });
  });

  it("fallisce senza il certificato in ambiente", () => {
    const { WIN_CSC_LINK: _omesso, ...incompleto } = signtoolEnvironment;
    expect(() => resolveWindowsSigningPlan(incompleto)).toThrow(/WIN_CSC_LINK/);
  });
});

describe("mergeSigningIntoBuildConfig", () => {
  const buildConfig = {
    appId: "it.listingradar.propertyworker",
    productName: "Property Data Worker",
    win: { icon: "assets/icon.ico", target: ["nsis"], legalTrademarks: "Listing Radar" },
    nsis: { oneClick: false },
  };

  it("conserva la configurazione esistente e aggiunge solo la firma", () => {
    const plan = resolveWindowsSigningPlan(azureEnvironment);
    const merged = mergeSigningIntoBuildConfig(buildConfig, plan) as Record<string, any>;
    expect(merged.appId).toBe("it.listingradar.propertyworker");
    expect(merged.nsis).toEqual({ oneClick: false });
    expect(merged.win.icon).toBe("assets/icon.ico");
    expect(merged.win.target).toEqual(["nsis"]);
    expect(merged.win.legalTrademarks).toBe("Listing Radar");
    expect(merged.win.azureSignOptions.publisherName).toBe("CN=Esempio Non Reale");
    expect(merged.win.forceCodeSigning).toBe(true);
  });

  it("azzera extends per non far ereditare preset a electron-builder", () => {
    const merged = mergeSigningIntoBuildConfig(buildConfig, resolveWindowsSigningPlan(azureEnvironment));
    expect(merged.extends).toBeNull();
  });

  it("non muta la configurazione di partenza", () => {
    const originale = JSON.parse(JSON.stringify(buildConfig));
    mergeSigningIntoBuildConfig(buildConfig, resolveWindowsSigningPlan(azureEnvironment));
    expect(buildConfig).toEqual(originale);
  });
});

describe("describeSigningPlan", () => {
  it("elenca i nomi delle credenziali senza esporne i valori", () => {
    const riepilogo = describeSigningPlan(resolveWindowsSigningPlan(azureEnvironment));
    expect(riepilogo).toContain("AZURE_CLIENT_SECRET");
    expect(riepilogo).not.toContain("segreto-placeholder");
    expect(riepilogo).not.toContain("client-placeholder");
  });

  it("dichiara esplicitamente quando non verra' applicata alcuna firma", () => {
    expect(describeSigningPlan(resolveWindowsSigningPlan({}))).toContain("unsigned");
  });
});
