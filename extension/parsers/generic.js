(function initializeGenericParser() {
  if (globalThis.ListingRadarGenericParser) {
    return;
  }

  function clean(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function numberFrom(value) {
    const normalized = String(value || "")
      .replace(/\s/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parsePrice(value) {
    const match = clean(value).match(
      /(?:\u20ac\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,\d{1,2})?\s*(?:\u20ac|eur|euro)/i,
    );
    return match ? Math.round(numberFrom(match[1])) : null;
  }

  function parseSqm(value) {
    const match = clean(value).match(
      /(\d+(?:[,.]\d+)?)\s*(?:m\u00b2|mq|m2|metri quadri)/i,
    );
    return match ? Math.round(numberFrom(match[1])) : null;
  }

  function parseRooms(value) {
    const text = clean(value).toLowerCase();
    const named = {
      monolocale: 1,
      bilocale: 2,
      trilocale: 3,
      quadrilocale: 4,
      pentavani: 5,
    };

    for (const [label, count] of Object.entries(named)) {
      if (text.includes(label)) {
        return count;
      }
    }

    const match = text.match(/(\d+(?:[,.]\d+)?)\s*(?:locali|vani|stanze)/i);
    return match ? numberFrom(match[1]) : null;
  }

  function roundedNumber(value) {
    const parsed = numberFrom(value);
    return parsed == null ? null : Math.round(parsed);
  }

  function meta(name) {
    return (
      document.querySelector(`meta[property="${name}"]`)?.content ||
      document.querySelector(`meta[name="${name}"]`)?.content ||
      ""
    );
  }

  function canonicalUrl() {
    const value =
      document.querySelector('link[rel="canonical"]')?.href || location.href;
    const url = new URL(value, location.href);
    url.hash = "";
    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "from",
    ].forEach((key) => url.searchParams.delete(key));
    return url.toString();
  }

  function allJsonLd() {
    const values = [];

    document
      .querySelectorAll('script[type="application/ld+json"]')
      .forEach((script) => {
        try {
          const parsed = JSON.parse(script.textContent || "");
          values.push(parsed);
        } catch {
          // Ignore malformed metadata and continue with visible content.
        }
      });

    return values.flatMap((value) =>
      Array.isArray(value?.["@graph"]) ? value["@graph"] : value,
    );
  }

  function findJsonLd(values) {
    return (
      values.find((value) => {
        const type = value?.["@type"];
        const types = Array.isArray(type) ? type : [type];
        return types.some((item) =>
          [
            "Apartment",
            "House",
            "Product",
            "RealEstateListing",
            "Residence",
            "SingleFamilyResidence",
          ].includes(item),
        );
      }) || values.find((value) => value?.name || value?.offers)
    );
  }

  function valueFromObject(value) {
    if (typeof value === "number" || typeof value === "string") {
      return value;
    }

    return value?.value ?? value?.amount ?? null;
  }

  function addressFrom(value) {
    if (!value) {
      return null;
    }

    if (typeof value === "string") {
      return clean(value);
    }

    return clean(
      [
        value.streetAddress,
        value.addressLocality,
        value.addressRegion,
        value.postalCode,
      ]
        .filter(Boolean)
        .join(", "),
    );
  }

  function sellerFrom(value) {
    const seller =
      value?.seller || value?.provider || value?.author || value?.publisher;
    return clean(typeof seller === "string" ? seller : seller?.name) || null;
  }

  function visiblePhone() {
    const telephoneLink = document.querySelector('a[href^="tel:"]');
    if (!telephoneLink) {
      return null;
    }

    return clean(
      telephoneLink.textContent ||
        telephoneLink.getAttribute("href")?.replace(/^tel:/, ""),
    );
  }

  function incomingId() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    return params.get("listing-radar");
  }

  function imageValues(value) {
    if (!value) {
      return [];
    }

    if (typeof value === "string") {
      return [value];
    }

    if (Array.isArray(value)) {
      return value.flatMap(imageValues);
    }

    if (typeof value === "object") {
      return imageValues(
        value.url ||
          value.contentUrl ||
          value.thumbnailUrl ||
          value.image,
      );
    }

    return [];
  }

  function largestSrcsetCandidate(value) {
    return String(value || "")
      .split(",")
      .map((candidate) => candidate.trim().split(/\s+/)[0])
      .filter(Boolean)
      .at(-1);
  }

  function normalizeImageUrl(value) {
    if (!value || /^(?:data:|blob:|javascript:)/i.test(value)) {
      return null;
    }

    try {
      const url = new URL(value, location.href);
      const searchable = `${url.pathname} ${url.search}`.toLowerCase();

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

  function collectImageUrls(structured, jsonLdValues) {
    const urls = [];

    function add(value) {
      for (const candidate of imageValues(value)) {
        const normalized = normalizeImageUrl(candidate);

        if (normalized && !urls.includes(normalized)) {
          urls.push(normalized);
        }
      }
    }

    add(structured.image);
    add(structured.photo);
    jsonLdValues.forEach((value) => {
      add(value?.image);
      add(value?.photo);
      add(value?.subjectOf?.image);
    });
    add(meta("og:image"));
    add(meta("og:image:secure_url"));
    add(meta("twitter:image"));

    document.querySelectorAll("img").forEach((image) => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;

      if ((width > 0 && width < 240) || (height > 0 && height < 160)) {
        return;
      }

      add(
        largestSrcsetCandidate(
          image.getAttribute("srcset") ||
            image.getAttribute("data-srcset") ||
            image.getAttribute("data-lazy-srcset"),
        ) ||
          image.currentSrc ||
          image.getAttribute("src") ||
          image.getAttribute("data-src") ||
          image.getAttribute("data-lazy-src") ||
          image.getAttribute("data-original"),
      );
    });

    document
      .querySelectorAll('[style*="background-image"]')
      .forEach((element) => {
        const background = getComputedStyle(element).backgroundImage;
        const match = background.match(/url\((['"]?)(.*?)\1\)/i);

        if (match?.[2]) {
          add(match[2]);
        }
      });

    return urls.slice(0, 30);
  }

  function extract() {
    const jsonLdValues = allJsonLd();
    const structured = findJsonLd(jsonLdValues) || {};
    const bodyText = clean(document.body?.innerText).slice(0, 120000);
    const offers = Array.isArray(structured.offers)
      ? structured.offers[0]
      : structured.offers || {};
    const floorMatch = bodyText.match(
      /(?:piano|floor)\s*[:\-]?\s*([a-z0-9\u00b0\u00ba\- ]{1,30})/i,
    );
    const address = addressFrom(structured.address);
    const title = clean(
      structured.name ||
        document.querySelector("h1")?.textContent ||
        meta("og:title") ||
        document.title,
    );
    const description = clean(
      structured.description ||
        meta("description") ||
        meta("og:description"),
    );
    const priceValue =
      valueFromObject(offers.price) ||
      meta("product:price:amount") ||
      meta("og:price:amount");
    const sqmValue = valueFromObject(
      structured.floorSize || structured.size || structured.area,
    );
    const roomsValue = valueFromObject(
      structured.numberOfRooms || structured.numberOfBedrooms,
    );
    const imageUrls = collectImageUrls(structured, jsonLdValues);

    return {
      incomingId: incomingId(),
      url: location.href,
      canonicalUrl: canonicalUrl(),
      title,
      description: description || null,
      price:
        priceValue != null
          ? roundedNumber(priceValue)
          : parsePrice(bodyText),
      sqm: sqmValue != null ? roundedNumber(sqmValue) : parseSqm(bodyText),
      rooms:
        roomsValue != null ? numberFrom(roomsValue) : parseRooms(bodyText),
      floor: floorMatch ? clean(floorMatch[1]) : null,
      zone:
        clean(
          structured.address?.addressLocality ||
            structured.address?.addressRegion,
        ) || null,
      addressRaw: address,
      sellerType: sellerFrom(structured) ? "agency" : "unknown",
      sellerName: sellerFrom(structured),
      phone: visiblePhone(),
      imageUrl: imageUrls[0] || null,
      imageUrls,
      metadataDatePublished:
        structured.datePosted || structured.datePublished || null,
      metadataDateModified: structured.dateModified || null,
      rawPayload: {
        capturedAt: new Date().toISOString(),
        jsonLdTypes: jsonLdValues
          .map((value) => value?.["@type"])
          .filter(Boolean)
          .slice(0, 20),
        meta: {
          title: meta("og:title"),
          description: meta("og:description"),
          image: imageUrls[0] || meta("og:image"),
        },
        imageUrls,
      },
    };
  }

  globalThis.ListingRadarGenericParser = {
    clean,
    parsePrice,
    parseSqm,
    parseRooms,
    extract,
  };
})();
