(function registerWikicasaParser() {
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

  function collectWikicasaImages() {
    const urls = [];

    function add(value) {
      const normalized = normalizeImageUrl(value);

      if (
        normalized &&
        /(?:wikicasa|cloudfront|img|image)/i.test(normalized) &&
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
        "[data-testid='listing-title']",
        "[data-testid='property-title']",
        ".detail-title",
        ".property-title",
        "h1",
      ]) ||
      utils.firstMatch(pageText, [/^#\s+(.+)$/m]) ||
      null
    );
  }

  function extractDescription() {
    return utils.cleanDescription(
      utils.firstText([
        "[data-testid='description']",
        "[data-testid='property-description']",
        ".description",
        ".property-description",
      ]) ||
        utils.sectionText(
          [/^Descrizione$/i],
          [/^(Leggi tutto|Informazioni principali|Spese e catasto|Energia e riscaldamento|Altre caratteristiche|Edificio|Posizione immobile)$/i],
        ),
    );
  }

  function extractDetailsText() {
    return [
      utils.joinedText([
        "[data-testid='features']",
        "[data-testid='property-features']",
        ".feature-list",
        ".features",
      ]),
      utils.sectionText(
        [/^Informazioni principali$/i],
        [/^(Spese e catasto|Energia e riscaldamento|Altre caratteristiche|Edificio|Posizione immobile)$/i],
      ),
      utils.sectionText(
        [/^Spese e catasto$/i],
        [/^(Energia e riscaldamento|Altre caratteristiche|Edificio|Posizione immobile)$/i],
      ),
      utils.sectionText(
        [/^Edificio$/i],
        [/^(Posizione immobile|Vicino a|Real estate POI)$/i],
      ),
    ]
      .filter(Boolean)
      .join(" ");
  }

  function extractAddress(pageText) {
    return (
      utils.firstText([
        "[data-testid='address']",
        "[data-testid='location']",
        ".address",
        ".location",
      ]) ||
      utils.firstMatch(pageText, [
        /^#\s+.+?,\s+(.+?Bitonto.*?)$/im,
        /(?:^|\n)((?:Via|Viale|Corso|Piazza|Strada|Contrada|Vico)[^\n€#]+?Bitonto)(?:\n|$)/i,
        /(?:^|\n)(Bitonto[^\n€#]+?(?:Via|Viale|Corso|Piazza|Strada|Contrada|Vico)[^\n€#]+?)(?:\n|$)/i,
      ]) ||
      utils.sectionText(
        [/^Posizione immobile$/i],
        [/^(Vicino a|Real estate POI|Servizi)$/i],
      )
    );
  }

  function extractSellerName(description, pageText) {
    return (
      utils.firstText([
        "[data-testid='agency-name']",
        "[data-testid='advertiser-name']",
        ".agency-name",
        ".advertiser-name",
      ]) ||
      utils.lineAfter([/^Contatta$/i, /^Agenzia$/i, /^Inserzionista$/i], {
        skip: [/^Telefono$/i, /^Image/i, /^Contatta$/i],
      }) ||
      utils.firstMatch(description, [
        /^([^.,]+?Tecnocasa[^.,]*?)\s+propone/i,
        /^([^.,]+?Immobiliare[^.,]*?)\s+propone/i,
        /^([^.,]+?RE\/MAX[^.,]*?)\s+propone/i,
        /(?:proposto da|agenzia)\s+([^.,\n]+)/i,
      ]) ||
      utils.firstMatch(pageText, [
        /(?:Gruppo|Studio)\s+([^#\n]{2,80}?)(?:\s+propone|\s+vende)/i,
      ])
    );
  }

  function extractSellerContext(sellerName, description, pageText) {
    return (
      utils.firstText([
        "[data-testid='agency-card']",
        "[data-testid='advertiser-card']",
        ".agency-card",
        ".advertiser-card",
      ]) || `${sellerName || ""} ${description || ""} ${pageText.slice(0, 2000)}`
    );
  }

  function extractSellerType(sellerName, sellerContext, description) {
    const text = `${sellerName || ""} ${sellerContext || ""} ${description || ""}`;

    if (/\b(?:privato|proprietario|no agenzie|vendita diretta)\b/i.test(text)) {
      return "private";
    }

    return utils.sellerTypeFrom(sellerName, text) || "unknown";
  }

  function extractDeclaredDate(pageText) {
    return (
      utils.dateText([
        "[data-testid='listing-date']",
        ".date",
        ".publication-date",
      ]) ||
      utils.firstLineMatch([
        /Pubblicato\s+(.+)$/i,
        /Aggiornato\s+(.+)$/i,
        /Inserito\s+(.+)$/i,
      ]) ||
      utils.firstMatch(pageText, [
        /Published:\s*(.+?)(?:;|\n|$)/i,
        /(\d+\s+(?:giorni|mesi|settimane)\s+fa)/i,
        /(last\s+(?:week|month)|\d+\s+days?\s+ago)/i,
      ])
    );
  }

  globalThis.ListingRadarPortalAdapters.wikicasa = {
    extract() {
      const pageText = utils.pageText();
      const details = extractDetailsText();
      const description = extractDescription();
      const sellerName = extractSellerName(description, pageText);
      const sellerContext = extractSellerContext(sellerName, description, pageText);
      const addressRaw = extractAddress(pageText);
      const imageUrls = collectWikicasaImages();
      const extracted = {
        title: extractTitle(pageText),
        description,
        price:
          generic.parsePrice(utils.fieldValue(["Prezzo"]) || details) ||
          generic.parsePrice(pageText) ||
          utils.textPrice(),
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
          portalAdapter: "wikicasa",
          adapterVersion: "1",
          extractedFields: utils.fieldNames(extracted),
          detailsText: details.slice(0, 3000),
          sellerContext: sellerContext.slice(0, 1500),
        },
      };
    },
  };
})();
