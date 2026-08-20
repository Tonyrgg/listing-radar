import { createHash } from "node:crypto";
import exifr from "exifr";
import sharp from "sharp";

export interface ImageInspection {
  exif: Record<string, unknown> | null;
  format: string | null;
  hasAlpha: boolean;
  height: number | null;
  perceptualHash: string;
  sha256: string;
  width: number | null;
}

export async function inspectImage(input: Buffer | Uint8Array): Promise<ImageInspection> {
  const buffer = Buffer.from(input);
  const image = sharp(buffer, { failOn: "warning" });
  const metadata = await image.metadata();
  const exif = metadata.exif ? ((await exifr.parse(buffer).catch(() => null)) as Record<string, unknown> | null) : null;
  const { data } = await image
    .clone()
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let perceptualHash = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const left = data[row * 9 + column];
      const right = data[row * 9 + column + 1];
      perceptualHash += left > right ? "1" : "0";
    }
  }

  return {
    exif,
    format: metadata.format ?? null,
    hasAlpha: metadata.hasAlpha ?? false,
    height: metadata.height ?? null,
    perceptualHash,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    width: metadata.width ?? null,
  };
}
