import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const root = process.cwd();
const listingSourcePath = path.join(root, "assets", "brand", "listing-radar-logo.png");
const workerSourcePath = path.join(root, "assets", "brand", "property-worker-logo.png");

const outputDirectories = [
  path.join(root, "public", "brand"),
  path.join(root, "extension", "icons"),
  path.join(root, "worker", "assets"),
  path.join(root, "worker", "src", "desktop", "renderer"),
];

await Promise.all(outputDirectories.map((directory) => mkdir(directory, { recursive: true })));

const [listingSource, workerSource] = await Promise.all([
  readFile(listingSourcePath),
  readFile(workerSourcePath),
]);

async function assertSourceSize(name, source) {
  const metadata = await sharp(source).metadata();
  if (metadata.width !== 1254 || metadata.height !== 1254) {
    throw new Error(
      `Sorgente ${name} inattesa: ${metadata.width ?? "?"}x${metadata.height ?? "?"}; atteso 1254x1254.`,
    );
  }
}

await Promise.all([
  assertSourceSize("Listing Radar", listingSource),
  assertSourceSize("Property Worker", workerSource),
]);

// Il file consegnato contiene il lockup orizzontale al centro di una tela
// trasparente quadrata. Il ritaglio del simbolo esclude parola e separatore,
// conservando i pixel originali e un margine ottico uniforme.
const listingIconSource = await sharp(listingSource)
  .extract({ left: 0, top: 346, width: 520, height: 520 })
  .png()
  .toBuffer();

// Il marchio del worker ha proporzioni leggermente diverse. Lo estraiamo dal
// suo bounding box e aggiungiamo margini simmetrici, senza includere il
// separatore verticale del lockup.
const workerIconSource = await sharp(workerSource)
  .extract({ left: 21, top: 383, width: 481, height: 450 })
  .extend({
    top: 35,
    bottom: 35,
    left: 20,
    right: 19,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();

const iconPng = (source, size) =>
  sharp(source)
    .resize(size, size, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toBuffer();

const iconSizes = [16, 32, 48, 64, 128, 180, 256, 512];
const [listingIcons, workerIcons] = await Promise.all(
  [listingIconSource, workerIconSource].map(
    async (source) =>
      new Map(await Promise.all(iconSizes.map(async (size) => [size, await iconPng(source, size)]))),
  ),
);

function createIco(icons, sizes) {
  const images = sizes.map((size) => ({ size, data: icons.get(size) }));
  const directorySize = 6 + images.length * 16;
  const header = Buffer.alloc(directorySize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = directorySize;
  images.forEach(({ size, data }, index) => {
    if (!data) throw new Error(`Icona ${size}px non generata.`);
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

const fullLogo = await sharp(listingSource)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 4 })
  .extend({
    top: 16,
    bottom: 16,
    left: 16,
    right: 16,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png({ compressionLevel: 9 })
  .toBuffer();

const fullWorkerLogo = await sharp(workerSource)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 4 })
  .extend({
    top: 16,
    bottom: 16,
    left: 16,
    right: 16,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png({ compressionLevel: 9 })
  .toBuffer();

await Promise.all([
  writeFile(path.join(root, "public", "brand", "listing-radar-logo.png"), fullLogo),
  writeFile(path.join(root, "public", "brand", "listing-radar-icon.png"), listingIcons.get(512)),
  writeFile(path.join(root, "app", "icon.png"), listingIcons.get(512)),
  writeFile(path.join(root, "app", "apple-icon.png"), listingIcons.get(180)),
  writeFile(path.join(root, "app", "favicon.ico"), createIco(listingIcons, [16, 32, 48, 64, 256])),
  writeFile(path.join(root, "extension", "icons", "icon16.png"), listingIcons.get(16)),
  writeFile(path.join(root, "extension", "icons", "icon32.png"), listingIcons.get(32)),
  writeFile(path.join(root, "extension", "icons", "icon48.png"), listingIcons.get(48)),
  writeFile(path.join(root, "extension", "icons", "icon128.png"), listingIcons.get(128)),
  writeFile(path.join(root, "worker", "assets", "logo.png"), fullWorkerLogo),
  writeFile(path.join(root, "worker", "assets", "icon.png"), workerIcons.get(512)),
  writeFile(
    path.join(root, "worker", "assets", "icon.ico"),
    createIco(workerIcons, [16, 32, 48, 64, 128, 256]),
  ),
  writeFile(
    path.join(root, "worker", "src", "desktop", "renderer", "icon.png"),
    workerIcons.get(512),
  ),
]);

console.log("Asset Listing Radar e Property Worker generati dalle sorgenti ufficiali.");
