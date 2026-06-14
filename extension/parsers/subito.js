(function registerSubitoParser() {
  const generic = globalThis.ListingRadarGenericParser;
  const utils = globalThis.ListingRadarPortalAdapterUtils;

  globalThis.ListingRadarPortalAdapters.subito = {
    extract() {
      const details = utils.joinedText([
        "[data-testid='ad-properties']",
        "[data-testid='features']",
        ".feature-list",
        ".main-features",
      ]);
      const sellerName = utils.firstText([
        "[data-testid='user-name']",
        "[data-testid='seller-name']",
        ".advertiser-name",
      ]);
      const sellerContext = utils.firstText([
        "[data-testid='seller-card']",
        "[data-testid='user-info']",
        ".seller-info",
      ]);
      const addressRaw = utils.firstText([
        "[data-testid='location']",
        "[data-testid='ad-location']",
        ".location",
      ]);
      const extracted = {
        title: utils.firstText([
          "[data-testid='ad-title']",
          "[data-testid='title']",
          "h1",
        ]),
        description: utils.firstText([
          "[data-testid='ad-description']",
          "[data-testid='description']",
          ".description",
        ]),
        price: generic.parsePrice(
          utils.firstText([
            "[data-testid='ad-price']",
            "[data-testid='price']",
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
          "[data-testid='ad-date']",
          "[data-testid='publication-date']",
          ".date",
        ]),
      };

      return {
        ...extracted,
        rawPayload: {
          portalAdapter: "subito",
          adapterVersion: "1",
          extractedFields: utils.fieldNames(extracted),
        },
      };
    },
  };
})();
