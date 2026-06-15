(function registerSubitoParser() {
  const generic = globalThis.ListingRadarGenericParser;
  const utils = globalThis.ListingRadarPortalAdapterUtils;

  globalThis.ListingRadarPortalAdapters.subito = {
    extract() {
      const pageText = utils.pageText();
      const details = utils.joinedText([
        "[data-testid='ad-properties']",
        "[data-testid='features']",
        ".feature-list",
        ".main-features",
      ]) || utils.sectionText(
        [/^(Caratteristiche|Dettagli)$/i],
        [/^(Descrizione|Venditore|Inserzionista|Località)$/i],
      );
      const description = utils.cleanDescription(
        utils.firstText([
          "[data-testid='ad-description']",
          "[data-testid='description']",
          ".description",
        ]) ||
          utils.sectionText(
            [/^Descrizione$/i],
            [/^(Venditore|Inserzionista|Località|Mappa|Pubblicato)$/i],
          ),
      );
      const sellerName = utils.firstText([
        "[data-testid='user-name']",
        "[data-testid='seller-name']",
        ".advertiser-name",
      ]) || utils.sellerNameFromText();
      const sellerContext = utils.firstText([
        "[data-testid='seller-card']",
        "[data-testid='user-info']",
        ".seller-info",
      ]) || pageText;
      const addressRaw = utils.firstText([
        "[data-testid='location']",
        "[data-testid='ad-location']",
        ".location",
      ]) || utils.firstMatch(pageText, [
        /(?:Comune|Località|Zona)\s*[:\-]?\s*([^#]+?\b(?:Bitonto|Bari)\b[^#]*?)(?:\s+(?:Descrizione|Venditore|Pubblicato)|$)/i,
      ]);
      const extracted = {
        title: utils.firstText([
          "[data-testid='ad-title']",
          "[data-testid='title']",
          "h1",
        ]),
        description,
        price: generic.parsePrice(
          utils.firstText([
            "[data-testid='ad-price']",
            "[data-testid='price']",
            ".price",
          ]) ||
            utils.fieldValue(["Prezzo"]) ||
            pageText,
        ) || utils.textPrice(),
        sqm:
          generic.parseSqm(utils.fieldValue(["Superficie"]) || details) ||
          generic.parseSqm(description),
        rooms: generic.parseRooms(utils.fieldValue(["Locali"]) || details),
        floor: utils.fieldValue(["Piano"]) || utils.parseFloor(details),
        zone: addressRaw,
        addressRaw,
        sellerName,
        sellerType: utils.sellerTypeFrom(sellerName, sellerContext),
        phone: generic.visiblePhone(),
        portalDeclaredDate:
          utils.dateText([
            "[data-testid='ad-date']",
            "[data-testid='publication-date']",
            ".date",
          ]) ||
          utils.firstLineMatch([
            /Pubblicato il\s+(.+)$/i,
            /Inserito il\s+(.+)$/i,
            /Aggiornato il\s+(.+)$/i,
          ]),
      };

      return {
        ...extracted,
        rawPayload: {
          portalAdapter: "subito",
          adapterVersion: "2",
          extractedFields: utils.fieldNames(extracted),
        },
      };
    },
  };
})();
