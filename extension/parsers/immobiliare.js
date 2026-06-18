(function registerImmobiliareParser() {
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

  function collectImmobiliareImages() {
    const urls = [];

    function add(value) {
      const normalized = normalizeImageUrl(value);

      if (
        normalized &&
        /(?:immobiliare|indomio|cloudfront|img)/i.test(normalized) &&
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
      "[data-cy='listing-title']",
      "h1",
    ]);
  }

  function extractDescription() {
    return utils.cleanDescription(
      utils.firstText([
        "[data-testid='description']",
        "[data-cy='description']",
        "[data-testid='listing-description']",
        ".in-readAll",
        ".in-description",
      ]) ||
        utils.sectionText(
          [/^Descrizione$/i],
          [/^(leggi tutto|Caratteristiche|Se vuoi saperne|Inserzionista)$/i],
        ),
    );
  }

  function extractDetailsText() {
    return (
      utils.joinedText([
        "[data-testid='main-features']",
        "[data-testid='features']",
        "[data-cy='features']",
        ".in-detail__mainFeatures",
        ".nd-list",
        ".features",
      ]) ||
      utils.sectionText(
        [/^Caratteristiche$/i],
        [
          /^(Dettaglio superficie|Costi|Informazioni sul prezzo|Efficienza energetica|Mappa|Planimetria|Se vuoi saperne)$/i,
        ],
      )
    );
  }

  function extractSellerName(pageText) {
    return (
      utils.firstText([
        "[data-testid='agency-name']",
        "[data-cy='agency-name']",
        "[data-testid='advertiser-name']",
        "[data-cy='advertiser-name']",
        ".in-re-contactInfo__title",
        ".advertiser-name",
        ".agency-name",
      ]) ||
      utils.lineAfter([/^Inserzionista$/i], {
        skip: [
          /^Mostra Telefono$/i,
          /^scheda agenzia$/i,
          /^Contatta/i,
          /^Invia/i,
          /^Image/i,
        ],
      }) ||
      utils.firstMatch(pageText, [
        /puoi parlare con\s+([^.,\n]+?)(?:\.|Invia|$)/i,
        /Inserzionista\s+([^#\n]+?)\s+(?:Mostra Telefono|scheda agenzia|Opzioni|Contatta)/i,
        /Affiliato\s+[^:]+:\s*([^#\n]+?)(?:\s+scheda agenzia|\s+Opzioni|\s+Contatta|$)/i,
      ]) ||
      utils.sellerNameFromText()
    );
  }

  function extractSellerContext(pageText) {
    return (
      utils.firstText([
        "[data-testid='agency-card']",
        "[data-cy='agency-card']",
        "[data-testid='advertiser-card']",
        "[data-cy='advertiser-card']",
        ".in-re-contactInfo",
      ]) ||
      utils.sectionText(
        [/^Inserzionista$/i],
        [/^(Mutuo|Opzioni aggiuntive|Contatta)$/i],
      ) ||
      pageText
    );
  }

  function extractSellerType(name, context, description) {
    const text = `${name || ""} ${context || ""} ${description || ""}`;

    if (/\b(?:no agenzie|privato|proprietario|vendita diretta)\b/i.test(text)) {
      return "private";
    }

    return utils.sellerTypeFrom(name, text) || "unknown";
  }

  function extractAddress(pageText) {
    const fromSelector = utils.firstText([
      "[data-testid='address']",
      "[data-cy='listing-address']",
      "[data-testid='location']",
      ".in-titleBlock__content",
      ".in-location",
    ]);
    const fromText = utils.firstMatch(pageText, [
      /(?:^|\n)(Bitonto\s+(?:Via|Viale|Corso|Piazza|Strada|Contrada)[^\n€#]+?)(?:\n|$)/i,
      /(?:^|\n)((?:Via|Viale|Corso|Piazza|Strada|Contrada)[^\n€#]+?,?\s+Bitonto)(?:\n|$)/i,
    ]);

    return fromSelector || fromText || null;
  }

  function extractDeclaredDate(pageText) {
    return (
      utils.dateText([
        "[data-testid='listing-date']",
        ".in-statistics",
        ".in-date",
      ]) ||
      utils.firstLineMatch([
        /Annuncio aggiornato il\s+(.+)$/i,
        /Pubblicato il\s+(.+)$/i,
        /Inserito il\s+(.+)$/i,
      ]) ||
      utils.firstMatch(pageText, [
        /Annuncio aggiornato il\s+([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i,
        /Pubblicato il\s+([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i,
      ])
    );
  }

  globalThis.ListingRadarPortalAdapters.immobiliare = {
    extract() {
      const pageText = utils.pageText();
      const details = extractDetailsText();
      const description = extractDescription();
      const sellerName = extractSellerName(pageText);
      const sellerContext = extractSellerContext(pageText);
      const addressRaw = extractAddress(pageText);
      const imageUrls = collectImmobiliareImages();
      const extracted = {
        title: extractTitle(),
        description,
        price:
          generic.parsePrice(
            utils.firstText([
              "[data-testid='price']",
              "[data-cy='price']",
              ".in-price",
            ]) ||
              utils.fieldValue(["Prezzo"]) ||
              pageText,
          ) || utils.textPrice(),
        sqm:
          generic.parseSqm(
            utils.fieldValue(["Superficie", "Sup. commerciale"]) || details,
          ) || generic.parseSqm(description),
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
          portalAdapter: "immobiliare",
          adapterVersion: "3",
          extractedFields: utils.fieldNames(extracted),
          detailsText: details.slice(0, 3000),
          sellerContext: sellerContext.slice(0, 1500),
        },
      };
    },
  };
})();
