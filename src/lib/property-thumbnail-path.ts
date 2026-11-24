export const VISUALS_BUCKET = "property-lifecycle-visuals";

export function isPropertyThumbnailPath(path: string) {
  return /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\/preview-640-[a-f\d]{64}\.webp$/i.test(path);
}
