(function registerSubitoParser() {
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

  function collectSubitoImages() {
    const urls = [];

    function add(value) {
      const normalized = normalizeImageUrl(value);

      if (
        normalized &&
        /(?:subito|subitoimg|cloudfront|img)/i.test(normalized) &&
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

  function extractTitle(pageText) {
    return (
      utils.firstText([
        "[data-testid='ad-title']",
        "[data-testid='title']",
        "h1",
      ]) ||
      utils.firstMatch(pageText, [/^#####\s+(.+)$/m]) ||
      null
    );
  }

  function extractDetailsText() {
    return [
      utils.joinedText([
        "[data-testid='ad-properties']",
        "[data-testid='features']",
        ".feature-list",
        ".main-features",
      ]),
      utils.sectionText(
        [/^Dati principali$/i],
        [/^(Descrizione|Caratteristiche|Dettagli|Energia e riscaldamento)$/i],
      ),
      utils.sectionText(
        [/^Caratteristiche$/i],
        [/^(Dettagli|Energia e riscaldamento|Venditore|Inserzionista|Localit.|Mappa)$/i],
      ),
      utils.sectionText(
        [/^Dettagli$/i],
        [/^(Energia e riscaldamento|Venditore|Inserzionista|Localit.|Mappa)$/i],
      ),
    ]
      .filter(Boolean)
      .join(" ");
  }

  function extractDescription() {
    return utils.cleanDescription(
      utils.firstText([
        "[data-testid='ad-description']",
        "[data-testid='description']",
        ".description",
      ]) ||
        utils.sectionText(
          [/^Descrizione$/i],
          [/^(Caratteristiche|Dettagli|Energia e riscaldamento|Venditore|Inserzionista|Localit.|Mappa|Pubblicato)$/i],
        ),
    );
  }

  function extractSellerName(pageText) {
    return (
      utils.firstText([
        "[data-testid='user-name']",
        "[data-testid='seller-name']",
        "[data-testid='advertiser-name']",
        ".advertiser-name",
        ".seller-name",
      ]) ||
      utils.lineAfter([/^Venditore$/i, /^Inserzionista$/i], {
        skip: [
          /^Nessuna recensione$/i,
          /^Ultimo accesso/i,
          /^Appartamenti$/i,
          /^Privato$/i,
          /^Professionista$/i,
        ],
      }) ||
      utils.firstMatch(pageText, [
        /######\s+([A-ZÀ-Üa-zà-ü][^#\n]{1,60})\s+Nessuna recensione/i,
        /(?:^|\n)([A-ZÀ-Üa-zà-ü][^#\n]{1,60})\s+Nessuna recensione/i,
      ])
    );
  }

  function extractSellerContext(pageText) {
    return (
      utils.firstText([
        "[data-testid='seller-card']",
        "[data-testid='user-info']",
        ".seller-info",
      ]) ||
      utils.sectionText(
        [/^(Venditore|Inserzionista)$/i],
        [/^(Ricerche consigliate|Tutte le categorie|ID:)$/i],
      ) ||
      pageText
    );
  }

  function extractSellerType(sellerName, sellerContext, description) {
    const text = `${sellerName || ""} ${sellerContext || ""} ${description || ""}`;
    const classified = utils.sellerTypeFrom(sellerName, text);

    if (classified === "agency") {
      return "agency";
    }

    if (/\b(?:privato vende|vendita da privato|no agenzie|no intermediari|non voglio essere contattato da agenzie)\b/i.test(text)) {
      return "private";
    }

    return classified || "unknown";
  }

  function extractAddress(pageText) {
    return (
      utils.firstText([
        "[data-testid='location']",
        "[data-testid='ad-location']",
        ".location",
      ]) ||
      utils.sectionText(
        [/^Localit.|^Mappa$/i],
        [/^(Venditore|Inserzionista|Pubblicato|ID:)$/i],
      ) ||
      utils.firstMatch(pageText, [
        /(?:^|\n)(Bitonto\s*\(BA\)|Bitonto\s+\(Bari\)|Bitonto[^#\n]*Bari[^#\n]*)(?:\n|$)/i,
        /(?:^|\n)((?:Via|Viale|Corso|Piazza|Strada|Contrada)[^#\n]+Bitonto[^#\n]*)(?:\n|$)/i,
        /(?:zona|precisamente in)\s+([^.,\n]+?Bitonto[^.,\n]*)/i,
      ])
    );
  }

  function extractPrice(pageText) {
    return (
      generic.parsePrice(
        utils.firstText([
          "[data-testid='ad-price']",
          "[data-testid='price']",
          ".price",
        ]),
      ) ||
      generic.parsePrice(
        utils.firstMatch(pageText, [
          /(?:^|\n)(\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?\s*(?:€|eur|euro))(?:\n|$)/i,
        ]),
      ) ||
      utils.textPrice()
    );
  }

  function extractDeclaredDate(pageText) {
    return (
      utils.dateText([
        "[data-testid='ad-date']",
        "[data-testid='publication-date']",
        ".date",
      ]) ||
      utils.firstLineMatch([
        /Pubblicato il\s+(.+)$/i,
        /Inserito il\s+(.+)$/i,
        /Aggiornato il\s+(.+)$/i,
        /^(\d{1,2}\s+\w+\s+alle\s+\d{1,2}:\d{2})$/i,
      ]) ||
      utils.firstMatch(pageText, [
        /(?:^|\n)(\d{1,2}\s+\w+\s+alle\s+\d{1,2}:\d{2})(?:\n|$)/i,
      ])
    );
  }

  globalThis.ListingRadarPortalAdapters.subito = {
    extract() {
      const pageText = utils.pageText();
      const details = extractDetailsText();
      const description = extractDescription();
      const sellerName = extractSellerName(pageText);
      const sellerContext = extractSellerContext(pageText);
      const addressRaw = extractAddress(pageText);
      const imageUrls = collectSubitoImages();
      const extracted = {
        title: extractTitle(pageText),
        description,
        price: extractPrice(pageText),
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
        portalDeclaredDate: extractDeclaredDate(pageText),
      };

      return {
        ...extracted,
        rawPayload: {
          portalAdapter: "subito",
          adapterVersion: "3",
          extractedFields: utils.fieldNames(extracted),
          detailsText: details.slice(0, 3000),
          sellerContext: sellerContext.slice(0, 1500),
        },
      };
    },
  };
})();
