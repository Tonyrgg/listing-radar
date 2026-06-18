(function registerCasaParser() {
  const generic = globalThis.ListingRadarGenericParser;
  const utils = globalThis.ListingRadarPortalAdapterUtils;

  function normalizeImageUrl(value) {
    if (!value || /^(?:data:|blob:|javascript:)/i.test(value)) {
      return null;
    }

    try {
      const url = new URL(value, location.href);
      const searchable =
        `${url.hostname} ${url.pathname} ${url.search}`.toLowerCase();

      if (
        !["http:", "https:"].includes(url.protocol) ||
        /\.(?:svg|gif)(?:$|\?)/i.test(searchable) ||
        /(?:logo|badge|icon|sprite|avatar|spacer|pixel|tracking|captcha|map-static)/i.test(
          searchable,
        )
      ) {
        return null;
      }

      return url.toString();
    } catch {
      return null;
    }
  }

  function collectCasaImages() {
    const urls = [];

    function add(value) {
      const normalized = normalizeImageUrl(value);

      if (
        normalized &&
        /(?:casa\.it|atoka|cloudfront|img|image)/i.test(normalized) &&
        !urls.includes(normalized)
      ) {
        urls.push(normalized);
      }
    }

    document
      .querySelectorAll(
        "picture source[srcset], img[src], img[srcset], img[data-src], img[data-srcset]",
      )
      .forEach((element) => {
        const srcset =
          element.getAttribute("srcset") || element.getAttribute("data-srcset");
        const src =
          element.getAttribute("src") ||
          element.getAttribute("data-src") ||
          element.currentSrc;

        if (srcset) {
          srcset
            .split(",")
            .map((candidate) => candidate.trim().split(/\s+/)[0])
            .filter(Boolean)
            .forEach(add);
        }

        add(src);
      });

    document.querySelectorAll("script").forEach((script) => {
      const matches = (script.textContent || "").match(
        /https?:\\?\/\\?\/[^"'\s]+?(?:jpg|jpeg|webp|png)(?:\?[^"'\s<]*)?/gi,
      );

      matches?.forEach((match) => add(match.replace(/\\\//g, "/")));
    });

    return urls.slice(0, 40);
  }

  function extractTitle() {
    return utils.firstText([
      "[data-testid='listing-title']",
      "[data-testid='property-title']",
      ".detail-title",
      ".property-title",
      "h1",
    ]);
  }

  function extractDetailsText() {
    return [
      utils.joinedText([
        "[data-testid='features']",
        "[data-testid='property-features']",
        ".detail-features",
        ".feature-list",
        ".features",
      ]),
      utils.sectionText(
        [/^Caratteristiche$/i],
        [
          /^(Stato e efficienza energetica|Costi e disponibilit.|Costi|Posizione e servizi|Descrizione)$/i,
        ],
      ),
      utils.sectionText(
        [/^Stato e efficienza energetica$/i],
        [/^(Costi e disponibilit.|Costi|Posizione e servizi|Strumenti aggiuntivi)$/i],
      ),
      utils.sectionText(
        [/^Costi e disponibilit.|^Costi$/i],
        [/^(Posizione e servizi|Strumenti aggiuntivi|Mutuo)$/i],
      ),
    ]
      .filter(Boolean)
      .join(" ");
  }

  function extractDescription() {
    return utils.cleanDescription(
      utils.firstText([
        "[data-testid='description']",
        "[data-testid='property-description']",
        ".detail-description",
        ".property-description",
        ".description",
      ]) ||
        utils.sectionText(
          [/^(Italiano|Descrizione)$/i],
          [/^(English|Espa\u00f1ol|Deutsch|Fran\u00e7ais|Leggi tutto|Aggiungi nota privata|Caratteristiche)$/i],
        ),
    );
  }

  function extractSellerName(description) {
    return (
      utils.firstText([
        "[data-testid='agency-name']",
        "[data-testid='advertiser-name']",
        ".agency-name",
        ".advertiser-name",
        ".detail-agency-name",
      ]) ||
      utils.lineAfter([/^Inserzionista$/i, /^Agenzia$/i], {
        skip: [/^Contatta$/i, /^Chiama$/i, /^Invia/i],
      }) ||
      utils.firstMatch(description, [
        /(?:Contattate|Contatta)\s+(?:l'agenzia\s+)?([^.,]+?)\s+per/i,
        /^([^.,]+?Immobiliare[^.,]*?)\s+propone/i,
        /^([^.,]+?Tecnocasa[^.,]*?)\s+propone/i,
        /^([^.,]+?RE\/MAX[^.,]*?)\s+propone/i,
      ]) ||
      null
    );
  }

  function extractSellerContext(sellerName, description) {
    return (
      utils.firstText([
        "[data-testid='agency-card']",
        "[data-testid='advertiser-card']",
        ".detail-agency",
        ".advertiser-card",
      ]) || `${sellerName || ""} ${description || ""}`
    );
  }

  function extractSellerType(sellerName, sellerContext, description) {
    const text = `${sellerName || ""} ${sellerContext || ""} ${description || ""}`;

    if (/\b(?:inserzionista privato|privato|no agenzie|proprietario)\b/i.test(text)) {
      return "private";
    }

    return utils.sellerTypeFrom(sellerName, text) || "unknown";
  }

  function extractAddress(pageText) {
    return (
      utils.firstText([
        "[data-testid='address']",
        "[data-testid='location']",
        ".detail-location",
        ".property-location",
        ".location",
      ]) ||
      utils.sectionText(
        [/^Posizione e servizi$/i],
        [/^(Vicino a|Servizi|Strumenti aggiuntivi|Mutuo)$/i],
      ) ||
      utils.firstMatch(pageText, [
        /(?:^|\n)((?:Via|Viale|Corso|Piazza|Strada|Contrada)[^\n€#]+?Bitonto)(?:\n|$)/i,
        /(?:^|\n)(Bitonto[^\n€#]+?(?:Via|Viale|Corso|Piazza|Strada|Contrada)[^\n€#]+?)(?:\n|$)/i,
      ])
    );
  }

  function extractDeclaredDate() {
    return (
      utils.dateText([
        "[data-testid='listing-date']",
        ".detail-date",
        ".publication-date",
      ]) ||
      utils.firstLineMatch([
        /Data ultimo aggiornamento\s+(.+)$/i,
        /Aggiornato il\s+(.+)$/i,
        /Pubblicato\s+(.+)$/i,
      ])
    );
  }

  globalThis.ListingRadarPortalAdapters.casa = {
    extract() {
      const pageText = utils.pageText();
      const details = extractDetailsText();
      const description = extractDescription();
      const sellerName = extractSellerName(description);
      const sellerContext = extractSellerContext(sellerName, description);
      const addressRaw = extractAddress(pageText);
      const imageUrls = collectCasaImages();
      const extracted = {
        title: extractTitle(),
        description,
        price:
          generic.parsePrice(
            utils.firstText([
              "[data-testid='price']",
              "[data-testid='property-price']",
              ".detail-price",
              ".property-price",
              ".price",
            ]) ||
              utils.fieldValue(["Prezzo"]) ||
              pageText,
          ) || utils.textPrice(),
        sqm:
          generic.parseSqm(utils.fieldValue(["Superficie"]) || details) ||
          generic.parseSqm(pageText.match(/\b\d+\s*m[\u00b2 2q]\b/i)?.[0]) ||
          generic.parseSqm(description),
        rooms: generic.parseRooms(
          utils.fieldValue(["Locali", "Vani", "Camere"]) || details,
        ),
        floor: utils.fieldValue(["Piano"]) || utils.parseFloor(details),
        zone: addressRaw,
        addressRaw,
        sellerName,
        sellerType: extractSellerType(sellerName, sellerContext, description),
        phone: generic.visiblePhone(),
        imageUrl: imageUrls[0] || null,
        imageUrls,
        portalDeclaredDate: extractDeclaredDate(),
      };

      return {
        ...extracted,
        rawPayload: {
          portalAdapter: "casa",
          adapterVersion: "3",
          extractedFields: utils.fieldNames(extracted),
          detailsText: details.slice(0, 3000),
          sellerContext: sellerContext.slice(0, 1500),
        },
      };
    },
  };
})();
