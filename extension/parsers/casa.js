(function registerCasaParser() {
  const generic = globalThis.ListingRadarGenericParser;
  const utils = globalThis.ListingRadarPortalAdapterUtils;

  globalThis.ListingRadarPortalAdapters.casa = {
    extract() {
      const details = utils.joinedText([
        "[data-testid='features']",
        ".detail-features",
        ".feature-list",
        ".features",
      ]);
      const sellerName = utils.firstText([
        "[data-testid='agency-name']",
        ".agency-name",
        ".advertiser-name",
        ".detail-agency-name",
      ]);
      const sellerContext = utils.firstText([
        "[data-testid='agency-card']",
        ".detail-agency",
        ".advertiser-card",
      ]);
      const addressRaw = utils.firstText([
        "[data-testid='address']",
        ".detail-location",
        ".property-location",
        ".location",
      ]);
      const extracted = {
        title: utils.firstText([
          "[data-testid='listing-title']",
          ".detail-title",
          ".property-title",
          "h1",
        ]),
        description: utils.firstText([
          "[data-testid='description']",
          ".detail-description",
          ".property-description",
          ".description",
        ]),
        price: generic.parsePrice(
          utils.firstText([
            "[data-testid='price']",
            ".detail-price",
            ".property-price",
            ".price",
          ]),
        ),
        sqm: generic.parseSqm(details),
        rooms: generic.parseRooms(details),
        floor: utils.parseFloor(details),
        zone: addressRaw,
        addressRaw,
        sellerName,
        sellerType: utils.sellerTypeFrom(sellerName, sellerContext),
        phone: generic.visiblePhone(),
        portalDeclaredDate: utils.dateText([
          "[data-testid='listing-date']",
          ".detail-date",
          ".publication-date",
        ]),
      };

      return {
        ...extracted,
        rawPayload: {
          portalAdapter: "casa",
          adapterVersion: "1",
          extractedFields: utils.fieldNames(extracted),
        },
      };
    },
  };
})();
