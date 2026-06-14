(function registerImmobiliareParser() {
  const generic = globalThis.ListingRadarGenericParser;
  const utils = globalThis.ListingRadarPortalAdapterUtils;

  globalThis.ListingRadarPortalAdapters.immobiliare = {
    extract() {
      const details = utils.joinedText([
        "[data-testid='main-features']",
        "[data-testid='features']",
        ".in-detail__mainFeatures",
        ".nd-list",
        ".features",
      ]);
      const sellerName = utils.firstText([
        "[data-testid='agency-name']",
        "[data-cy='agency-name']",
        ".in-re-contactInfo__title",
        ".advertiser-name",
      ]);
      const sellerContext = utils.firstText([
        "[data-testid='agency-card']",
        "[data-cy='agency-card']",
        ".in-re-contactInfo",
      ]);
      const addressRaw = utils.firstText([
        "[data-testid='address']",
        "[data-cy='listing-address']",
        ".in-titleBlock__content",
        ".in-location",
      ]);
      const extracted = {
        title: utils.firstText([
          "[data-testid='listing-title']",
          "[data-cy='listing-title']",
          "h1",
        ]),
        description: utils.firstText([
          "[data-testid='description']",
          "[data-cy='description']",
          ".in-readAll",
          ".in-description",
        ]),
        price: generic.parsePrice(
          utils.firstText([
            "[data-testid='price']",
            "[data-cy='price']",
            ".in-price",
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
          ".in-statistics",
          ".in-date",
        ]),
      };

      return {
        ...extracted,
        rawPayload: {
          portalAdapter: "immobiliare",
          adapterVersion: "1",
          extractedFields: utils.fieldNames(extracted),
        },
      };
    },
  };
})();
