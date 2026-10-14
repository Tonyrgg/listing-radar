/** A dedicated status graphic, never a substring of an address or unrelated URL. */
export function isDedicatedSoldGraphicUrl(value: string): boolean {
  try {
    const pathname = decodeURIComponent(new URL(value).pathname);
    return /(?:^|[/_.-])(?:venduto|venduta|venduti|vendute|sold)(?:[/_.-]|$)/i.test(pathname);
  } catch { return false; }
}
