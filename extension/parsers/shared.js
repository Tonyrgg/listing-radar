(function initializePortalAdapterUtils() {
  const generic = globalThis.ListingRadarGenericParser;

  function firstText(selectors) {
    for (const selector of selectors) {
      const value = generic.clean(document.querySelector(selector)?.textContent);

      if (value) {
        return value;
      }
    }

    return "";
  }

  function joinedText(selectors) {
    const values = [];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        const value = generic.clean(element.textContent);

        if (value && !values.includes(value)) {
          values.push(value);
        }
      });
    }

    return values.join(" ");
  }

  function firstAttribute(selectors, attribute) {
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.getAttribute(attribute);

      if (value) {
        return value;
      }
    }

    return "";
  }

  function parseFloor(value) {
    const text = generic.clean(value);
    const match = text.match(
      /(?:piano|floor)\s*[:\-]?\s*((?:terra|rialzato|seminterrato|interrato|ultimo|\d+)[a-z0-9\u00b0\u00ba\- ]{0,24})/i,
    );
    return match ? generic.clean(match[1]) : null;
  }

  function sellerTypeFrom(name, context) {
    const text = `${name || ""} ${context || ""}`.toLowerCase();

    if (
      /\b(?:agenzia|immobiliare|re\/max|tecnocasa|professionista|impresa)\b/i.test(
        text,
      )
    ) {
      return "agency";
    }

    if (/\b(?:privato|proprietario|vendita diretta|no agenzie)\b/i.test(text)) {
      return "private";
    }

    return null;
  }

  function dateText(selectors) {
    const value = firstText(selectors);
    const match = value.match(
      /(?:pubblicato|aggiornato|inserito|data)\s*(?:il|:)?\s*(.+)$/i,
    );
    return match ? generic.clean(match[1]) : value || null;
  }

  function fieldNames(value) {
    return Object.entries(value)
      .filter(([, field]) => field !== null && field !== undefined && field !== "")
      .map(([key]) => key);
  }

  globalThis.ListingRadarPortalAdapters =
    globalThis.ListingRadarPortalAdapters || {};
  globalThis.ListingRadarPortalAdapterUtils = {
    firstText,
    joinedText,
    firstAttribute,
    parseFloor,
    sellerTypeFrom,
    dateText,
    fieldNames,
  };
})();
