(function registerCasaDaPrivatoParser() {
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

  function collectImages() {
    const urls = [];

    function add(value) {
      const normalized = normalizeImageUrl(value);

      if (
        normalized &&
        /(?:casadaprivato|cloudfront|img|image)/i.test(normalized) &&
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
          [/^.+\s+in\s+Vendita\s+da\s+Privato/i],
          [/^(CONDIVIDI SU|DATI PRINCIPALI|COSTI|MUTUO)$/i],
        ) ||
        utils.sectionText(
          [/^Descrizione$/i],
          [/^(DATI PRINCIPALI|COSTI|MUTUO)$/i],
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
      utils.sectionText([/^DATI PRINCIPALI$/i], [/^(COSTI|MUTUO|Annunci immobiliari)$/i]),
      utils.sectionText([/^COSTI$/i], [/^(MUTUO|Annunci immobiliari)$/i]),
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
        /^(.+?\s+•\s+Bitonto\s+\(Bari\))$/im,
        /(?:^|\n)((?:Via|Viale|Corso|Piazza|Strada|Contrada|Vico)[^\n€#]+?Bitonto[^#\n]*)(?:\n|$)/i,
        /(?:^|\n)(Bitonto\s+\(Bari\))(?:\n|$)/i,
      ])
    );
  }

  function extractSellerName(pageText) {
    return (
      utils.firstText([
        "[data-testid='seller-name']",
        "[data-testid='advertiser-name']",
        ".seller-name",
        ".advertiser-name",
      ]) ||
      utils.firstMatch(pageText, [
        /(?:Privato|Proprietario)\s+Vende\s+([^€\n#]{2,80})/i,
        /da\s+Privato\s+a\s+([^,\n#]{2,80})/i,
      ]) ||
      "Privato"
    );
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
        /Rif\.\s*(\d+)/i,
      ])
    );
  }

  globalThis.ListingRadarPortalAdapters.casadaprivato = {
    extract() {
      const pageText = utils.pageText();
      const details = extractDetailsText();
      const description = extractDescription();
      const addressRaw = extractAddress(pageText);
      const sellerName = extractSellerName(pageText);
      const imageUrls = collectImages();
      const isPrivate = /\b(?:Privato Vende|da Privato|senza agenzia|senza intermediari)\b/i.test(
        pageText,
      );
      const detectedSellerType = utils.sellerTypeFrom(sellerName, pageText);
      const extracted = {
        title: extractTitle(pageText),
        description,
        price:
          generic.parsePrice(utils.fieldValue(["Prezzo"]) || details) ||
          generic.parsePrice(pageText) ||
          utils.textPrice(),
        sqm:
          generic.parseSqm(utils.fieldValue(["Superficie"]) || details) ||
          generic.parseSqm(pageText.match(/\b\d+\s*mq\b/i)?.[0]) ||
          generic.parseSqm(description),
        rooms: generic.parseRooms(
          utils.fieldValue(["Locali", "Vani", "Camere"]) || details,
        ),
        floor: utils.fieldValue(["Piano"]) || utils.parseFloor(details),
        zone: addressRaw,
        addressRaw,
        sellerName,
        sellerType:
          detectedSellerType === "agency"
            ? "agency"
            : isPrivate
              ? "private"
              : detectedSellerType || "unknown",
        phone: generic.visiblePhone(),
        imageUrl: imageUrls[0] || null,
        imageUrls,
        portalDeclaredDate: extractDeclaredDate(pageText),
      };

      return {
        ...extracted,
        rawPayload: {
          portalAdapter: "casadaprivato",
          adapterVersion: "1",
          extractedFields: utils.fieldNames(extracted),
          detailsText: details.slice(0, 3000),
          sellerContext: `${sellerName || ""} ${isPrivate ? "Privato Vende" : ""}`,
        },
      };
    },
  };
})();
