(function initializePortalParsers() {
  if (globalThis.ListingRadarPortalParser) {
    return;
  }

  const generic = globalThis.ListingRadarGenericParser;

  function text(selector) {
    return generic.clean(document.querySelector(selector)?.textContent);
  }

  function sourceFromHost() {
    const host = location.hostname.toLowerCase();

    if (host.includes("idealista.")) return "idealista";
    if (host.includes("immobiliare.")) return "immobiliare";
    if (host.includes("subito.")) return "subito";
    if (host.includes("casa.")) return "casa";
    return "browser";
  }

  function idFromUrl(source, value) {
    const patterns = {
      idealista: /\/immobile\/(\d+)/i,
      immobiliare: /\/annunci\/(\d+)/i,
      subito: /-(\d+)\.htm/i,
      casa: /\/immobili\/(\d+)/i,
    };
    return patterns[source]?.exec(value)?.[1] || null;
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      const value = text(selector);
      if (value) return value;
    }
    return "";
  }

  function extract() {
    const listing = generic.extract();
    const source = sourceFromHost();
    const visibleDetails = firstText([
      ".details-property_features",
      "[data-testid='features']",
      ".feature-list",
      ".main-features",
    ]);
    const specificTitle = firstText([
      "h1",
      "[data-testid='title']",
      ".heading__title",
    ]);
    const specificPrice = firstText([
      ".info-data-price",
      "[data-testid='price']",
      ".price",
      ".heading__price",
    ]);
    const specificDescription = firstText([
      ".comment",
      "[data-testid='description']",
      ".description",
      ".detail-description",
    ]);
    const sellerName = firstText([
      ".professional-name",
      "[data-testid='agency-name']",
      ".advertiser-name",
      ".agency-name",
    ]);

    return {
      ...listing,
      source,
      sourceListingId: idFromUrl(source, listing.canonicalUrl),
      title: specificTitle || listing.title,
      description: specificDescription || listing.description,
      price: generic.parsePrice(specificPrice) || listing.price,
      sqm: generic.parseSqm(visibleDetails) || listing.sqm,
      rooms: generic.parseRooms(visibleDetails) || listing.rooms,
      sellerType: sellerName ? "agency" : listing.sellerType,
      sellerName: sellerName || listing.sellerName,
    };
  }

  globalThis.ListingRadarPortalParser = { extract };
})();
