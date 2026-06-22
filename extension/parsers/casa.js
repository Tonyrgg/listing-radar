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

  function cleanSellerName(value) {
    const text = generic
      .clean(value)
      .replace(/^logo\s+(?:agenzia\s+)?/i, "")
      .replace(/^agenzia\s+verificata\s+/i, "")
      .replace(
        /^(?:(?:agenzia|professionista|privato|inserzionista|venditore|contatto)\s*[:\-]?\s+)+/i,
        "",
      )
      .replace(/^(?:gestit[ao]|curat[ao]|pubblicat[ao]|propost[ao])\s+da\s+/i, "")
      .split(
        /\b(?:chiama|contatta|richiedi|telefono|messaggio|invia|data ultimo|mostra numero)\b/i,
      )[0]
      .replace(/\b(?:n\.?\s*)?telefono\s*:?\s*$/i, "")
      .trim();

    if (
      !text ||
      /^(?:agenzia|professionista|privato|inserzionista|venditore|contatto|contatta l'agenzia|contatta l'inserzionista)$/i.test(
        text,
      )
    ) {
      return null;
    }

    return text;
  }

  function isSellerNameCandidate(value, options = {}) {
    const text = cleanSellerName(value);

    if (
      !text ||
      text.length < 3 ||
      text.length > 90 ||
      /\d{4,}/.test(text) ||
      /^(?:bitonto|bari|ba)$/i.test(text) ||
      /(?:casa\.it|annunci immobiliari|case e appartamenti|case a|appartamenti|prezzo|mutuo|mappa|streetview|servizi|strumenti|data ultimo|classe energetica|valuta|condividi|salva|segnala|privacy|copyright|pubblica annuncio|trova agenzia|informazioni|descrizione|caratteristiche|posizione)/i.test(
        text,
      )
    ) {
      return false;
    }

    if (options.loose) {
      return /[a-z\u00c0-\u017f]{2,}/i.test(text);
    }

    return /\b(?:agenzia|immobiliare|tecnocasa|re\/max|remax|real estate|casa)\b/i.test(
      text,
    );
  }

  function firstSellerNameCandidate(values, options = {}) {
    for (const value of values) {
      const cleaned = cleanSellerName(value);

      if (isSellerNameCandidate(cleaned, options)) {
        return cleaned;
      }
    }

    return null;
  }

  function sellerTypeFromText(value) {
    const text = generic.clean(value).toLowerCase();

    if (
      /\b(?:inserzionista privato|venditore privato|da privato|privato|proprietario|private seller|privateperson|private_person)\b/i.test(
        text,
      )
    ) {
      return "private";
    }

    if (
      /\b(?:agenzia|immobiliare|professionista|impresa|societ|srl|s\.r\.l|sas|s\.a\.s|snc|s\.n\.c|studio|mediazion|real estate|agency|organization|realestateagent|broker)\b/i.test(
        text,
      )
    ) {
      return "agency";
    }

    return null;
  }

  function contactElementTexts() {
    const values = [];
    const selectors = [
      "[data-testid='agency-name']",
      "[data-testid='advertiser-name']",
      "[data-testid='agency-card']",
      "[data-testid='advertiser-card']",
      "[data-testid*='contact' i]",
      "[data-testid*='agency' i]",
      "[data-testid*='advertiser' i]",
      "[class*='contact' i]",
      "[class*='agency' i]",
      "[class*='advertiser' i]",
      "[href*='/agenzie/']",
      "[href*='/agenzia/']",
      "[href*='/professionisti/']",
      ".agency-name",
      ".advertiser-name",
      ".detail-agency-name",
      ".agency-card",
      ".advertiser-card",
    ];

    document.querySelectorAll(selectors.join(",")).forEach((element) => {
      [
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("alt"),
      ].forEach((value) => {
        if (value) {
          values.push(value);
        }
      });
    });

    return values;
  }

  function parseJsonScriptValues() {
    const values = [];

    document.querySelectorAll("script").forEach((script) => {
      const text = (script.textContent || "").trim();

      if (!/^[\[{]/.test(text)) {
        return;
      }

      try {
        values.push(JSON.parse(text));
      } catch {
        // Ignore application scripts that are not valid JSON payloads.
      }
    });

    return values;
  }

  function collectStructuredSellerCandidates() {
    const candidates = [];
    const sellerKeyPattern =
      /(?:agency|agenzia|advertiser|publisher|seller|agent|broker|contact|customer|professional|realestate|organization|inserzionista|venditore)/i;
    const nameKeyPattern =
      /(?:name|nome|displayname|businessname|companyname|agencyname|advertisername|publishername|sellername|contactname|brand|ragionesociale)/i;
    const typeKeyPattern =
      /(?:type|sellerType|advertiserType|publisherType|role|category|privato|professionista)/i;

    function addCandidate(name, typeHint, sourcePath) {
      const type = typeHint || sellerTypeFromText(`${sourcePath} ${name || ""}`);

      if (isSellerNameCandidate(name, { loose: true })) {
        candidates.push({
          name: cleanSellerName(name),
          type,
          sourcePath,
        });
      } else if (type) {
        candidates.push({
          name: null,
          type,
          sourcePath,
        });
      }
    }

    function visit(value, path = [], depth = 0) {
      if (!value || depth > 9) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, [...path, String(index)], depth + 1));
        return;
      }

      if (typeof value !== "object") {
        return;
      }

      const record = value;
      const pathText = path.join(".");
      const objectType = generic.clean(
        [
          record["@type"],
          record.type,
          record.sellerType,
          record.advertiserType,
          record.publisherType,
          record.category,
          record.role,
          record.label,
        ]
          .flat()
          .filter(Boolean)
          .join(" "),
      );
      const looksLikeSeller =
        sellerKeyPattern.test(pathText) || sellerKeyPattern.test(objectType);
      const typeHint = sellerTypeFromText(`${pathText} ${objectType}`);

      Object.entries(record).forEach(([key, entry]) => {
        if (
          typeof entry === "string" &&
          (nameKeyPattern.test(key) || (looksLikeSeller && key === "title"))
        ) {
          addCandidate(entry, typeHint, `${pathText}.${key}`);
        }

        if (typeof entry === "string" && typeKeyPattern.test(key)) {
          addCandidate(null, sellerTypeFromText(entry), `${pathText}.${key}`);
        }
      });

      Object.entries(record).forEach(([key, entry]) => {
        visit(entry, [...path, key], depth + 1);
      });
    }

    parseJsonScriptValues().forEach((value) => visit(value));

    return candidates;
  }

  function extractStructuredSellerInfo() {
    const candidates = collectStructuredSellerCandidates();
    const withName = candidates.find((candidate) => candidate.name);

    return withName || candidates.find((candidate) => candidate.type) || null;
  }

  function extractSellerName(description, pageText, structuredSeller) {
    const contactTexts = contactElementTexts();
    const sellerSectionName = utils.lineAfter(
      [
        /^Inserzionista$/i,
        /^Venditore$/i,
        /^Contatto$/i,
        /^Agenzia$/i,
        /^Agenzia immobiliare$/i,
        /^Gestit[ao] da$/i,
        /^Annuncio gestito da$/i,
        /^Pubblicat[ao] da$/i,
      ],
      {
        skip: [
          /^Professionista$/i,
          /^Agenzia$/i,
          /^Privato$/i,
          /^Contatta$/i,
          /^Chiama/i,
          /^Invia/i,
          /^Richiedi/i,
        ],
      },
    );

    return (
      firstSellerNameCandidate([structuredSeller?.name], { loose: true }) ||
      firstSellerNameCandidate(contactTexts, { loose: true }) ||
      firstSellerNameCandidate([sellerSectionName], { loose: true }) ||
      firstSellerNameCandidate([
        utils.firstText([
          "[data-testid='agency-name']",
          "[data-testid='advertiser-name']",
          "[data-testid='agency-card']",
          "[data-testid='advertiser-card']",
          "[data-testid*='agency' i]",
          "[data-testid*='advertiser' i]",
          "[href*='/agenzie/']",
          "[href*='/agenzia/']",
          "[href*='/professionisti/']",
          ".agency-name",
          ".advertiser-name",
          ".detail-agency-name",
          ".agency-card",
          ".advertiser-card",
        ]),
        utils.firstAttribute(
          [
            "img[alt*='logo agenzia' i]",
            "img[alt*='agenzia' i]",
            "img[alt*='immobiliare' i]",
          ],
          "alt",
        ),
        utils.lineAfter(
          [
            /^Inserzionista$/i,
            /^Agenzia$/i,
            /^Gestit[ao] da$/i,
            /^Annuncio gestito da$/i,
          /^Pubblicat[ao] da$/i,
        ],
        {
            skip: [
              /^Professionista$/i,
              /^Agenzia$/i,
              /^Privato$/i,
              /^Contatta$/i,
              /^Chiama/i,
              /^Invia/i,
              /^Richiedi/i,
            ],
          },
        ),
        ...utils.pageLines(),
        utils.firstMatch(pageText, [
          /(?:gestit[ao]|curat[ao]|pubblicat[ao]|propost[ao])\s+da\s+([^#]+?)(?:\s+(?:chiama|contatta|richiedi|telefono)|$)/i,
          /(?:agenzia|inserzionista)\s+([^#]+?(?:Immobiliare|Tecnocasa|RE\/MAX|Remax|Real Estate|Casa)[^#]*?)(?:\s+(?:chiama|contatta|richiedi|telefono)|$)/i,
          /([^#]{1,90}?(?:Immobiliare|Tecnocasa|RE\/MAX|Remax|Real Estate|Casa)[^#]{0,40})\s+Data ultimo/i,
        ]),
        utils.firstMatch(description, [
          /(?:Contattate|Contatta)\s+(?:l'agenzia\s+)?([^.,]+?)\s+per/i,
          /^([^.,]+?Immobiliare[^.,]*?)\s+propone/i,
          /^([^.,]+?Tecnocasa[^.,]*?)\s+propone/i,
          /^([^.,]+?RE\/MAX[^.,]*?)\s+propone/i,
        ]),
      ]) || null
    );
  }

  function extractSellerContext(sellerName, description, structuredSeller) {
    return (
      contactElementTexts().join(" ") ||
      utils.firstText([
        "[data-testid='agency-card']",
        "[data-testid='advertiser-card']",
        "[data-testid*='contact' i]",
        "[data-testid*='agency' i]",
        "[data-testid*='advertiser' i]",
        "[class*='contact' i]",
        "[class*='agency' i]",
        "[class*='advertiser' i]",
        ".detail-agency",
        ".advertiser-card",
      ]) ||
      `${sellerName || ""} ${structuredSeller?.type || ""} ${
        structuredSeller?.sourcePath || ""
      } ${description || ""}`
    );
  }

  function extractSellerType(sellerName, sellerContext, description, structuredSeller) {
    const text = `${sellerName || ""} ${sellerContext || ""} ${description || ""}`;

    if (structuredSeller?.type === "private") {
      return "private";
    }

    if (structuredSeller?.type === "agency") {
      return "agency";
    }

    if (/\b(?:inserzionista privato|venditore privato|da privato|privato|no agenzie|proprietario)\b/i.test(text)) {
      return "private";
    }

    return utils.sellerTypeFrom(sellerName, text) || sellerTypeFromText(text) || "unknown";
  }

  function normalizePhone(value) {
    const text = generic.clean(value);
    const phoneMatch = text.match(
      /(?:\+?39[\s./-]*)?(?:(?:0\d{1,4}|3\d{2})[\s./-]?\d[\d\s./-]{5,10}\d)/,
    );

    if (!phoneMatch?.[0]) {
      return null;
    }

    const digits = phoneMatch[0].replace(/\D/g, "");

    if (digits.length < 8 || digits.length > 13) {
      return null;
    }

    return digits.startsWith("39") && digits.length > 10
      ? `+${digits}`
      : digits;
  }

  function extractPhoneFromText(value) {
    const text = generic.clean(value);

    if (
      !/(?:tel:|telefono|cellulare|chiama|contatta|mostra numero|\+39|\b0\d{1,4}[\s./-]?\d|\b3\d{2}[\s./-]?\d)/i.test(
        text,
      )
    ) {
      return null;
    }

    return normalizePhone(text);
  }

  function extractPhone(sellerContext) {
    const visiblePhone = normalizePhone(generic.visiblePhone());

    if (visiblePhone) {
      return visiblePhone;
    }

    const candidates = [];
    const selectors = [
      "a[href^='tel:']",
      "button",
      "a",
      "[role='button']",
      "[data-phone]",
      "[data-telephone]",
      "[data-contact-phone]",
      "[data-agent-phone]",
      "[data-testid*='phone' i]",
      "[data-testid*='call' i]",
      "[data-testid*='contact' i]",
      "[class*='phone' i]",
      "[class*='call' i]",
      "[class*='contact' i]",
      "[aria-label*='telefono' i]",
      "[aria-label*='chiama' i]",
      "[title*='telefono' i]",
      "[title*='chiama' i]",
    ];

    document.querySelectorAll(selectors.join(",")).forEach((element) => {
      [
        element.textContent,
        element.getAttribute("href"),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-phone"),
        element.getAttribute("data-telephone"),
        element.getAttribute("data-contact-phone"),
        element.getAttribute("data-agent-phone"),
        element.getAttribute("data-value"),
        element.getAttribute("value"),
      ].forEach((value) => {
        if (value) {
          candidates.push(value);
        }
      });
    });

    candidates.push(sellerContext);
    utils
      .pageLines()
      .filter((line) => /(?:chiama|telefono|cellulare|mostra numero)/i.test(line))
      .forEach((line) => candidates.push(line));

    for (const candidate of candidates) {
      const phone = extractPhoneFromText(candidate);

      if (phone) {
        return phone;
      }
    }

    return null;
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
      const structuredSeller = extractStructuredSellerInfo();
      const sellerName = extractSellerName(description, pageText, structuredSeller);
      const sellerContext = extractSellerContext(sellerName, description, structuredSeller);
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
        sellerType: extractSellerType(
          sellerName,
          sellerContext,
          description,
          structuredSeller,
        ),
        phone: extractPhone(sellerContext),
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
          structuredSeller: structuredSeller
            ? {
                name: structuredSeller.name,
                type: structuredSeller.type,
                sourcePath: structuredSeller.sourcePath,
              }
            : null,
          contactParser: "casa-contact-v3",
        },
      };
    },
  };
})();
