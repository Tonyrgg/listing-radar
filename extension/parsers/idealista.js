(function registerIdealistaParser() {
  const generic = globalThis.ListingRadarGenericParser;
  const utils = globalThis.ListingRadarPortalAdapterUtils;

  function isNoiseImageUrl(url, context = "") {
    const searchable =
      `${url.hostname} ${url.pathname} ${url.search} ${context}`.toLowerCase();

    return (
      /\.(?:svg|gif)(?:$|\?)/i.test(searchable) ||
      /(?:logo|badge|icon|sprite|avatar|spacer|pixel|tracking|captcha|map-static|static-map|placeholder|translate|language|locale|idioma|country-flag|bandera|\/toto)/i.test(
        searchable,
      ) ||
      /(?:^|[\/_.-])flags?(?:[\/_.-]|$)/i.test(searchable)
    );
  }

  function elementLooksTooSmall(element) {
    const width =
      Number(element?.getAttribute?.("width")) ||
      Number(element?.width) ||
      Number(element?.naturalWidth);
    const height =
      Number(element?.getAttribute?.("height")) ||
      Number(element?.height) ||
      Number(element?.naturalHeight);

    return (
      (Number.isFinite(width) && width > 0 && width < 120) ||
      (Number.isFinite(height) && height > 0 && height < 90) ||
      (Number.isFinite(width) &&
        Number.isFinite(height) &&
        width > 0 &&
        height > 0 &&
        width * height < 12000)
    );
  }

  function normalizeImageUrl(value, context = "") {
    if (!value || /^(?:data:|blob:|javascript:)/i.test(value)) {
      return null;
    }

    try {
      const url = new URL(value, location.href);

      if (
        !["http:", "https:"].includes(url.protocol) ||
        isNoiseImageUrl(url, context)
      ) {
        return null;
      }

      return url.toString();
    } catch {
      return null;
    }
  }

  function collectIdealistaImages() {
    const urls = [];

    function add(value, context = "") {
      const normalized = normalizeImageUrl(value, context);

      if (
        normalized &&
        /(?:idealista|indomio|cloudfront|img)/i.test(normalized) &&
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
        const context = [
          element.getAttribute("alt"),
          element.getAttribute("title"),
          element.getAttribute("class"),
          element.getAttribute("aria-label"),
        ]
          .filter(Boolean)
          .join(" ");
        const srcset =
          element.getAttribute("srcset") || element.getAttribute("data-srcset");
        const src =
          element.getAttribute("src") ||
          element.getAttribute("data-src") ||
          element.currentSrc;

        if (elementLooksTooSmall(element)) {
          return;
        }

        if (srcset) {
          srcset
            .split(",")
            .map((candidate) => candidate.trim().split(/\s+/)[0])
            .filter(Boolean)
            .forEach((candidate) => add(candidate, context));
        }

        add(src, context);
      });

    document.querySelectorAll("script").forEach((script) => {
      const matches = (script.textContent || "").match(
        /https?:\\?\/\\?\/[^"'\s]+?(?:jpg|jpeg|webp|png)(?:\?[^"'\s<]*)?/gi,
      );

      matches?.forEach((match) => add(match.replace(/\\\//g, "/")));
    });

    return urls.slice(0, 40);
  }

  function stripIdealistaNoise(value) {
    return utils
      .cleanDescription(value)
      .replace(/Disponibile in Italiano.*?Altre lingue/gi, " ")
      .replace(
        /(?:Italiano|English|Espa\u00f1ol|Fran\u00e7ais|Deutsch|Portugu\u00eas|Dansk|Suomi|Norsk|Nederlands|Polski|Rom\u00e2n\u0103|Svenska|Altre lingue)\s*/gi,
        " ",
      )
      .replace(
        /(?:Ci dispiace|Sorry|Lo sentimos|Nous sommes d\u00e9sol\u00e9s|Leider|Lamentamos).*?(?:pi\u00f9 tardi|later|tard|sp\u00e4ter)\.?/gi,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractTitle() {
    return utils.firstText([
      ".main-info__title-main",
      "[data-testid='listing-title']",
      "h1",
    ]);
  }

  function extractDescription() {
    return stripIdealistaNoise(
      utils.firstText([
        ".comment",
        ".adCommentsLanguage",
        "[data-testid='description']",
        "[data-test='description']",
      ]) ||
        utils.sectionText(
          [/^Descrizione dell.?inserzionista$/i],
          [
            /^(Caratteristiche specifiche|Costruzione|Dotazioni|Prezzo|Posizione|Statistiche|Chiedi all'inserzionista)$/i,
          ],
        ),
    );
  }

  function extractDetailsText() {
    return [
      utils.joinedText([
        ".info-features",
        ".details-property_features",
        ".details-property-feature-one",
        "[data-testid='details-features']",
      ]),
      utils.sectionText(
        [/^Caratteristiche specifiche$/i],
        [/^(Costruzione|Dotazioni|Prezzo|Posizione|Statistiche|Chiedi all'inserzionista)$/i],
      ),
      utils.sectionText(
        [/^Costruzione$/i],
        [/^(Dotazioni|Prezzo|Posizione|Statistiche|Chiedi all'inserzionista)$/i],
      ),
      utils.sectionText(
        [/^Dotazioni$/i],
        [/^(Prezzo|Posizione|Statistiche|Chiedi all'inserzionista)$/i],
      ),
    ]
      .filter(Boolean)
      .join(" ");
  }

  function extractAddress() {
    const position = utils.sectionText(
      [/^Posizione$/i],
      [/^(Statistiche|Chiedi all'inserzionista|Persona che pubblica|Servizi di idealista)$/i],
    );

    return (
      utils.firstText([
        ".main-info__title-minor",
        ".header-map-list",
        "[data-testid='address']",
        "[data-test='address']",
      ]) ||
      utils.lineAfter([/^Posizione$/i], {
        skip: [/^Ingrandisci mappa$/i, /^Mappa$/i],
      }) ||
      position ||
      null
    );
  }

  function extractSellerName(pageText) {
    return (
      utils.firstText([
        ".professional-name",
        ".advertiser-name",
        ".contact-info .name",
        "[data-testid='advertiser-name']",
        "[data-test='advertiser-name']",
      ]) ||
      utils.lineAfter([/^Chiedi all'inserzionista$/i], {
        skip: [/^Contattato$/i, /^Il tuo messaggio/i, /^Ciao,/i],
      }) ||
      utils.lineAfter([/^Persona che pubblica l'annuncio$/i], {
        skip: [
          /^Vedi il telefono/i,
          /^Chiama$/i,
          /^Codice dell'annuncio$/i,
          /^\d+$/,
          /^Professionista$/i,
          /^Privato$/i,
          /^Chat$/i,
        ],
      }) ||
      utils.firstMatch(pageText, [
        /puoi parlare con\s+([^.,\n]+?)(?:\.|via chat|$)/i,
        /Chiedi all'inserzionista\s+([^#\n]+?)\s+(?:Contattato|Il tuo messaggio|Ciao,|Il tuo indirizzo)/i,
        /Persona che pubblica l'annuncio\s+[^#\n]*?(?:Professionista|Privato)\s+([^#\n]+?)(?:\s+Chat|\s+Chiama|\s+Case a|$)/i,
      ]) ||
      utils.sellerNameFromText()
    );
  }

  function extractSellerContext(pageText) {
    return (
      utils.firstText([
        ".professional-info",
        ".contact-info",
        "[data-testid='advertiser-info']",
        "[data-test='advertiser-info']",
      ]) ||
      utils.sectionText(
        [/^Persona che pubblica l'annuncio$/i],
        [/^(Servizi di idealista|Case a|Stai cercando)$/i],
      ) ||
      utils.sectionText(
        [/^Chiedi all'inserzionista$/i],
        [/^(Persona che pubblica l'annuncio|Servizi di idealista)$/i],
      ) ||
      pageText
    );
  }

  function extractSellerType(name, context, description) {
    const text = `${name || ""} ${context || ""} ${description || ""}`;
    const classified = utils.sellerTypeFrom(name, text);

    if (classified === "agency") {
      return "agency";
    }

    if (/\b(?:no agenzie|no intermediari|privato vende|vendita da privato|vendita diretta)\b/i.test(text)) {
      return "private";
    }

    return classified || "unknown";
  }

  function extractFloor(details, description) {
    return (
      utils.parseFloor(details) ||
      utils.firstMatch(details, [
        /(?:^|\s)((?:terra|rialzato|seminterrato|interrato|ultimo|\d+)[\u00b0\u00ba]?\s+piano(?:\s+con ascensore)?)/i,
      ]) ||
      utils.firstMatch(description, [
        /(?:al|sito al|posto al)\s+((?:piano\s+)?(?:terra|rialzato|seminterrato|interrato|ultimo|\d+[\u00b0\u00ba]?))(?:\s+piano)?/i,
      ])
    );
  }

  function extractDeclaredDate(pageText) {
    return (
      utils.dateText([
        ".stats-text",
        ".date-update-text",
        "[data-testid='listing-date']",
        "[data-test='listing-date']",
      ]) ||
      utils.firstLineMatch([
        /Annuncio aggiornato il\s+(.+)$/i,
        /Annuncio pubblicato il\s+(.+)$/i,
        /Pubblicato il\s+(.+)$/i,
      ]) ||
      utils.firstMatch(pageText, [
        /Annuncio aggiornato il\s+([0-9]{1,2}\s+\w+)/i,
        /Annuncio pubblicato il\s+([0-9]{1,2}\s+\w+)/i,
      ])
    );
  }

  globalThis.ListingRadarPortalAdapters.idealista = {
    extract() {
      const pageText = utils.pageText();
      const details = extractDetailsText();
      const description = extractDescription();
      const addressRaw = extractAddress();
      const sellerName = extractSellerName(pageText);
      const sellerContext = extractSellerContext(pageText);
      const imageUrls = collectIdealistaImages();
      const extracted = {
        title: extractTitle(),
        description,
        price:
          generic.parsePrice(
            utils.firstText([
              ".info-data-price",
              "[data-testid='price']",
              "[data-test='price']",
              ".price",
            ]) ||
              utils.fieldValue(["Prezzo dell'immobile", "Prezzo d'asta", "Prezzo"]) ||
              pageText,
          ) || utils.textPrice(),
        sqm:
          generic.parseSqm(details) ||
          generic.parseSqm(pageText.match(/\b\d+\s*m[\u00b2 2q]\b/i)?.[0]) ||
          generic.parseSqm(description),
        rooms: generic.parseRooms(details),
        floor: extractFloor(details, description),
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
          portalAdapter: "idealista",
          adapterVersion: "3",
          extractedFields: utils.fieldNames(extracted),
          detailsText: details.slice(0, 3000),
          sellerContext: sellerContext.slice(0, 1500),
        },
      };
    },
  };
})();
