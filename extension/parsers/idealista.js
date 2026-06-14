(function registerIdealistaParser() {
  const generic = globalThis.ListingRadarGenericParser;
  const utils = globalThis.ListingRadarPortalAdapterUtils;

  globalThis.ListingRadarPortalAdapters.idealista = {
    extract() {
      const details = utils.joinedText([
        ".info-features",
        ".details-property_features",
        ".details-property-feature-one",
        "[data-testid='details-features']",
      ]);
      const sellerName = utils.firstText([
        ".professional-name",
        ".advertiser-name",
        ".contact-info .name",
        "[data-testid='advertiser-name']",
      ]);
      const sellerContext = utils.firstText([
        ".professional-info",
        ".contact-info",
        "[data-testid='advertiser-info']",
      ]);
      const addressRaw = utils.firstText([
        ".main-info__title-minor",
        ".header-map-list",
        "[data-testid='address']",
      ]);
      const extracted = {
        title: utils.firstText([
          ".main-info__title-main",
          "[data-testid='listing-title']",
          "h1",
        ]),
        description: utils.firstText([
          ".comment",
          ".adCommentsLanguage",
          "[data-testid='description']",
        ]),
        price: generic.parsePrice(
          utils.firstText([
            ".info-data-price",
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
          ".stats-text",
          ".date-update-text",
          "[data-testid='listing-date']",
        ]),
      };

      return {
        ...extracted,
        rawPayload: {
          portalAdapter: "idealista",
          adapterVersion: "1",
          extractedFields: utils.fieldNames(extracted),
        },
      };
    },
  };
})();
