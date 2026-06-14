(function initializeContentBridge() {
  if (globalThis.__listingRadarContentBridge) {
    return;
  }

  globalThis.__listingRadarContentBridge = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "LISTING_RADAR_EXTRACT") {
      return false;
    }

    try {
      const data = globalThis.ListingRadarPortalParser.extract();
      sendResponse({ ok: true, data });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return true;
  });
})();
