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

  function pageText() {
    return generic.clean(document.body?.innerText || "");
  }

  function pageLines() {
    return (document.body?.innerText || "")
      .split(/\n+/)
      .map((line) => generic.clean(line))
      .filter(Boolean);
  }

  function firstMatch(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);

      if (match?.[1]) {
        return generic.clean(match[1]);
      }
    }

    return null;
  }

  function firstLineMatch(patterns) {
    for (const line of pageLines()) {
      const value = firstMatch(line, patterns);

      if (value) {
        return value;
      }
    }

    return null;
  }

  function sectionText(startPatterns, endPatterns = []) {
    const lines = pageLines();
    const startIndex = lines.findIndex((line) =>
      startPatterns.some((pattern) => pattern.test(line)),
    );

    if (startIndex === -1) {
      return "";
    }

    let endIndex = lines.length;

    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (endPatterns.some((pattern) => pattern.test(lines[index]))) {
        endIndex = index;
        break;
      }
    }

    return lines.slice(startIndex + 1, endIndex).join(" ");
  }

  function fieldValue(labels) {
    const lines = pageLines();

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const label = labels.find((candidate) =>
        new RegExp(`^${candidate}\\b`, "i").test(line),
      );

      if (!label) {
        continue;
      }

      const inline = line
        .replace(new RegExp(`^${label}\\b\\s*[:\\-]?\\s*`, "i"), "")
        .trim();

      if (inline && inline.toLowerCase() !== label.toLowerCase()) {
        return generic.clean(inline);
      }

      for (let next = index + 1; next < Math.min(lines.length, index + 5); next += 1) {
        if (
          lines[next] &&
          !labels.some((candidate) =>
            new RegExp(`^${candidate}\\b`, "i").test(lines[next]),
          )
        ) {
          return generic.clean(lines[next]);
        }
      }
    }

    return null;
  }

  function textPrice() {
    return generic.parsePrice(
      firstLineMatch([
        /((?:da\s*)?\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?\s*(?:€|eur|euro))/i,
        /((?:€|eur)\s*\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?)/i,
      ]) || pageText(),
    );
  }

  function cleanDescription(value) {
    return generic
      .clean(value)
      .replace(
        /Disponibile in Italiano.*?Altre lingue/gi,
        " ",
      )
      .replace(
        /(?:Ci dispiace|Sorry|Lo sentimos|Nous sommes désolés|Leider|Lamentamos).*?(?:più tardi|later|tard|später)\.?/gi,
        " ",
      )
      .replace(/\bLeggi tutto\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
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

  function sellerNameFromText() {
    const text = pageText();
    return firstMatch(text, [
      /puoi parlare con\s+([^.,\n]+?)(?:\.|Invia|$)/i,
      /Chiedi all'inserzionista\s+([^#]+?)(?:\s+(?:Contattato|Il tuo messaggio|Chat|Chiama)|$)/i,
      /Persona che pubblica l'annuncio\s+(?:Vedi il telefono Chiama\s+)?(?:Codice dell'annuncio\s+[^\n]+?\s+)?(?:Professionista|Privato)?\s*([^#]+?)(?:\s+(?:Chat|Chiama|Roma|Professionista|Privato)|$)/i,
    ]);
  }

  function dateText(selectors) {
    const value = firstText(selectors);
    const match = value.match(
      /(?:pubblicato|aggiornato|inserito|data)\s*(?:il|:)?\s*(.+)$/i,
    );
    return match ? generic.clean(match[1]) : value || null;
  }

  function lineAfter(patterns, options = {}) {
    const lines = pageLines();
    const skip = options.skip || [];
    const maxLookAhead = options.maxLookAhead || 8;

    for (let index = 0; index < lines.length; index += 1) {
      if (!patterns.some((pattern) => pattern.test(lines[index]))) {
        continue;
      }

      for (
        let next = index + 1;
        next < Math.min(lines.length, index + maxLookAhead + 1);
        next += 1
      ) {
        const line = lines[next];

        if (!line || skip.some((pattern) => pattern.test(line))) {
          continue;
        }

        return line;
      }
    }

    return null;
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
    pageText,
    pageLines,
    firstMatch,
    firstLineMatch,
    sectionText,
    fieldValue,
    textPrice,
    cleanDescription,
    parseFloor,
    sellerTypeFrom,
    sellerNameFromText,
    dateText,
    lineAfter,
    fieldNames,
  };
})();
