(function registerIdealistaParser() {
  const generic = globalThis.ListingRadarGenericParser;
  const utils = globalThis.ListingRadarPortalAdapterUtils;

  globalThis.ListingRadarPortalAdapters.idealista = {
    extract() {
      const pageText = utils.pageText();
      const details = utils.joinedText([
        ".info-features",
        ".details-property_features",
        ".details-property-feature-one",
        "[data-testid='details-features']",
      ]) || utils.sectionText(
        [/^Caratteristiche specifiche$/i],
        [/^(Informazioni sull'asta|Prezzo|Posizione|Statistiche)$/i],
      );
      const description = utils.cleanDescription(
        utils.firstText([
          ".comment",
          ".adCommentsLanguage",
          "[data-testid='description']",
        ]) ||
          utils.sectionText(
            [/^Descrizione dell.inserzionista$/i],
            [/^(Caratteristiche specifiche|Prezzo|Posizione|Statistiche)$/i],
          ),
      );
      const sellerName = utils.firstText([
        ".professional-name",
        ".advertiser-name",
        ".contact-info .name",
        "[data-testid='advertiser-name']",
      ]) || utils.sellerNameFromText();
      const sellerContext = utils.firstText([
        ".professional-info",
        ".contact-info",
        "[data-testid='advertiser-info']",
      ]) || pageText;
      const addressRaw = utils.firstText([
        ".main-info__title-minor",
        ".header-map-list",
        "[data-testid='address']",
      ]) || utils.sectionText(
        [/^Posizione$/i],
        [/^(Statistiche|Chiedi all'inserzionista|Persona che pubblica)$/i],
      );
      const floor =
        utils.parseFloor(details) ||
        utils.firstMatch(description, [
          /(?:al|sito al|posto al)\s+((?:piano\s+)?(?:terra|rialzato|seminterrato|interrato|ultimo|\d+[°º]?))(?:\s+piano)?/i,
        ]);
      const extracted = {
        title: utils.firstText([
          ".main-info__title-main",
          "[data-testid='listing-title']",
          "h1",
        ]),
        description,
        price: generic.parsePrice(
          utils.firstText([
            ".info-data-price",
            "[data-testid='price']",
            ".price",
          ]) ||
            utils.fieldValue(["Prezzo dell'immobile", "Prezzo d'asta", "Prezzo"]) ||
            pageText,
        ) || utils.textPrice(),
        sqm:
          generic.parseSqm(details) ||
          generic.parseSqm(pageText.match(/\b\d+\s*m[²2q]\b/i)?.[0]),
        rooms: generic.parseRooms(details),
        floor,
        zone: addressRaw,
        addressRaw,
        sellerName,
        sellerType: utils.sellerTypeFrom(sellerName, sellerContext),
        phone: generic.visiblePhone(),
        portalDeclaredDate:
          utils.dateText([
            ".stats-text",
            ".date-update-text",
            "[data-testid='listing-date']",
          ]) ||
          utils.firstLineMatch([
            /Annuncio aggiornato il\s+(.+)$/i,
            /Annuncio pubblicato il\s+(.+)$/i,
          ]),
      };

      return {
        ...extracted,
        rawPayload: {
          portalAdapter: "idealista",
          adapterVersion: "2",
          extractedFields: utils.fieldNames(extracted),
        },
      };
    },
  };
})();
