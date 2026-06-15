(function registerCasaParser() {
  const generic = globalThis.ListingRadarGenericParser;
  const utils = globalThis.ListingRadarPortalAdapterUtils;

  globalThis.ListingRadarPortalAdapters.casa = {
    extract() {
      const pageText = utils.pageText();
      const details = utils.joinedText([
        "[data-testid='features']",
        ".detail-features",
        ".feature-list",
        ".features",
      ]) || utils.sectionText(
        [/^Caratteristiche$/i],
        [/^(Stato e efficienza energetica|Costi e disponibilità|Posizione e servizi)$/i],
      );
      const description = utils.cleanDescription(
        utils.firstText([
          "[data-testid='description']",
          ".detail-description",
          ".property-description",
          ".description",
        ]) ||
          utils.sectionText(
            [/^(Italiano|English)$/i],
            [/^(Leggi tutto|Aggiungi nota privata|Caratteristiche)$/i],
          ),
      );
      const sellerName = utils.firstText([
        "[data-testid='agency-name']",
        ".agency-name",
        ".advertiser-name",
        ".detail-agency-name",
      ]) || utils.firstMatch(description, [
        /(?:Contattate|Contatta)\s+(?:l'agenzia\s+)?([^.,]+?)\s+per/i,
        /^([^.,]+?Immobiliare[^.,]*?)\s+propone/i,
        /^([^.,]+?Tecnocasa[^.,]*?)\s+propone/i,
      ]);
      const sellerContext = utils.firstText([
        "[data-testid='agency-card']",
        ".detail-agency",
        ".advertiser-card",
      ]) || `${sellerName || ""} ${description}`;
      const addressRaw = utils.firstText([
        "[data-testid='address']",
        ".detail-location",
        ".property-location",
        ".location",
      ]) || utils.sectionText(
        [/^Posizione e servizi$/i],
        [/^(Vicino a|Servizi|Strumenti aggiuntivi)$/i],
      );
      const extracted = {
        title: utils.firstText([
          "[data-testid='listing-title']",
          ".detail-title",
          ".property-title",
          "h1",
        ]),
        description,
        price: generic.parsePrice(
          utils.firstText([
            "[data-testid='price']",
            ".detail-price",
            ".property-price",
            ".price",
          ]) ||
            utils.fieldValue(["Prezzo"]) ||
            pageText,
        ) || utils.textPrice(),
        sqm: generic.parseSqm(utils.fieldValue(["Superficie"]) || details),
        rooms: generic.parseRooms(utils.fieldValue(["Locali"]) || details),
        floor: utils.fieldValue(["Piano"]) || utils.parseFloor(details),
        zone: addressRaw,
        addressRaw,
        sellerName,
        sellerType: utils.sellerTypeFrom(sellerName, sellerContext),
        phone: generic.visiblePhone(),
        portalDeclaredDate:
          utils.dateText([
            "[data-testid='listing-date']",
            ".detail-date",
            ".publication-date",
          ]) ||
          utils.firstLineMatch([
            /Data ultimo aggiornamento\s+(.+)$/i,
            /Pubblicato\s+(.+)$/i,
          ]),
      };

      return {
        ...extracted,
        rawPayload: {
          portalAdapter: "casa",
          adapterVersion: "2",
          extractedFields: utils.fieldNames(extracted),
        },
      };
    },
  };
})();
