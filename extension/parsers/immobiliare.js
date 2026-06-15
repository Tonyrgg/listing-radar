(function registerImmobiliareParser() {
  const generic = globalThis.ListingRadarGenericParser;
  const utils = globalThis.ListingRadarPortalAdapterUtils;

  globalThis.ListingRadarPortalAdapters.immobiliare = {
    extract() {
      const pageText = utils.pageText();
      const details = utils.joinedText([
        "[data-testid='main-features']",
        "[data-testid='features']",
        ".in-detail__mainFeatures",
        ".nd-list",
        ".features",
      ]) || utils.sectionText(
        [/^Caratteristiche$/i],
        [/^(Costi|Efficienza energetica|Mappa|Planimetria|Se vuoi saperne)$/i],
      );
      const description = utils.cleanDescription(
        utils.firstText([
          "[data-testid='description']",
          "[data-cy='description']",
          ".in-readAll",
          ".in-description",
        ]) ||
          utils.sectionText(
            [/^Descrizione$/i],
            [/^(leggi tutto|Caratteristiche|Se vuoi saperne)$/i],
          ),
      );
      const sellerName = utils.firstText([
        "[data-testid='agency-name']",
        "[data-cy='agency-name']",
        ".in-re-contactInfo__title",
        ".advertiser-name",
      ]) || utils.sellerNameFromText();
      const sellerContext = utils.firstText([
        "[data-testid='agency-card']",
        "[data-cy='agency-card']",
        ".in-re-contactInfo",
      ]) || pageText;
      const addressRaw = utils.firstText([
        "[data-testid='address']",
        "[data-cy='listing-address']",
        ".in-titleBlock__content",
        ".in-location",
      ]) || utils.firstMatch(pageText, [
        /^.+?\n(.+?\bBitonto\b.*?)\n/im,
        /(Bitonto\s+Via\s+[^€#]+)/i,
      ]);
      const extracted = {
        title: utils.firstText([
          "[data-testid='listing-title']",
          "[data-cy='listing-title']",
          "h1",
        ]),
        description,
        price: generic.parsePrice(
          utils.firstText([
            "[data-testid='price']",
            "[data-cy='price']",
            ".in-price",
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
            "[data-testid='listing-date']",
            ".in-statistics",
            ".in-date",
          ]) ||
          utils.firstLineMatch([
            /Annuncio aggiornato il\s+(.+)$/i,
            /Pubblicato il\s+(.+)$/i,
          ]),
      };

      return {
        ...extracted,
        rawPayload: {
          portalAdapter: "immobiliare",
          adapterVersion: "2",
          extractedFields: utils.fieldNames(extracted),
        },
      };
    },
  };
})();
