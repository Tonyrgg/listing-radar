(function initializePortalParsers() {
  const generic = globalThis.ListingRadarGenericParser;

  function sourceFromHost() {
    const host = location.hostname.toLowerCase();

    if (host.includes("idealista.")) return "idealista";
    if (host.includes("immobiliare.")) return "immobiliare";
    if (host.includes("subito.")) return "subito";
    if (host.includes("casa.")) return "casa";
    if (host.includes("wikicasa.")) return "wikicasa";
    if (host.includes("casadaprivato.")) return "casadaprivato";
    return "browser";
  }

  function idFromUrl(source, value) {
    const patterns = {
      idealista: /\/immobile\/(\d+)/i,
      immobiliare: /\/annunci\/(\d+)/i,
      subito: /-(\d+)\.htm/i,
      casa: /\/immobili\/(\d+)/i,
      wikicasa: /\/annuncio\/(\d+)/i,
      casadaprivato: /-(\d+)(?:$|[/?#])/i,
    };
    return patterns[source]?.exec(value)?.[1] || null;
  }

  function mergeListing(base, specific) {
    const merged = { ...base };

    Object.entries(specific || {}).forEach(([key, value]) => {
      if (key === "rawPayload") {
        return;
      }

      if (
        value !== null &&
        value !== undefined &&
        value !== "" &&
        (!Array.isArray(value) || value.length)
      ) {
        merged[key] = value;
      }
    });

    merged.rawPayload = {
      ...(base.rawPayload || {}),
      ...(specific?.rawPayload || {}),
    };

    return merged;
  }

  function extract() {
    const base = generic.extract();
    const source = sourceFromHost();
    const adapter = globalThis.ListingRadarPortalAdapters?.[source];
    let listing = base;

    if (adapter) {
      try {
        listing = mergeListing(base, adapter.extract(base));
      } catch (error) {
        listing.rawPayload = {
          ...(base.rawPayload || {}),
          portalAdapter: source,
          adapterError:
            error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      ...listing,
      source,
      sourceListingId: idFromUrl(source, listing.canonicalUrl),
      rawPayload: {
        ...(listing.rawPayload || {}),
        parserMode: adapter ? "portal-specific" : "generic-fallback",
        parserSource: source,
      },
    };
  }

  globalThis.ListingRadarPortalParser = { extract };
})();
